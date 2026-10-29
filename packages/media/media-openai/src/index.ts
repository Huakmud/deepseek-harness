/**
 * OpenAI-compatible `MediaProvider` plugin. It contributes to the `ctx.media`
 * registry without owning the service, so a text-only main model can see and
 * draw images through a second API.
 *
 * Every profile field is volatile: the Models page writes this provider's
 * settings section, and a saved model or endpoint applies to the next media call
 * without remounting the plugin. Naming a model enables that operation and
 * leaving it unset leaves the operation unadvertised, so a deployment configures
 * exactly the routes it has — a deployment with only a vision route never offers
 * to draw, and a deployment that mounts several providers declares which one
 * serves what instead of registering competing defaults.
 *
 * @module @deepseek-ai/dsh-media-openai
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import { MediaError } from '@deepseek-ai/dsh-media'
import type {} from '@deepseek-ai/dsh-media'
import z from '@deepseek-ai/schemastery'
import {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_MEDIA_PROVIDER_ID,
  OpenAiMediaProvider,
} from './provider.ts'
import type { OpenAiMediaProfile } from './provider.ts'

export {
  OPENAI_DEFAULT_BASE_URL,
  OPENAI_MEDIA_PROVIDER_ID,
  OpenAiMediaProvider,
  sniffImageMediaType,
} from './provider.ts'
export type { OpenAiMediaProfile } from './provider.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'media-openai'

/** The media seam this provider registers into. */
export const inject = ['media']

/** Credential reference used when the section names none. */
const DEFAULT_API_KEY_ENV = 'OPENAI_API_KEY'

/** Settings namespace carrying this provider's endpoint, models, and key reference. */
export const MEDIA_OPENAI_SETTINGS_NAMESPACE = 'media-openai'

/** Plugin config: the endpoint, one model per operation, and the credential reference. */
export interface Config {
  /** Endpoint base including the API version prefix; operation paths are appended. */
  baseURL: Volatile<string>
  /** Credential reference resolved per request. Defaults to `OPENAI_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Image-describing model id. Empty leaves `describe` unadvertised. */
  describeModel: Volatile<string>
  /** Image-generating model id. Empty leaves `generate` unadvertised. */
  generateModel: Volatile<string | undefined>
  /** Audio-transcribing model id. Empty leaves `transcribe` unadvertised. */
  transcribeModel: Volatile<string | undefined>
}

export const Config = z.object({
  baseURL: z.string().default(OPENAI_DEFAULT_BASE_URL).volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  // An empty model is the encoded "route unused" value: every operation is
  // optional, so a deployment may configure only the one it has.
  describeModel: z.string().default('').volatile(),
  generateModel: z.string().default('').volatile(),
  transcribeModel: z.string().default('').volatile(),
})

/** One non-empty setting, or undefined when the field carries nothing. */
function settingOf(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined
}

/** Register the OpenAI-compatible media provider with `ctx.media`. */
export function apply(ctx: Context, config: Config): void {
  /** The profile in force for the next call, re-read from the section every time. */
  const profile = (): OpenAiMediaProfile => {
    const baseURL = settingOf(config.baseURL.get()) ?? OPENAI_DEFAULT_BASE_URL
    if (!URL.canParse(baseURL)) {
      throw new MediaError(`media-openai: baseURL "${baseURL}" is not an absolute URL`, 'MEDIA_CONFIG_INVALID')
    }
    const describeModel = settingOf(config.describeModel.get())
    const generateModel = settingOf(config.generateModel.get())
    const transcribeModel = settingOf(config.transcribeModel.get())
    return {
      baseURL: baseURL.endsWith('/') ? baseURL.slice(0, -1) : baseURL,
      ...describeModel === undefined ? {} : { describeModel },
      ...generateModel === undefined ? {} : { generateModel },
      ...transcribeModel === undefined ? {} : { transcribeModel },
    }
  }
  ctx.media.registerProvider(new OpenAiMediaProvider({
    id: OPENAI_MEDIA_PROVIDER_ID,
    profile,
    resolveApiKey: async () => {
      const ref = credentialRef(settingOf(config.apiKeyEnv.get()) ?? DEFAULT_API_KEY_ENV)
      const credentials = ctx.get('credentials')
      if (credentials !== undefined) return (await credentials.resolve(ref))?.value
      // Without the seam the environment is the whole credential plane.
      const ambient = launchEnvironmentOf(ctx).get(ref)
      return ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined
    },
  }))
}
