/**
 * `OpenAiMediaProvider` behavior against a real loopback HTTP fixture: what the
 * request carries, what the response becomes, and what each failure reports.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MediaError } from '@deepseek-ai/dsh-media'
import { OpenAiMediaProvider, sniffImageMediaType } from '@deepseek-ai/dsh-media-openai'
import type { OpenAiMediaProfile } from '@deepseek-ai/dsh-media-openai'

/** A 1×1 PNG, the smallest real image the test can hand back. */
const PNG_BYTES = Uint8Array.from(Buffer.from(
  'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVR42mP8z8DwHwAFAAH/q842iQAAAABJRU5ErkJggg==',
  'base64',
))

/** One request the fixture received, decoded for assertions. */
interface Received {
  readonly method?: string
  readonly url: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

/** Per-request handler the current test installs. */
type Handler = (received: Received, response: ServerResponse) => void

let handler: Handler = (_received, response) => { response.writeHead(500).end() }
const received: Received[] = []
let server: Server
let origin: string

beforeAll(async () => {
  server = createServer((request, response) => {
    void readRequest(request).then((captured) => {
      received.push(captured)
      handler(captured, response)
    }, (error: unknown) => response.destroy(asError(error)))
  })
  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', resolve)
  })
  origin = `http://127.0.0.1:${(server.address() as AddressInfo).port}`
})

afterAll(async () => {
  if (!server.listening) return
  await new Promise<void>((resolve, reject) => server.close((error) => {
    if (error === undefined) resolve()
    else reject(error)
  }))
})

/** Reset the fixture and install the handler for one test. */
function serve(next: Handler): void {
  received.length = 0
  handler = next
}

/** Build a provider over one profile, with a fixed key. `null` supplies no credential. */
function provider(profile: OpenAiMediaProfile, apiKey: string | null = 'test-key'): OpenAiMediaProvider {
  return new OpenAiMediaProvider({
    id: 'openai-compatible',
    profile: () => profile,
    resolveApiKey: async () => apiKey ?? undefined,
  })
}

describe('OpenAiMediaProvider profiles', () => {
  it('advertises exactly the operations whose model is configured', () => {
    expect(provider({ baseURL: origin }).capabilities).toEqual([])
    expect(provider({ baseURL: origin, describeModel: 'vision' }).capabilities).toEqual(['describe'])
    expect(provider({ baseURL: origin, describeModel: 'vision', generateModel: 'draw' }).capabilities)
      .toEqual(['describe', 'generate'])
    expect(provider({ baseURL: origin, describeModel: 'v', generateModel: 'd', transcribeModel: 't' }).capabilities)
      .toEqual(['describe', 'generate', 'transcribe'])
  })

  it('reports availability from the endpoint alone, independently of configured operations', () => {
    // Reachability and advertised operations are separate axes: a dormant
    // provider with no model still has a parseable endpoint.
    expect(provider({ baseURL: origin }).available()).toBe(true)
    expect(provider({ baseURL: 'not-a-url', describeModel: 'vision' }).available()).toBe(false)
    expect(provider({ baseURL: origin, describeModel: 'vision' }).available()).toBe(true)
  })
})

describe('OpenAiMediaProvider describe', () => {
  it('sends the image as a data URL and returns the answer text', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        choices: [{ message: { content: 'a small blue square' } }],
      }))
    })

    const result = await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } })

    expect(result).toEqual({ text: 'a small blue square', provider: 'openai-compatible', model: 'vision' })
    expect(received[0]?.url).toBe('/chat/completions')
    const body = JSON.parse(received[0]?.body ?? '{}') as { model: string, messages: { content: { type: string, image_url?: { url: string } }[] }[] }
    expect(body.model).toBe('vision')
    expect(body.messages[0]?.content[1]?.image_url?.url).toBe(`data:image/png;base64,${Buffer.from(PNG_BYTES).toString('base64')}`)
    expect(received[0]?.headers.authorization).toBe('Bearer test-key')
  })

  it('joins a multi-part answer instead of reporting only the first part', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: [{ type: 'text', text: 'left ' }, { type: 'text', text: 'right' }] } }] }))
    })

    const result = await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } })
    expect(result.text).toBe('left right')
  })

  it('uses the caller prompt when one is given', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })

    await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES }, prompt: 'read the sign' })
    const body = JSON.parse(received[0]?.body ?? '{}') as { messages: { content: { type: string, text?: string }[] }[] }
    expect(body.messages[0]?.content[0]?.text).toBe('read the sign')
  })

  it('refuses an operation the profile does not configure', async () => {
    await expect(provider({ baseURL: origin }).describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_UNSUPPORTED_CAPABILITY' })
  })

  it('reports an empty answer rather than returning a blank description', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: '   ' } }] }))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('OpenAiMediaProvider generate', () => {
  it('decodes b64_json into bytes and sniffs the media type', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }] }))
    })

    const result = await provider({ baseURL: origin, generateModel: 'draw' })
      .generate({ prompt: 'a blue square' })
    expect(result.mediaType).toBe('image/png')
    expect(Array.from(result.data)).toEqual(Array.from(PNG_BYTES))
    const body = JSON.parse(received[0]?.body ?? '{}') as { prompt: string, size?: string }
    expect(body.prompt).toBe('a blue square')
    expect(body.size).toBeUndefined()
  })

  it('forwards a requested size', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ data: [{ b64_json: Buffer.from(PNG_BYTES).toString('base64') }] }))
    })

    await provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'wide', size: '1536x1024' })
    expect((JSON.parse(received[0]?.body ?? '{}') as { size?: string }).size).toBe('1536x1024')
  })

  it('downloads a url response without sending the credential to that URL', async () => {
    serve((request, response) => {
      if (request.url === '/images/generations') {
        response.writeHead(200, { 'content-type': 'application/json' })
          .end(JSON.stringify({ data: [{ url: `${origin}/blob` }] }))
        return
      }
      response.writeHead(200, { 'content-type': 'image/png' }).end(Buffer.from(PNG_BYTES))
    })

    const result = await provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'a square' })
    expect(result.mediaType).toBe('image/png')
    const download = received.find(entry => entry.url === '/blob')
    expect(download?.headers.authorization).toBeUndefined()
    expect(download?.headers['x-api-key']).toBeUndefined()
  })

  it('reports an empty image list rather than returning zero bytes', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ data: [] }))
    })

    await expect(provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'x' }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('OpenAiMediaProvider transcribe', () => {
  it('posts multipart audio and returns the transcript', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ text: 'hello there', language: 'en' }))
    })

    const result = await provider({ baseURL: origin, transcribeModel: 'whisper' })
      .transcribe({ mediaType: 'audio/wav', data: Uint8Array.from([1, 2, 3]), language: 'en' })
    expect(result).toEqual({ text: 'hello there', language: 'en', provider: 'openai-compatible', model: 'whisper' })
    expect(received[0]?.url).toBe('/audio/transcriptions')
    expect(received[0]?.headers['content-type']).toContain('multipart/form-data')
    expect(received[0]?.body).toContain('name="model"')
    expect(received[0]?.body).toContain('whisper')
  })

  it('reports an empty transcript rather than returning blank text', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ text: '  ' }))
    })

    await expect(provider({ baseURL: origin, transcribeModel: 'whisper' })
      .transcribe({ mediaType: 'audio/wav', data: Uint8Array.from([1]) }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('OpenAiMediaProvider failures', () => {
  it('surfaces the provider message from a non-2xx response', async () => {
    serve((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'rate limited' } }))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_PROVIDER_ERROR', message: 'rate limited' })
  })

  it('names the status when the error body is not JSON', async () => {
    serve((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' }).end('upstream down')
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_PROVIDER_ERROR', message: 'media provider "openai-compatible" returned HTTP 503' })
  })

  it('refuses to follow a redirect that would carry the credential elsewhere', async () => {
    serve((_request, response) => {
      response.writeHead(307, { location: `${origin}/collected` }).end()
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_PROVIDER_ERROR' })
    expect(received.some(entry => entry.url === '/collected')).toBe(false)
  })

  it('reports a missing credential instead of sending an empty one', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: 'ok' } }] }))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' }, null)
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(received).toHaveLength(0)
  })

  it('reports a canceled request as an abort, not a provider error', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ choices: [{ message: { content: 'too late' } }] }))
    })

    const controller = new AbortController()
    controller.abort()
    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }, controller.signal))
      .rejects.toBeInstanceOf(MediaError)
  })
})

describe('sniffImageMediaType', () => {
  it('recognizes the four raster formats the attachment service accepts', () => {
    expect(sniffImageMediaType(PNG_BYTES)).toBe('image/png')
    expect(sniffImageMediaType(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0]))).toBe('image/jpeg')
    expect(sniffImageMediaType(Uint8Array.from([0x52, 0x49, 0x46, 0x46, 0, 0, 0, 0, 0x57, 0x45, 0x42, 0x50]))).toBe('image/webp')
    expect(sniffImageMediaType(Uint8Array.from([0x47, 0x49, 0x46, 0x38, 0x39, 0x61]))).toBe('image/gif')
  })

  it('falls back to PNG for bytes it cannot identify, leaving validation to the attachment service', () => {
    // OpenAI-compatible endpoints return base64 without a type, so a guess is
    // unavoidable here; `attachments.saveImage` re-verifies the bytes and
    // refuses ones that are not a real image.
    expect(sniffImageMediaType(Uint8Array.from([0, 0, 0]))).toBe('image/png')
    expect(sniffImageMediaType(new Uint8Array(0))).toBe('image/png')
  })
})

/** Read a complete request received by the fixture. */
function readRequest(request: IncomingMessage): Promise<Received> {
  return new Promise((resolve, reject) => {
    const chunks: Uint8Array[] = []
    request.on('data', (chunk: unknown) => {
      if (typeof chunk === 'string' || chunk instanceof Uint8Array) chunks.push(Buffer.from(chunk))
      else reject(new TypeError('unexpected HTTP request chunk'))
    })
    request.once('error', reject)
    request.once('end', () => {
      resolve({
        ...request.method === undefined ? {} : { method: request.method },
        url: request.url ?? '/',
        headers: request.headers,
        body: Buffer.concat(chunks).toString('utf8'),
      })
    })
  })
}

/** Normalize an unknown fixture failure for `ServerResponse.destroy`. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
