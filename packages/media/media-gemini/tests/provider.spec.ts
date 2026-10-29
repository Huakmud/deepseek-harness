/**
 * `GeminiMediaProvider` behavior against a real loopback HTTP fixture: what the
 * request carries, what the response becomes, and what each failure reports.
 */

import { afterAll, beforeAll, describe, expect, it } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import type { AddressInfo } from 'node:net'
import { MediaError } from '@deepseek-ai/dsh-media'
import { GeminiMediaProvider } from '@deepseek-ai/dsh-media-gemini'
import type { GeminiMediaProfile } from '@deepseek-ai/dsh-media-gemini'

/** A 1×1 PNG, the smallest real image the fixture can hand back. */
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

/** Build a provider over one profile. `null` supplies no credential. */
function provider(profile: GeminiMediaProfile, apiKey: string | null = 'test-key'): GeminiMediaProvider {
  return new GeminiMediaProvider({
    id: 'gemini',
    profile: () => profile,
    resolveApiKey: async () => apiKey ?? undefined,
  })
}

/** A `:generateContent` response carrying one text answer. */
function answer(text: string): string {
  return JSON.stringify({ candidates: [{ content: { role: 'model', parts: [{ text }] } }] })
}

/** The parsed request body of the first captured call. */
function requestBody(): Record<string, unknown> {
  return JSON.parse(received[0]?.body ?? '{}') as Record<string, unknown>
}

describe('GeminiMediaProvider profiles', () => {
  it('advertises exactly the operations whose model is configured', () => {
    expect(provider({ baseURL: origin }).capabilities).toEqual([])
    expect(provider({ baseURL: origin, describeModel: 'vision' }).capabilities).toEqual(['describe'])
    expect(provider({ baseURL: origin, describeModel: 'vision', generateModel: 'draw', transcribeModel: 'ears' })
      .capabilities).toEqual(['describe', 'generate', 'transcribe'])
  })

  it('reports availability from the endpoint alone, independently of configured operations', () => {
    // Reachability and advertised operations are separate axes: a dormant
    // provider with no model still has a parseable endpoint.
    expect(provider({ baseURL: origin }).available()).toBe(true)
    expect(provider({ baseURL: 'not-a-url', describeModel: 'vision' }).available()).toBe(false)
    expect(provider({ baseURL: origin, describeModel: 'vision' }).available()).toBe(true)
  })
})

describe('GeminiMediaProvider describe', () => {
  it('posts inline image data to the model and returns the answer text', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('a small blue square'))
    })

    const result = await provider({ baseURL: origin, describeModel: 'gemini-2.5-flash' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } })

    expect(result).toEqual({ text: 'a small blue square', provider: 'gemini', model: 'gemini-2.5-flash' })
    expect(received[0]?.url).toBe('/models/gemini-2.5-flash:generateContent')
    expect(received[0]?.headers['x-goog-api-key']).toBe('test-key')
    const parts = (requestBody().contents as { parts: { text?: string, inlineData?: { mimeType: string, data: string } }[] }[])[0]?.parts
    expect(parts?.[1]?.inlineData).toEqual({
      mimeType: 'image/png',
      data: Buffer.from(PNG_BYTES).toString('base64'),
    })
  })

  it('uses the caller prompt when one is given', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('ok'))
    })

    await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES }, prompt: 'read the sign' })

    const parts = (requestBody().contents as { parts: { text?: string }[] }[])[0]?.parts
    expect(parts?.[0]?.text).toBe('read the sign')
  })

  it('forwards the output bound as maxOutputTokens', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('ok'))
    })

    await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES }, maxOutputTokens: 64 })

    expect(requestBody().generationConfig).toEqual({ maxOutputTokens: 64 })
  })

  it('joins a multi-part answer instead of reporting only the first part', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        candidates: [{ content: { parts: [{ text: 'left ' }, { text: 'right' }] } }],
      }))
    })

    const result = await provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } })
    expect(result.text).toBe('left right')
  })

  it('refuses an operation the profile does not configure', async () => {
    await expect(provider({ baseURL: origin }).describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_UNSUPPORTED_CAPABILITY' })
  })

  it('reports an empty answer rather than returning a blank description', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ candidates: [{ content: { parts: [{ text: '   ' }] } }] }))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('GeminiMediaProvider generate', () => {
  it('asks for image output and decodes the inline image part', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        candidates: [{
          content: {
            parts: [
              { text: 'here you go' },
              { inlineData: { mimeType: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') } },
            ],
          },
        }],
      }))
    })

    const result = await provider({ baseURL: origin, generateModel: 'gemini-2.5-flash-image' })
      .generate({ prompt: 'a blue square' })

    expect(result.mediaType).toBe('image/png')
    expect(Array.from(result.data)).toEqual(Array.from(PNG_BYTES))
    expect(result.provider).toBe('gemini')
    expect((requestBody().generationConfig as { responseModalities?: string[] }).responseModalities)
      .toEqual(['TEXT', 'IMAGE'])
  })

  it('maps a requested size onto an aspect ratio', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') } }] } }],
      }))
    })

    await provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'wide', size: '1536x1024' })

    expect((requestBody().generationConfig as { imageConfig?: { aspectRatio?: string } }).imageConfig)
      .toEqual({ aspectRatio: '3:2' })
  })

  it('sends a reference image as an additional inline part', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'image/png', data: Buffer.from(PNG_BYTES).toString('base64') } }] } }],
      }))
    })

    await provider({ baseURL: origin, generateModel: 'draw' })
      .generate({ prompt: 'make it red', reference: { mediaType: 'image/png', data: PNG_BYTES } })

    const parts = (requestBody().contents as { parts: { text?: string, inlineData?: unknown }[] }[])[0]?.parts
    expect(parts?.[0]?.text).toBe('make it red')
    expect(parts?.[1]?.inlineData).toBeDefined()
  })

  it('reports a text-only answer as an empty image instead of returning zero bytes', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'I cannot draw that.' }] } }] }))
    })

    await expect(provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'x' }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })

  it('rejects an inline part that is not an image rather than committing it', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({
        candidates: [{ content: { parts: [{ inlineData: { mimeType: 'audio/ogg', data: 'AAAA' } }] } }],
      }))
    })

    await expect(provider({ baseURL: origin, generateModel: 'draw' }).generate({ prompt: 'x' }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('GeminiMediaProvider transcribe', () => {
  it('sends the audio inline and returns the transcript', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('hello there'))
    })

    const result = await provider({ baseURL: origin, transcribeModel: 'gemini-2.5-flash' })
      .transcribe({ mediaType: 'audio/ogg', data: Uint8Array.from([1, 2, 3]), language: 'en' })

    expect(result).toEqual({ text: 'hello there', language: 'en', provider: 'gemini', model: 'gemini-2.5-flash' })
    const parts = (requestBody().contents as { parts: { inlineData?: { mimeType: string } }[] }[])[0]?.parts
    expect(parts?.[1]?.inlineData?.mimeType).toBe('audio/ogg')
  })

  it('omits the language hint when the caller supplies none', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('hello'))
    })

    const result = await provider({ baseURL: origin, transcribeModel: 'ears' })
      .transcribe({ mediaType: 'audio/wav', data: Uint8Array.from([1]) })

    expect(result.language).toBeUndefined()
    const parts = (requestBody().contents as { parts: { text?: string }[] }[])[0]?.parts
    expect(parts?.[0]?.text).not.toContain('BCP-47')
  })

  it('reports an empty transcript rather than returning blank text', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('  '))
    })

    await expect(provider({ baseURL: origin, transcribeModel: 'ears' })
      .transcribe({ mediaType: 'audio/wav', data: Uint8Array.from([1]) }))
      .rejects.toMatchObject({ code: 'MEDIA_EMPTY_RESPONSE' })
  })
})

describe('GeminiMediaProvider failures', () => {
  it('surfaces the provider message from a non-2xx response', async () => {
    serve((_request, response) => {
      response.writeHead(429, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'quota exceeded' } }))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_PROVIDER_ERROR', message: 'quota exceeded' })
  })

  it('names the status when the error body is not JSON', async () => {
    serve((_request, response) => {
      response.writeHead(503, { 'content-type': 'text/plain' }).end('upstream down')
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MEDIA_PROVIDER_ERROR', message: 'media provider "gemini" returned HTTP 503' })
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
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('ok'))
    })

    await expect(provider({ baseURL: origin, describeModel: 'vision' }, null)
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }))
      .rejects.toMatchObject({ code: 'MISSING_CREDENTIAL' })
    expect(received).toHaveLength(0)
  })

  it('reports a canceled request as an abort, not a provider error', async () => {
    serve((_request, response) => {
      response.writeHead(200, { 'content-type': 'application/json' }).end(answer('too late'))
    })

    const controller = new AbortController()
    controller.abort()
    await expect(provider({ baseURL: origin, describeModel: 'vision' })
      .describe({ image: { mediaType: 'image/png', data: PNG_BYTES } }, controller.signal))
      .rejects.toBeInstanceOf(MediaError)
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
