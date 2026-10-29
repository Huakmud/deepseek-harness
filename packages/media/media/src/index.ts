/**
 * Service Definition for the media capability seam (`ctx.media`): a provider
 * registry plus operation-dispatching execution for describing images,
 * generating images, and transcribing audio.
 *
 * Selection resolves at execution time and never depends on registration
 * order: a configured provider must exist, be usable, and implement the
 * operation; without a configured id exactly one usable provider for that
 * operation wins. A media provider is an auxiliary route — a second API used
 * on behalf of a main model that cannot see or draw images itself — so this
 * seam never reaches `ctx.llm` and never appears in a conversation's request.
 *
 * @module @deepseek-ai/dsh-media
 */

import { Context, Service, type Volatile } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import type {
  MediaCapability,
  MediaDescribeRequest,
  MediaDescribeResult,
  MediaGenerateRequest,
  MediaGenerateResult,
  MediaProvider,
  MediaTranscribeRequest,
  MediaTranscribeResult,
} from './types.ts'
import { MediaError } from './types.ts'

export { MediaError } from './types.ts'
export type {
  MediaCapability,
  MediaDescribeRequest,
  MediaDescribeResult,
  MediaGenerateRequest,
  MediaGenerateResult,
  MediaImageInput,
  MediaImageMediaType,
  MediaProvider,
  MediaStoredImage,
  MediaTranscribeRequest,
  MediaTranscribeResult,
} from './types.ts'

declare module '@deepseek-ai/cordis' {
  interface Events {
    /**
     * The media provider registry changed: a provider registered or was
     * disposed. Payload-free; consumers re-read {@link MediaRuntime.listProviders}
     * or {@link MediaRuntime.capabilities} for the new state. Observer failures
     * are contained and cannot veto the registry mutation.
     * @mode emit
     */
    'media/providers-updated'(): void
  }

  interface Context {
    media: MediaRuntime
  }
}

/**
 * Config for the media seam. `mediaProvider` pins which registered provider
 * serves every operation; omission auto-selects when exactly one usable
 * provider of the required capability is registered. The value is volatile, so
 * the Models page applies a new selection to the next operation without
 * remounting the service. Operational overrides must feed this same field
 * rather than introduce a hidden priority chain.
 */
export interface MediaRuntimeConfig {
  /** Explicit provider id. Omitted = auto-select when exactly one usable provider has the capability. */
  readonly mediaProvider: Volatile<string | undefined>
}

/** One registered provider and the operations it implements. */
export interface MediaProviderInfo {
  /** Stable provider id. */
  readonly id: string
  /** Operations this provider implements. */
  readonly capabilities: readonly MediaCapability[]
  /** Whether the provider's cheap local usability check currently passes. */
  readonly available: boolean
}

const CAPABILITIES: readonly MediaCapability[] = ['describe', 'generate', 'transcribe']

/**
 * The media access service, registered as `ctx.media`.
 *
 * Selection semantics, resolved per call and never order-dependent:
 * - A configured id that is registered, usable, and implements the operation → that provider.
 * - A configured id not registered → `MEDIA_PROVIDER_CONFIGURED_MISSING`.
 * - A configured id registered but unavailable → `MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE`.
 * - A configured id that does not implement the operation → `MEDIA_UNSUPPORTED_CAPABILITY`.
 * - No id, exactly one usable provider with the operation → that provider.
 * - No id, multiple usable providers → `MEDIA_PROVIDER_AMBIGUOUS`.
 * - No id, no usable provider with the operation → `MEDIA_PROVIDER_UNAVAILABLE`.
 */
export class MediaRuntime extends Service {
  static Config = z.object({
    mediaProvider: z.string().volatile(),
  })

  private readonly providers = new Map<string, MediaProvider>()

  constructor(ctx: Context, private readonly config: MediaRuntimeConfig) {
    super(ctx, 'media')
  }

  /**
   * Register one media provider. A duplicate id is rejected before anything
   * registers. Disposed with the calling fiber.
   * @param provider - the backend to add.
   * @returns the disposer removing it.
   */
  registerProvider(provider: MediaProvider): () => void {
    if (this.providers.has(provider.id)) {
      throw new MediaError(`media provider "${provider.id}" is already registered`, 'MEDIA_PROVIDER_DUPLICATE')
    }
    // A provider with no configured operation is dormant, not invalid: the
    // settings section starts empty, so a deployment that has not named a model
    // yet must still boot. It advertises nothing, so nothing selects it.
    this.providers.set(provider.id, provider)
    this.emitProvidersUpdated()
    return this.ctx.effect(() => () => {
      this.providers.delete(provider.id)
      this.emitProvidersUpdated()
    })
  }

  /**
   * Every registered provider with its declared operations and current
   * usability, for configuration surfaces and diagnostics.
   * @returns detached provider facts in registration order.
   */
  listProviders(): MediaProviderInfo[] {
    return [...this.providers.values()].map(provider => ({
      id: provider.id,
      capabilities: [...provider.capabilities],
      available: provider.available(),
    }))
  }

  /**
   * The operations at least one usable provider can currently serve.
   * @returns capability kinds in canonical order.
   */
  capabilities(): MediaCapability[] {
    return CAPABILITIES.filter(capability =>
      [...this.providers.values()].some(provider =>
        provider.available() && provider.capabilities.includes(capability)))
  }

  /**
   * Describe one image through the resolved provider.
   * @param request - the image, optional instruction, and output bound.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the answer text and the exact route that produced it.
   */
  async describe(request: MediaDescribeRequest, signal?: AbortSignal): Promise<MediaDescribeResult> {
    const provider = this.resolve('describe')
    return await provider.describe!(request, signal)
  }

  /**
   * Generate one image through the resolved provider.
   * @param request - the prompt, optional size, and optional source image.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns encoded image bytes and the exact route that produced them.
   */
  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaGenerateResult> {
    const provider = this.resolve('generate')
    return await provider.generate!(request, signal)
  }

  /**
   * Transcribe one recording through the resolved provider.
   * @param request - the audio bytes, container type, and optional language hint.
   * @param signal - optional cancellation forwarded to the provider.
   * @returns the transcribed text and the exact route that produced it.
   */
  async transcribe(request: MediaTranscribeRequest, signal?: AbortSignal): Promise<MediaTranscribeResult> {
    const provider = this.resolve('transcribe')
    return await provider.transcribe!(request, signal)
  }

  /** Resolve the provider serving one operation, or throw the matching {@link MediaError}. */
  private resolve(capability: MediaCapability): MediaProvider {
    const configuredId = this.config.mediaProvider.get()
    if (configuredId !== undefined && configuredId.length > 0) {
      const provider = this.providers.get(configuredId)
      if (provider === undefined) {
        throw new MediaError(
          `configured media provider "${configuredId}" is not registered`,
          'MEDIA_PROVIDER_CONFIGURED_MISSING',
        )
      }
      if (!provider.available()) {
        throw new MediaError(
          `configured media provider "${configuredId}" is not usable`,
          'MEDIA_PROVIDER_CONFIGURED_UNAVAILABLE',
        )
      }
      if (!provider.capabilities.includes(capability)) {
        throw new MediaError(
          `configured media provider "${configuredId}" does not support ${capability}`,
          'MEDIA_UNSUPPORTED_CAPABILITY',
        )
      }
      return provider
    }
    const usable = [...this.providers.values()].filter(provider =>
      provider.available() && provider.capabilities.includes(capability))
    const [single] = usable
    if (single === undefined) {
      throw new MediaError(
        `no usable media provider supports ${capability}`,
        'MEDIA_PROVIDER_UNAVAILABLE',
      )
    }
    if (usable.length > 1) {
      const ids = usable.map(provider => provider.id).join(', ')
      throw new MediaError(
        `multiple usable media providers support ${capability} (${ids}); configure one explicitly`,
        'MEDIA_PROVIDER_AMBIGUOUS',
      )
    }
    return single
  }

  /** Notify observers without letting one broken listener veto the commit. */
  private emitProvidersUpdated(): void {
    for (const listener of this.ctx.events.dispatch('emit', ['media/providers-updated']) as Array<() => unknown>) {
      try {
        listener()
      } catch (error) {
        this.ctx.logger.warn('media: a media/providers-updated listener failed')
        this.ctx.logger.warn(error)
      }
    }
  }
}

export default MediaRuntime
