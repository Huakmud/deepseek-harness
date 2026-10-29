import { describe, expect, it } from 'vitest'
import { Context } from '@deepseek-ai/cordis'
import MediaRuntime, {
  MediaError,
  type MediaCapability,
  type MediaDescribeResult,
  type MediaGenerateResult,
  type MediaProvider,
  type MediaTranscribeResult,
} from '@deepseek-ai/dsh-media'

const available = true
const unavailable = false

function describeResult(marker: string): MediaDescribeResult {
  return { text: marker, provider: marker, model: `${marker}-model` }
}

function generateResult(marker: string): MediaGenerateResult {
  return { data: new Uint8Array([1, 2, 3]), mediaType: 'image/png', provider: marker, model: `${marker}-model` }
}

function transcribeResult(marker: string): MediaTranscribeResult {
  return { text: marker, language: 'en', provider: marker, model: `${marker}-model` }
}

/** A provider whose every operation the caller asked for answers with its own id. */
function makeProvider(
  id: string,
  usable: boolean,
  operations: readonly MediaCapability[] = ['describe'],
): MediaProvider {
  const provider: MediaProvider = { id, capabilities: operations, available: () => usable }
  if (operations.includes('describe')) provider.describe = () => Promise.resolve(describeResult(id))
  if (operations.includes('generate')) provider.generate = () => Promise.resolve(generateResult(id))
  if (operations.includes('transcribe')) provider.transcribe = () => Promise.resolve(transcribeResult(id))
  return provider
}

const image = { data: new Uint8Array([0x89, 0x50, 0x4e, 0x47]), mediaType: 'image/png' as const }

async function mountMedia(config: { mediaProvider?: string } = {}): Promise<{ ctx: Context; media: MediaRuntime }> {
  const ctx = new Context()
  await ctx.plugin(MediaRuntime, config)
  return { ctx, media: ctx.media }
}

describe('MediaRuntime registration', () => {
  it('registers a provider and removes it through the returned disposer', async () => {
    const { media } = await mountMedia()
    const dispose = media.registerProvider(makeProvider('alpha', available))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })

    dispose()
    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))
  })

  it('rejects a duplicate provider id before registering anything', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available, ['describe']))

    expect(() => media.registerProvider(makeProvider('alpha', available, ['generate'])))
      .toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_DUPLICATE' }))
    expect(media.listProviders()).toEqual([{ id: 'alpha', capabilities: ['describe'], available: true }])
  })

  it('registers a provider that has no configured operation as dormant', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available, []))

    // The settings section starts empty, so a mounted provider may advertise
    // nothing; it is registered but unreachable.
    expect(media.listProviders()).toEqual([{ id: 'alpha', capabilities: [], available: true }])
    expect(media.capabilities()).toEqual([])
    await expect(media.describe({ image: { data: new Uint8Array([1]), mediaType: 'image/png' }, prompt: 'x' }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))
  })

  it('disposes a provider registration when the contributing fiber is disposed (HMR safety)', async () => {
    const { ctx, media } = await mountMedia()
    const fiber = await ctx.plugin(Object.assign((inner: Context) => {
      inner.media.registerProvider(makeProvider('alpha', available))
    }, { inject: ['media'] }))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })

    await fiber.dispose()
    expect(media.listProviders()).toEqual([])
    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))
  })

  it('emits media/providers-updated on registration and on disposal', async () => {
    const { ctx, media } = await mountMedia()
    const seen: number[] = []
    ctx.on('media/providers-updated', () => { seen.push(media.listProviders().length) })

    const dispose = media.registerProvider(makeProvider('alpha', available))
    dispose()

    expect(seen).toEqual([1, 0])
  })

  it('contains a throwing media/providers-updated listener instead of failing the commit', async () => {
    const { ctx, media } = await mountMedia()
    ctx.on('media/providers-updated', () => { throw new Error('observer exploded') })

    expect(() => media.registerProvider(makeProvider('alpha', available))).not.toThrow()
    expect(media.listProviders()).toHaveLength(1)
    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })
  })

  it('returns detached provider facts from listProviders', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available, ['describe']))

    const facts = media.listProviders()
    ;(facts[0]!.capabilities as MediaCapability[]).push('generate')

    expect(media.listProviders()).toEqual([{ id: 'alpha', capabilities: ['describe'], available: true }])
    expect(media.capabilities()).toEqual(['describe'])
  })
})

describe('MediaRuntime provider selection', () => {
  it('throws MEDIA_PROVIDER_UNAVAILABLE when nothing is registered', async () => {
    const { media } = await mountMedia()

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))
  })

  it('throws MEDIA_PROVIDER_UNAVAILABLE when providers exist but none are usable', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', unavailable))

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))
  })

  it('throws MEDIA_PROVIDER_CONFIGURED_MISSING for a configured id that is not registered', async () => {
    const { media } = await mountMedia({ mediaProvider: 'beta' })
    media.registerProvider(makeProvider('alpha', available))

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_CONFIGURED_MISSING' }))
  })

  it('throws MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE for a configured id that is unusable', async () => {
    const { media } = await mountMedia({ mediaProvider: 'alpha' })
    media.registerProvider(makeProvider('alpha', unavailable))

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE' }))
  })

  it('throws MEDIA_UNSUPPORTED_CAPABILITY for a configured id lacking the operation', async () => {
    const { media } = await mountMedia({ mediaProvider: 'alpha' })
    media.registerProvider(makeProvider('alpha', available, ['generate']))

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_UNSUPPORTED_CAPABILITY' }))
    await expect(media.generate({ prompt: 'a castle' })).resolves.toMatchObject({ provider: 'alpha' })
  })

  it('throws MEDIA_PROVIDER_AMBIGUOUS rather than picking by registration order', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available))
    media.registerProvider(makeProvider('beta', available))

    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_AMBIGUOUS' }))
  })

  it('runs the configured provider even when another usable provider is registered', async () => {
    const { media } = await mountMedia({ mediaProvider: 'beta' })
    media.registerProvider(makeProvider('alpha', available))
    media.registerProvider(makeProvider('beta', available))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'beta' })
  })

  it('ignores unusable providers when auto-selecting', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available))
    media.registerProvider(makeProvider('beta', unavailable))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })
  })

  it('does not let registration order change auto-selection', async () => {
    const first = await mountMedia()
    first.media.registerProvider(makeProvider('alpha', unavailable))
    first.media.registerProvider(makeProvider('beta', available))
    await expect(first.media.describe({ image })).resolves.toMatchObject({ text: 'beta' })

    const second = await mountMedia()
    second.media.registerProvider(makeProvider('beta', available))
    second.media.registerProvider(makeProvider('alpha', unavailable))
    await expect(second.media.describe({ image })).resolves.toMatchObject({ text: 'beta' })
  })

  it('selects per operation rather than per provider', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('vision', available, ['describe']))
    media.registerProvider(makeProvider('painter', available, ['generate']))
    media.registerProvider(makeProvider('ears', available, ['transcribe']))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'vision' })
    await expect(media.generate({ prompt: 'a castle' })).resolves.toMatchObject({ provider: 'painter' })
    await expect(media.transcribe({ data: new Uint8Array([1]), mediaType: 'audio/ogg' }))
      .resolves.toMatchObject({ text: 'ears' })
  })

  it('treats an empty configured id as auto-selection', async () => {
    const { media } = await mountMedia({ mediaProvider: '' })
    media.registerProvider(makeProvider('alpha', available))

    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })
  })
})

describe('MediaRuntime capabilities', () => {
  it('reports only operations a usable provider can serve', async () => {
    const { media } = await mountMedia()
    expect(media.capabilities()).toEqual([])

    media.registerProvider(makeProvider('alpha', available, ['describe', 'generate']))
    media.registerProvider(makeProvider('beta', unavailable, ['transcribe']))

    expect(media.capabilities()).toEqual(['describe', 'generate'])
  })

  it('reports operations in canonical order regardless of registration order', async () => {
    const { media } = await mountMedia()
    media.registerProvider(makeProvider('alpha', available, ['transcribe']))
    media.registerProvider(makeProvider('beta', available, ['generate']))
    media.registerProvider(makeProvider('gamma', available, ['describe']))

    expect(media.capabilities()).toEqual(['describe', 'generate', 'transcribe'])
  })

  it('reflects a provider becoming usable without re-registration', async () => {
    const { media } = await mountMedia()
    let usable = false
    media.registerProvider({
      id: 'alpha',
      capabilities: ['describe'],
      available: () => usable,
      describe: () => Promise.resolve(describeResult('alpha')),
    })

    expect(media.capabilities()).toEqual([])
    await expect(media.describe({ image })).rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_UNAVAILABLE' }))

    usable = true
    expect(media.capabilities()).toEqual(['describe'])
    await expect(media.describe({ image })).resolves.toMatchObject({ text: 'alpha' })
  })
})

describe('MediaRuntime dispatch', () => {
  it('forwards the request and the abort signal to the resolved provider', async () => {
    const { media } = await mountMedia()
    const seen: { request: unknown; signal: AbortSignal | undefined }[] = []
    media.registerProvider({
      id: 'alpha',
      capabilities: ['describe'],
      available: () => available,
      describe: (request, signal) => {
        seen.push({ request, signal })
        return Promise.resolve(describeResult('alpha'))
      },
    })

    const controller = new AbortController()
    const request = { image, prompt: 'read the sign', maxOutputTokens: 64 }
    await media.describe(request, controller.signal)

    expect(seen).toEqual([{ request, signal: controller.signal }])
  })

  it('propagates a provider failure unchanged', async () => {
    const { media } = await mountMedia()
    media.registerProvider({
      id: 'alpha',
      capabilities: ['generate'],
      available: () => available,
      generate: () => Promise.reject(new MediaError('quota exhausted', 'MEDIA_PROVIDER_ERROR')),
    })

    await expect(media.generate({ prompt: 'a castle' }))
      .rejects.toThrow(expect.objectContaining({ code: 'MEDIA_PROVIDER_ERROR', message: 'quota exhausted' }))
  })
})

describe('MediaError', () => {
  it('is a HarnessError carrying its code', () => {
    const error = new MediaError('boom', 'MEDIA_CONFIG_INVALID')

    expect(error.code).toBe('MEDIA_CONFIG_INVALID')
    expect(error.name).toBe('MediaError')
  })
})

describe('live provider selection', () => {
  it('applies a saved selection to the next operation without remounting the service', async () => {
    const { liveConfig } = await import('../../../settings/settings/tests/live-config.ts')
    const ctx = new Context()
    try {
      const live = await liveConfig(ctx, MediaRuntime, { mediaProvider: 'first' })
      const fiber = live.fiber
      for (const id of ['first', 'second']) ctx.media.registerProvider(makeProvider(id, available))

      await expect(ctx.media.describe({ image })).resolves.toMatchObject({ text: 'first' })

      await live.update({ mediaProvider: 'second' })

      expect(Object.is(live.entry.fiber, fiber)).toBe(true)
      await expect(ctx.media.describe({ image })).resolves.toMatchObject({ text: 'second' })
    } finally { await ctx.fiber.dispose() }
  })
})
