/** The Gemini recognizer registers, routes a recording, and withdraws cleanly. */
import { Context } from '@deepseek-ai/cordis'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'
import { afterEach, expect, it, vi } from 'vitest'
import * as Provider from '../src/index.ts'

afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs() })

/** One canonical 16 kHz mono PCM16 WAV recording of the requested duration. */
function wave(seconds: number): Uint8Array {
  const samples = Math.round(16_000 * seconds)
  const bytes = new Uint8Array(44 + samples * 2)
  const view = new DataView(bytes.buffer)
  const ascii = (offset: number, text: string): void => {
    for (let index = 0; index < text.length; index += 1) view.setUint8(offset + index, text.charCodeAt(index))
  }
  ascii(0, 'RIFF'); view.setUint32(4, bytes.length - 8, true); ascii(8, 'WAVE')
  ascii(12, 'fmt '); view.setUint32(16, 16, true); view.setUint16(20, 1, true); view.setUint16(22, 1, true)
  view.setUint32(24, 16_000, true); view.setUint32(28, 32_000, true); view.setUint16(32, 2, true); view.setUint16(34, 16, true)
  ascii(36, 'data'); view.setUint32(40, bytes.length - 44, true)
  return bytes
}

/**
 * Compose the registry with the provider mounted over the shipped defaults.
 * @param config - optional overrides validated by the package's own schema.
 * @param prepare - optional step that installs services before the provider mounts.
 */
async function mount(config: Parameters<typeof Provider.Config>[0] = {}, prepare?: (ctx: Context) => void) {
  const ctx = new Context()
  prepare?.(ctx)
  await ctx.plugin(SpeechToText, { defaultProvider: 'gemini-speech', language: 'auto' })
  const fiber = ctx.plugin(Provider, config)
  await fiber
  return { ctx, fiber, speech: ctx.get('speechToText')! }
}

it('lists one cloud recognizer and resolves the default selection to it', async () => {
  const { ctx, speech } = await mount()
  try {
    expect(speech.listProviders()).toMatchObject([{ id: 'gemini-speech', name: 'Gemini', location: 'cloud' }])
    // A provider with no preparation owns no download, so the picker may record at once.
    expect(speech.snapshot().providers[0]?.preparation).toEqual({ phase: 'ready' })
    expect(speech.resolve({ audio: wave(0.1) }).provider.info.id).toBe('gemini-speech')
  } finally { await ctx.fiber.dispose() }
})

it('forwards the recording to the model and returns its text', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'hello there' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount({ model: 'gemini-3.8-flash' })
  try {
    const transcript = await speech.transcribe(speech.resolve({ audio: wave(0.5), language: 'en' }), AbortSignal.timeout(5_000))
    expect(transcript).toMatchObject({ text: 'hello there', audioSeconds: 0.5 })
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect(init.method).toBe('POST')
    // A credential rides this request, so a redirect must never be followed.
    expect(init.redirect).toBe('error')
    const body = JSON.parse(init.body as string) as { contents: { parts: { inlineData?: { mimeType: string } }[] }[] }
    expect(body.contents[0]?.parts[0]?.inlineData?.mimeType).toBe('audio/wav')
  } finally { await ctx.fiber.dispose() }
})

it('names the requested language in the instruction instead of sending its code', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'مرحبا' }] } }],
  }), { status: 200, headers: { 'content-type': 'application/json' } }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount()
  try {
    const transcript = await speech.transcribe(speech.resolve({ audio: wave(0.3), language: 'ar' }), AbortSignal.timeout(5_000))
    expect(transcript.text).toBe('مرحبا')
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    const body = JSON.parse(init.body as string) as { contents: { parts: { text?: string }[] }[] }
    expect(body.contents[0]?.parts[1]?.text).toBe('Transcribe this recording verbatim in Arabic. Output only the transcript text.')
  } finally { await ctx.fiber.dispose() }
})

it('offers the languages the picker lists, including Arabic', async () => {
  const { ctx, speech } = await mount()
  try {
    expect(speech.listProviders()[0]?.languages).toContain('ar')
  } finally { await ctx.fiber.dispose() }
})

it.each([
  ['a null body', null],
  ['a body without candidates', {}],
  ['a null candidate', { candidates: [null] }],
  ['a candidate without content', { candidates: [{}] }],
  ['a null content', { candidates: [{ content: null }] }],
  ['content without parts', { candidates: [{ content: {} }] }],
  ['a null part', { candidates: [{ content: { parts: [null] } }] }],
  ['a part without text', { candidates: [{ content: { parts: [{ inlineData: {} }] } }] }],
])('reports no transcript for an upstream payload with %s', async (_label, payload) => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify(payload), { status: 200 })))
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount()
  try {
    const transcript = await speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000))
    expect(transcript.text).toBe('')
  } finally { await ctx.fiber.dispose() }
})

it('refuses an endpoint that is not an absolute URL', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount({ baseURL: 'not a url' })
  try {
    await expect(speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000)))
      .rejects.toThrow('is not an absolute URL')
    expect(fetchMock).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('refuses an empty transcription model', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount({ model: '' })
  try {
    await expect(speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000)))
      .rejects.toThrow('model is empty')
    expect(fetchMock).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('resolves the key through the credentials service when one is available', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  const resolve = vi.fn(async () => ({ value: 'service-key' }))
  const { ctx, speech } = await mount({}, (context) => { context.provide('credentials', { resolve }) })
  try {
    await speech.transcribe(speech.resolve({ audio: wave(0.2), language: 'en' }), AbortSignal.timeout(5_000))
    expect(resolve).toHaveBeenCalledTimes(1)
    const [, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('service-key')
  } finally { await ctx.fiber.dispose() }
})

it('falls back to the shipped endpoint, id, and key reference when settings are blank', async () => {
  const fetchMock = vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: { parts: [{ text: 'ok' }] } }],
  }), { status: 200 }))
  vi.stubGlobal('fetch', fetchMock)
  vi.stubEnv('GEMINI_API_KEY', 'env-key')
  const { ctx, speech } = await mount({ providerId: '', apiKeyEnv: '', baseURL: '' })
  try {
    expect(speech.listProviders()[0]?.id).toBe('gemini-speech')
    await speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000))
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit]
    expect(url).toBe('https://generativelanguage.googleapis.com/v1beta/models/gemini-3.8-flash:generateContent')
    expect((init.headers as Record<string, string>)['x-goog-api-key']).toBe('env-key')
  } finally { await ctx.fiber.dispose() }
})

it('reports the status when the upstream error body cannot be read', async () => {
  const unreadable = {
    ok: false,
    status: 502,
    text: () => Promise.reject(new Error('stream closed')),
  } as unknown as Response
  vi.stubGlobal('fetch', vi.fn(async () => unreadable))
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount()
  try {
    await expect(speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000)))
      .rejects.toThrow('502')
  } finally { await ctx.fiber.dispose() }
})

it('reports an empty transcript when the model returns no parts', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response(JSON.stringify({
    candidates: [{ content: {}, finishReason: 'STOP' }],
  }), { status: 200 })))
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount()
  try {
    expect((await speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000))).text).toBe('')
  } finally { await ctx.fiber.dispose() }
})

it('reports the upstream failure instead of a partial transcript', async () => {
  vi.stubGlobal('fetch', vi.fn(async () => new Response('quota exceeded', { status: 429 })))
  vi.stubEnv('GEMINI_API_KEY', 'test-key')
  const { ctx, speech } = await mount()
  try {
    await expect(speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000)))
      .rejects.toThrow('429')
  } finally { await ctx.fiber.dispose() }
})

it('refuses to call the API without a credential', async () => {
  const fetchMock = vi.fn()
  vi.stubGlobal('fetch', fetchMock)
  const { ctx, speech } = await mount({ apiKeyEnv: 'A_REFERENCE_THAT_IS_NOT_SET' })
  try {
    await expect(speech.transcribe(speech.resolve({ audio: wave(0.2) }), AbortSignal.timeout(5_000)))
      .rejects.toThrow('A_REFERENCE_THAT_IS_NOT_SET')
    expect(fetchMock).not.toHaveBeenCalled()
  } finally { await ctx.fiber.dispose() }
})

it('withdraws the recognizer when its fiber is disposed', async () => {
  const { ctx, fiber, speech } = await mount()
  try {
    expect(speech.listProviders()).toHaveLength(1)
    await fiber.dispose()
    expect(speech.listProviders()).toEqual([])
  } finally { await ctx.fiber.dispose() }
})
