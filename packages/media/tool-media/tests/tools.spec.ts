/**
 * The three media tools over the REAL local filesystem, attachment store, and
 * `ctx.media` seam, with only the network boundary replaced by a loopback HTTP
 * fixture: what a model gets back from each tool, and every refusal arm.
 */

import { provideWorkingDirectoryFixture } from '@deepseek-ai/dsh-agent-loop-testkit'
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, onTestFinished, vi } from 'vitest'
import { createServer, type IncomingMessage, type Server, type ServerResponse } from 'node:http'
import { mkdtemp, rm, writeFile } from 'node:fs/promises'
import type { AddressInfo } from 'node:net'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { Context } from '@deepseek-ai/cordis'
import LocalAttachmentStore from '@deepseek-ai/dsh-attachment-local'
import type { ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import LocalFileSystem from '@deepseek-ai/dsh-fs-local'
import MediaRuntime from '@deepseek-ai/dsh-media'
import * as MediaOpenAi from '@deepseek-ai/dsh-media-openai'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMedia from '@deepseek-ai/dsh-tool-media'

/** 1x1 red PNG (valid signature, IHDR, IDAT). */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

/** Minimal bytes carrying the Ogg container signature the audio sniffer recognizes. */
const OGG_BYTES = Buffer.from('OggS\x00\x02\x00\x00\x00\x00', 'latin1')

const testToolSignal = new AbortController().signal

/** One request the fixture received. */
interface Received {
  readonly url: string
  readonly headers: IncomingMessage['headers']
  readonly body: string
}

type Handler = (received: Received, response: ServerResponse) => void

let server: Server
let origin: string
let handler: Handler = (_received, response) => { response.writeHead(500).end() }
const received: Received[] = []

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

/** Answer one chat completion with a fixed description. */
function describeAs(text: string): Handler {
  return (_received, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ choices: [{ message: { content: text } }] }))
  }
}

/** Answer one image generation with a base64 PNG. */
function drawPng(): Handler {
  return (_received, response) => {
    response.writeHead(200, { 'content-type': 'application/json' })
      .end(JSON.stringify({ data: [{ b64_json: PNG_1X1.toString('base64') }] }))
  }
}

let dir: string
let home: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'dsh-tool-media-'))
  home = await mkdtemp(join(tmpdir(), 'dsh-tool-media-home-'))
  received.length = 0
})
afterEach(async () => {
  vi.unstubAllEnvs()
  await rm(dir, { recursive: true, force: true })
  await rm(home, { recursive: true, force: true })
})

interface SetupOptions {
  /** Operations the OpenAI-compatible provider advertises. */
  provider?: 'all' | 'describe' | 'generate' | 'transcribe' | 'none'
  /** Tool-plugin config overrides. */
  toolMedia?: ToolMedia.Config
  /** Mount the attachment store; a deployment may lack one. */
  attachments?: boolean
  /** Mount the OpenAI-compatible provider plugin. */
  mountProvider?: boolean
}

/** Provider models per requested operation set. */
function modelsFor(provider: NonNullable<SetupOptions['provider']>): Record<string, string> {
  const describe = provider === 'all' || provider === 'describe'
  const generate = provider === 'all' || provider === 'generate'
  const transcribe = provider === 'all' || provider === 'transcribe'
  return {
    ...describe ? { describeModel: 'vision-model' } : {},
    ...generate ? { generateModel: 'draw-model' } : {},
    ...transcribe ? { transcribeModel: 'ears-model' } : {},
  }
}

/** Boot the real services plus the media stack over one loopback endpoint. */
async function setup(options: SetupOptions = {}) {
  // The provider resolves its credential from the launch environment when no
  // `credentials` service is mounted, which is the shipped fallback.
  vi.stubEnv('OPENAI_API_KEY', 'test-key')
  const ctx = new Context()
  onTestFinished(async () => { await ctx.fiber.dispose() })
  provideWorkingDirectoryFixture(ctx, dir)
  await ctx.plugin(SystemPrompt)
  await ctx.plugin(ToolRuntime, { mode: 'native' })
  await ctx.plugin(LocalFileSystem, { cwd: dir })
  if (options.attachments !== false) await ctx.plugin(LocalAttachmentStore, { dshHome: home })
  await ctx.plugin(MediaRuntime, { mediaProvider: MediaOpenAi.OPENAI_MEDIA_PROVIDER_ID })
  if (options.mountProvider !== false) {
    await ctx.plugin(MediaOpenAi, {
      baseURL: origin,
      apiKeyEnv: 'OPENAI_API_KEY',
      ...modelsFor(options.provider ?? 'all'),
    })
  }
  await ctx.plugin(ToolMedia, options.toolMedia ?? {})
  return ctx
}

/** A fake calling agent whose Session exposes the events a test published. */
function agent(events: readonly unknown[] = []): object {
  return {
    options: {},
    session: {
      header: { cwd: dir },
      requestHeader: () => undefined,
      deriveMessages: () => [],
      append: () => undefined,
      snapshotEvents: () => events,
    },
  }
}

let callCounter = 0
function call(ctx: Context, name: string, args: unknown, events: readonly unknown[] = []) {
  return ctx.tools.execute({
    signal: testToolSignal,
    callId: ToolCallId(`media-call-${++callCounter}`),
    name,
    arguments: args,
    agent: agent(events) as never,
  })
}

/** One `user/message` event carrying the given content blocks. */
function userMessage(content: readonly unknown[]): unknown {
  return { type: 'user/message', data: { content } }
}

/** The concatenated text blocks of one tool result. */
function text(result: { content: { type: string, text?: string }[] }): string {
  return result.content.filter(block => block.type === 'text').map(block => block.text).join('')
}

describe('media_describe_image', () => {
  it('describes an image by path and attributes the reading to another model', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    serve(describeAs('a 1x1 red square'))
    const ctx = await setup()

    const result = await call(ctx, 'media_describe_image', { path: 'red.png' })

    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('a 1x1 red square')
    expect(output).toContain('openai-compatible/vision-model')
    // The calling model must not be able to mistake this for its own observation.
    expect(output).toContain('you did not see it yourself')
    expect(received[0]?.url).toBe('/chat/completions')
  })

  it('describes an image the conversation carries by attachment id', async () => {
    const ctx = await setup()
    const stored = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'carried.png' })
    serve(describeAs('a red square from the conversation'))
    const events = [userMessage([{ type: 'image', attachment: stored }])]

    const result = await call(ctx, 'media_describe_image', { attachmentId: stored.attachmentId }, events)

    expect(result.isError).toBe(false)
    expect(text(result)).toContain('a red square from the conversation')
  })

  it('refuses an attachment id the conversation does not reference', async () => {
    const ctx = await setup()
    const stored = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'other.png' })
    serve(describeAs('never asked'))

    const result = await call(ctx, 'media_describe_image', { attachmentId: stored.attachmentId })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('does not reference an image with that id')
    expect(received).toHaveLength(0)
  })

  it('forwards the caller prompt to the vision model', async () => {
    await writeFile(join(dir, 'sign.png'), PNG_1X1)
    serve(describeAs('says EXIT'))
    const ctx = await setup()

    await call(ctx, 'media_describe_image', { path: 'sign.png', prompt: 'read the sign' })

    expect(received[0]?.body).toContain('read the sign')
  })

  it('refuses when neither or both sources are named', async () => {
    const ctx = await setup()

    expect((await call(ctx, 'media_describe_image', {})).isError).toBe(true)
    expect((await call(ctx, 'media_describe_image', { path: 'a.png', attachmentId: 'sha256:00' })).isError).toBe(true)
    expect(received).toHaveLength(0)
  })

  it('refuses a file whose bytes are not an image, without calling the provider', async () => {
    await writeFile(join(dir, 'notes.png'), 'plain text, not a picture')
    const ctx = await setup()

    const result = await call(ctx, 'media_describe_image', { path: 'notes.png' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('not a supported image format')
    expect(received).toHaveLength(0)
  })

  it('refuses a file whose extension disagrees with its bytes', async () => {
    await writeFile(join(dir, 'mislabelled.jpg'), PNG_1X1)
    const ctx = await setup()

    const result = await call(ctx, 'media_describe_image', { path: 'mislabelled.jpg' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('rename the file')
    expect(received).toHaveLength(0)
  })

  it('reports the missing provider rather than returning a description', async () => {
    await writeFile(join(dir, 'red.png'), PNG_1X1)
    const ctx = await setup({ provider: 'generate' })

    const result = await call(ctx, 'media_describe_image', { path: 'red.png' })

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'MEDIA_UNSUPPORTED_CAPABILITY' } })
    expect(received).toHaveLength(0)
  })
})

describe('media_generate_image', () => {
  it('commits the drawn image and returns it as an image block', async () => {
    serve(drawPng())
    const ctx = await setup()

    const result = await call(ctx, 'media_generate_image', { prompt: 'a red square' })

    expect(result.isError).toBe(false)
    const image = result.content.find(block => block.type === 'image')
    expect(image).toBeDefined()
    expect(text(result)).toContain('openai-compatible/draw-model')
    expect(text(result)).toContain('1x1 px')
    // The committed reference must resolve in the real store.
    const ref = (image as { attachment: ImageAttachmentRef }).attachment
    await expect(ctx.attachments.readImage(ref)).resolves.toMatchObject({ ref: { mediaType: 'image/png' } })
  })

  it('forwards a requested size to the provider', async () => {
    serve(drawPng())
    const ctx = await setup()

    await call(ctx, 'media_generate_image', { prompt: 'wide', size: '1536x1024' })

    expect(received[0]?.body).toContain('1536x1024')
  })

  it('conditions the drawing on a reference path', async () => {
    await writeFile(join(dir, 'base.png'), PNG_1X1)
    serve(drawPng())
    const ctx = await setup()

    const result = await call(ctx, 'media_generate_image', { prompt: 'make it blue', referencePath: 'base.png' })

    expect(result.isError).toBe(false)
    expect(received).toHaveLength(1)
  })

  it('conditions the drawing on an image the conversation carries', async () => {
    serve(drawPng())
    const ctx = await setup()
    const stored = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'base.png' })
    const events = [userMessage([{ type: 'image', attachment: stored }])]

    const result = await call(
      ctx,
      'media_generate_image',
      { prompt: 'make it blue', referenceAttachmentId: stored.attachmentId },
      events,
    )

    expect(result.isError).toBe(false)
    expect(received).toHaveLength(1)
  })

  it('refuses when both reference sources are named', async () => {
    serve(drawPng())
    const ctx = await setup()
    const stored = await ctx.attachments.saveImage({ data: PNG_1X1, mediaType: 'image/png', name: 'base.png' })

    const result = await call(ctx, 'media_generate_image', {
      prompt: 'make it blue',
      referenceAttachmentId: stored.attachmentId,
      referencePath: 'base.png',
    })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('exactly one of attachmentId or path')
    expect(received).toHaveLength(0)
  })

  it('refuses an empty prompt before reaching the provider', async () => {
    serve(drawPng())
    const ctx = await setup()

    const result = await call(ctx, 'media_generate_image', { prompt: '   ' })

    expect(result.isError).toBe(true)
    expect(received).toHaveLength(0)
  })

  it('reports the missing attachment store instead of losing the image', async () => {
    serve(drawPng())
    const ctx = await setup({ attachments: false })

    const result = await call(ctx, 'media_generate_image', { prompt: 'a red square' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('attachment store')
  })

  it('reports a provider failure rather than committing nothing silently', async () => {
    serve((_received, response) => {
      response.writeHead(400, { 'content-type': 'application/json' })
        .end(JSON.stringify({ error: { message: 'prompt rejected' } }))
    })
    const ctx = await setup()

    const result = await call(ctx, 'media_generate_image', { prompt: 'a red square' })

    expect(result.isError).toBe(true)
    expect(text(result)).toContain('prompt rejected')
    expect(result.error).toMatchObject({ info: { code: 'MEDIA_PROVIDER_ERROR' } })
    expect(result.content.some(block => block.type === 'image')).toBe(false)
  })
})

describe('media_transcribe_audio', () => {
  it('transcribes a recording the conversation carries', async () => {
    const ctx = await setup()
    const stored = await ctx.attachments.saveFile({ data: OGG_BYTES, name: 'note.ogg' })
    serve((_received, response) => {
      response.writeHead(200, { 'content-type': 'application/json' })
        .end(JSON.stringify({ text: 'remember the milk', language: 'en' }))
    })
    const events = [userMessage([{ type: 'file', attachment: stored }])]

    const result = await call(ctx, 'media_transcribe_audio', { attachmentId: stored.attachmentId }, events)

    expect(result.isError).toBe(false)
    const output = text(result)
    expect(output).toContain('remember the milk')
    expect(output).toContain('openai-compatible/ears-model')
    expect(received[0]?.url).toBe('/audio/transcriptions')
  })

  it('refuses a path whose bytes are not audio', async () => {
    await writeFile(join(dir, 'recording.ogg'), 'not audio')
    const ctx = await setup()

    const result = await call(ctx, 'media_transcribe_audio', { path: 'recording.ogg' })

    expect(result.isError).toBe(true)
    expect(received).toHaveLength(0)
  })

  it('reports the missing provider rather than returning a transcript', async () => {
    const ctx = await setup({ provider: 'describe' })
    const stored = await ctx.attachments.saveFile({ data: OGG_BYTES, name: 'a.ogg' })
    const events = [userMessage([{ type: 'file', attachment: stored }])]

    const result = await call(ctx, 'media_transcribe_audio', { attachmentId: stored.attachmentId }, events)

    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'MEDIA_UNSUPPORTED_CAPABILITY' } })
  })
})

describe('tool registration gates', () => {
  it('registers all three tools by default and none of the disabled ones', async () => {
    const ctx = await setup()

    expect(ctx.tools.get('media_describe_image')).toBeDefined()
    expect(ctx.tools.get('media_generate_image')).toBeDefined()
    expect(ctx.tools.get('media_transcribe_audio')).toBeDefined()
  })

  it('omits a tool the config disables', async () => {
    const ctx = await setup({ toolMedia: { generate: false } })

    expect(ctx.tools.get('media_describe_image')).toBeDefined()
    expect(ctx.tools.get('media_generate_image')).toBeUndefined()
  })

  it('unregisters every tool when the plugin fiber is disposed (HMR safety)', async () => {
    const ctx = new Context()
    onTestFinished(async () => { await ctx.fiber.dispose() })
    provideWorkingDirectoryFixture(ctx, dir)
    await ctx.plugin(SystemPrompt)
    await ctx.plugin(ToolRuntime)
    await ctx.plugin(LocalFileSystem, { cwd: dir })
    await ctx.plugin(MediaRuntime, { mediaProvider: MediaOpenAi.OPENAI_MEDIA_PROVIDER_ID })
    await ctx.plugin(MediaOpenAi, { baseURL: origin, apiKeyEnv: 'OPENAI_API_KEY', ...modelsFor('all') })
    const fiber = await ctx.plugin(ToolMedia)

    expect(ctx.tools.get('media_describe_image')).toBeDefined()

    await fiber.dispose()

    expect(ctx.tools.get('media_describe_image')).toBeUndefined()
    expect(ctx.tools.get('media_generate_image')).toBeUndefined()
    expect(ctx.tools.get('media_transcribe_audio')).toBeUndefined()
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
      resolve({ url: request.url ?? '/', headers: request.headers, body: Buffer.concat(chunks).toString('utf8') })
    })
  })
}

/** Normalize an unknown fixture failure for `ServerResponse.destroy`. */
function asError(error: unknown): Error {
  return error instanceof Error ? error : new Error(String(error))
}
