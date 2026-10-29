/**
 * Real Loader composition for the Gemini recognizer: the fixture `cordis.yml` is
 * parsed by the Loader, which owns the plugin's namespace and effects, and the
 * speech registry below is the shipped implementation. Only the Gemini endpoint
 * is a loopback server, so the assertions cover what a deployment actually boots
 * rather than a hand-assembled Context.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import * as Provider from '@deepseek-ai/dsh-experimental-speech-to-text-gemini'
import SpeechToText from '@deepseek-ai/dsh-experimental-speech-to-text'

/** One external request as the loopback endpoint saw it. */
interface WireCall {
  readonly path: string
  readonly apiKey: string | undefined
  readonly body: string
}

const cleanups: (() => Promise<void>)[] = []

afterEach(async () => {
  vi.unstubAllEnvs()
  for (const cleanup of cleanups.splice(0).reverse()) await cleanup()
})

/** Import mapped source modules without claiming support for Node's HMR internals. */
function sourceModuleLoader(importModule: (specifier: string) => Promise<unknown>): ModuleLoaderV2 {
  return {
    version: 'v2',
    import: importModule,
    loadCache: new Map(),
    register(): never { throw new Error('unexpected module hook registration') },
    getOrCreateModuleJob(): never { throw new Error('unexpected module job creation') },
    resolveSync(): never { throw new Error('unexpected synchronous module resolution') },
    load(): never { throw new Error('unexpected module load') },
  }
}

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

/** Boot the fixture composition over a loopback Gemini endpoint. */
async function compose(): Promise<{ ctx: Context; calls: WireCall[] }> {
  const calls: WireCall[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      calls.push({
        path: request.url ?? '',
        apiKey: request.headers['x-goog-api-key'] as string | undefined,
        body: Buffer.concat(chunks).toString('utf8'),
      })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({ candidates: [{ content: { parts: [{ text: 'a spoken sentence' }] } }] }))
    })
  })
  server.listen(0, '127.0.0.1')
  await once(server, 'listening')
  cleanups.push(async () => {
    server.closeAllConnections()
    await new Promise<void>((resolve) => { server.close(() => { resolve() }) })
  })
  const address = server.address()
  if (address === null || typeof address === 'string') throw new Error('expected an allocated loopback listener')

  const root = await mkdtemp(join(tmpdir(), 'dsh-speech-composition-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })

  const template = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  const configPath = join(root, 'cordis.yml')
  await writeFile(configPath, template
    .replaceAll('{{endpoint}}', `http://127.0.0.1:${address.port}`)
    .replaceAll('{{model}}', 'gemini-3.8-flash'))

  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-experimental-speech-to-text', SpeechToText],
    ['@deepseek-ai/dsh-experimental-speech-to-text-gemini', Provider],
  ])
  await Promise.all([...modules.keys()].map(async (packageName) => {
    const directory = join(root, 'node_modules', ...packageName.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.0.1', type: 'module' })}\n`)
  }))

  // The provider resolves its credential from the launch environment when no
  // `credentials` service is mounted, which is the shipped fallback.
  vi.stubEnv('GEMINI_API_KEY', 'composition-key')
  const ctx = new Context()
  cleanups.push(async () => { await ctx.fiber.dispose() })
  ctx.baseUrl = pathToFileURL(root).href + '/'
  await ctx.plugin(Loader)
  ctx.loader.builtins.include = Include
  ctx.loader.internal = sourceModuleLoader(async (specifier) => {
    if (!modules.has(specifier)) throw new Error(`unexpected Loader import: ${specifier}`)
    return modules.get(specifier)
  })
  await ctx.loader.create({ name: 'cordis:include', config: { path: pathToFileURL(configPath).href } })
  await ctx.loader.await()
  return { ctx, calls }
}

it('boots the recognizer through the Loader and transcribes a recording', async () => {
  const { ctx, calls } = await compose()
  const speech = ctx.get('speechToText')!
  expect(speech.listProviders()).toMatchObject([{ id: 'gemini-speech', location: 'cloud' }])
  const transcript = await speech.transcribe(speech.resolve({ audio: wave(1), language: 'auto' }), AbortSignal.timeout(10_000))
  expect(transcript.text).toBe('a spoken sentence')
  // The synthetic recording rounds to whole samples, so the duration is approximate.
  expect(transcript.audioSeconds).toBeCloseTo(1, 2)
  expect(calls).toHaveLength(1)
  expect(calls[0]?.path).toContain('/models/gemini-3.8-flash:generateContent')
  expect(calls[0]?.apiKey).toBe('composition-key')
  expect(calls[0]?.body).toContain('audio/wav')
})
