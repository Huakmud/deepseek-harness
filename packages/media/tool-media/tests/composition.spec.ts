/**
 * Real Loader composition for the media route: the fixture `cordis.yml` is parsed
 * by the Loader, which owns each plugin's namespace and effects, and every
 * service below is the shipped implementation. Only the external media endpoint
 * is a loopback server, so the assertions cover what a deployment actually boots
 * rather than a hand-assembled Context.
 */

import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { once } from 'node:events'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'
import { afterEach, describe, expect, it, vi } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import Loader from '@deepseek-ai/cordis-plugin-loader'
import type { ModuleLoaderV2 } from '@deepseek-ai/cordis-plugin-loader'
import Include from '@deepseek-ai/cordis-plugin-include'
import AttachmentLocal from '@deepseek-ai/dsh-attachment-local'
import type { AttachmentStore, ImageAttachmentRef } from '@deepseek-ai/dsh-attachment'
import FileSystemLocal from '@deepseek-ai/dsh-fs-local'
import { ToolCallId } from '@deepseek-ai/dsh-llm'
import MediaRuntime from '@deepseek-ai/dsh-media'
import * as MediaOpenAi from '@deepseek-ai/dsh-media-openai'
import SystemPrompt from '@deepseek-ai/dsh-system-prompt'
import ToolRuntime from '@deepseek-ai/dsh-tools'
import * as ToolMedia from '@deepseek-ai/dsh-tool-media'
import WorkingDirectory from '@deepseek-ai/dsh-working-directory'

/** One external media request as the loopback endpoint saw it. */
interface WireCall {
  readonly path: string
  readonly authorization: string | undefined
}

/** 1x1 PNG: a valid image the provider echo path can round-trip. */
const PNG_1X1 = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAIAAACQd1PeAAAADElEQVR4nGP4z8AAAAMBAQDJ/pLvAAAAAElFTkSuQmCC', 'base64')

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

/** Boot options selecting what the fixture endpoint and section carry. */
interface ComposeOptions {
  /** Leave every model unset, as an unconfigured deployment ships. */
  models?: boolean
}

/** Boot the fixture composition over a loopback media endpoint. */
async function compose(options: ComposeOptions = {}): Promise<{ ctx: Context, calls: WireCall[], workspace: string }> {
  const calls: WireCall[] = []
  const server = createServer((request: IncomingMessage, response: ServerResponse) => {
    const chunks: Buffer[] = []
    request.on('data', (chunk: Buffer) => chunks.push(chunk))
    request.on('end', () => {
      calls.push({ path: request.url ?? '', authorization: request.headers.authorization })
      response.writeHead(200, { 'content-type': 'application/json' })
      response.end(JSON.stringify({
        choices: [{ message: { content: 'a single red pixel' } }],
        data: [{ b64_json: PNG_1X1.toString('base64') }],
        text: 'a spoken sentence',
      }))
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

  const root = await mkdtemp(join(tmpdir(), 'dsh-media-composition-'))
  cleanups.push(async () => { await rm(root, { recursive: true, force: true }) })
  const workspace = join(root, 'workspace')
  await mkdir(workspace, { recursive: true })
  await writeFile(join(workspace, 'red.png'), PNG_1X1)

  const template = await readFile(new URL('./fixtures/cordis.yml', import.meta.url), 'utf8')
  const configPath = join(root, 'cordis.yml')
  // Clearing a model field in the Models page removes the key rather than
  // writing an empty string, so the unconfigured case omits those lines.
  const composed = options.models === false
    ? template.replace(/^ {4}(describeModel|generateModel|transcribeModel):.*\n/gm, '')
    : template
      .replaceAll('{{describeModel}}', 'vision-model')
      .replaceAll('{{generateModel}}', 'draw-model')
      .replaceAll('{{transcribeModel}}', 'ears-model')
  await writeFile(configPath, composed
    .replaceAll('{{endpoint}}', `http://127.0.0.1:${address.port}`)
    .replaceAll('{{workspace}}', workspace)
    .replaceAll('{{home}}', join(root, 'home')))

  const modules = new Map<string, unknown>([
    ['@deepseek-ai/dsh-system-prompt', SystemPrompt],
    ['@deepseek-ai/dsh-tools', ToolRuntime],
    ['@deepseek-ai/dsh-fs-local', FileSystemLocal],
    ['@deepseek-ai/dsh-working-directory', WorkingDirectory],
    ['@deepseek-ai/dsh-attachment-local', AttachmentLocal],
    ['@deepseek-ai/dsh-media', MediaRuntime],
    ['@deepseek-ai/dsh-media-openai', MediaOpenAi],
    ['@deepseek-ai/dsh-tool-media', ToolMedia],
  ])
  await Promise.all([...modules.keys()].map(async (packageName) => {
    const directory = join(root, 'node_modules', ...packageName.split('/'))
    await mkdir(directory, { recursive: true })
    await writeFile(join(directory, 'package.json'), `${JSON.stringify({ name: packageName, version: '0.0.1', type: 'module' })}\n`)
  }))

  // The provider resolves its credential from the launch environment when no
  // `credentials` service is mounted, which is the shipped fallback.
  vi.stubEnv('OPENAI_API_KEY', 'composition-key')
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
  return { ctx, calls, workspace }
}

/** The composed seam services, read through `ctx.get` because the Loader owns their topology. */
function media(ctx: Context): MediaRuntime {
  const service = ctx.get('media')
  if (service === undefined) throw new Error('the composition did not mount media')
  return service
}

/** The composed tool registry. */
function tools(ctx: Context): ToolRuntime {
  const service = ctx.get('tools')
  if (service === undefined) throw new Error('the composition did not mount tools')
  return service
}

/** The composed attachment store. */
function attachments(ctx: Context): AttachmentStore {
  const service = ctx.get('attachments')
  if (service === undefined) throw new Error('the composition did not mount attachments')
  return service
}

/** One tool call from a fake calling agent rooted at the workspace. */
function call(ctx: Context, name: string, args: unknown, workspace: string) {
  return tools(ctx).execute({
    signal: new AbortController().signal,
    callId: ToolCallId(`composition-${name}`),
    name,
    arguments: args,
    agent: {
      options: {},
      session: {
        header: { cwd: workspace },
        requestHeader: () => undefined,
        deriveMessages: () => [],
        append: () => undefined,
        snapshotEvents: () => [],
      },
    } as never,
  })
}

describe('media route real Loader composition', () => {
  it('registers all three media tools and advertises every configured capability', async () => {
    const { ctx } = await compose()

    expect(media(ctx).listProviders().map(facts => facts.id)).toEqual(['openai-compatible'])
    expect(media(ctx).capabilities()).toEqual(['describe', 'generate', 'transcribe'])
    expect(tools(ctx).schemas().map(s => s.name)).toEqual(expect.arrayContaining([
      'media_describe_image',
      'media_generate_image',
      'media_transcribe_audio',
    ]))
  })

  it('describes an image through the second API and attributes the reading to it', async () => {
    const { ctx, calls, workspace } = await compose()

    const result = await call(ctx, 'media_describe_image', { path: 'red.png' }, workspace)

    expect(result.isError).toBe(false)
    expect(result.content).toContainEqual(expect.objectContaining({
      type: 'text',
      text: expect.stringContaining('a single red pixel'),
    }))
    expect(calls).toHaveLength(1)
    expect(calls[0]!.path).toBe('/chat/completions')
    expect(calls[0]!.authorization).toBe('Bearer composition-key')
  })

  it('draws an image that lands in the durable attachment store', async () => {
    const { ctx, calls, workspace } = await compose()

    const result = await call(ctx, 'media_generate_image', { prompt: 'one red pixel' }, workspace)

    expect(result.isError).toBe(false)
    // The reference the model receives must resolve in the real store.
    const image = result.content.find(block => block.type === 'image') as { attachment: ImageAttachmentRef }
    const stored = await attachments(ctx).readImage(image.attachment)
    expect(stored.ref.mediaType).toBe('image/png')
    expect(calls[0]!.path).toBe('/images/generations')
  })

  it('advertises no capability and fails a call loudly when the section configures no model', async () => {
    const { ctx, calls, workspace } = await compose({ models: false })

    // Registration follows configuration, not provider availability, so the
    // model list cannot change mid-conversation; an unconfigured route is
    // reported when the model calls it.
    expect(media(ctx).capabilities()).toEqual([])
    expect(tools(ctx).schemas().map(s => s.name)).toContain('media_describe_image')
    const result = await call(ctx, 'media_describe_image', { path: 'red.png' }, workspace)
    expect(result.isError).toBe(true)
    expect(result.error).toMatchObject({ info: { code: 'MEDIA_UNSUPPORTED_CAPABILITY' } })
    expect(calls).toHaveLength(0)
  })
})
