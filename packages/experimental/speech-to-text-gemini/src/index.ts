/**
 * Cloud Gemini transcription for the experimental speech service.
 *
 * The microphone toolbar already owns recording, the preparation dialog, and
 * inserting the finished transcript into the draft. What it needs from a
 * provider is only "decode these bytes into text", so this package supplies
 * that against the Gemini API and reuses the same key the media providers read.
 *
 * A recording reaches this provider as canonical 16 kHz mono PCM16 WAV, which
 * is the container Gemini accepts directly, so the bytes are forwarded without
 * re-encoding.
 *
 * @module @deepseek-ai/dsh-experimental-speech-to-text-gemini
 */

import type { Context, Volatile } from '@deepseek-ai/cordis'
import { credentialRef } from '@deepseek-ai/dsh-credentials'
import type {} from '@deepseek-ai/dsh-experimental-speech-to-text'
import type {
  SpeechProviderId,
  SpeechInput,
  Transcript,
} from '@deepseek-ai/dsh-experimental-speech-to-text'
import { launchEnvironmentOf } from '@deepseek-ai/dsh-launch-environment'
import z from '@deepseek-ai/schemastery'

/** Default Gemini API endpoint, including the version prefix. */
export const GEMINI_SPEECH_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Stable provider id the microphone picks when nothing else is selected. */
export const GEMINI_SPEECH_PROVIDER_ID = 'gemini-speech'

/** Credential reference used when the section names none. */
const DEFAULT_API_KEY_ENV = 'GEMINI_API_KEY'

/** Language hints offered by the picker; `auto` asks Gemini to detect it. */
const LANGUAGES: readonly string[] = ['auto', 'ar', 'en', 'zh', 'ja', 'ko', 'fr', 'de', 'es', 'ru', 'tr', 'hi']

/** English names for the hints above, so the instruction names the language instead of its code. */
const LANGUAGE_NAMES: Readonly<Record<string, string>> = {
  ar: 'Arabic', en: 'English', zh: 'Chinese', ja: 'Japanese', ko: 'Korean',
  fr: 'French', de: 'German', es: 'Spanish', ru: 'Russian', tr: 'Turkish', hi: 'Hindi',
}

/** Sampling rate of every recording the browser produces. */
const SAMPLE_RATE = 16_000

/** Bytes per second of canonical PCM16 mono audio. */
const BYTES_PER_SECOND = SAMPLE_RATE * 2

/** WAV header bytes preceding the first sample of a canonical recording. */
const WAVE_HEADER_BYTES = 44

/** Plugin name used by Loader diagnostics. */
export const name = 'experimental-speech-to-text-gemini'

/** The registry this provider registers into. */
export const inject = ['speechToText']

/** Plugin config: endpoint, model, and credential reference. */
export interface Config {
  /** Gemini endpoint base including the API version prefix. */
  baseURL: Volatile<string>
  /** Credential reference resolved per request. Defaults to `GEMINI_API_KEY`. */
  apiKeyEnv: Volatile<string>
  /** Transcription model id. */
  model: Volatile<string>
  /** Provider id registered with the speech service. */
  providerId: Volatile<string>
  /** Cooperative request budget before the call is abandoned. */
  timeoutMs: Volatile<number>
}

export const Config = z.object({
  baseURL: z.string().default(GEMINI_SPEECH_DEFAULT_BASE_URL).volatile(),
  apiKeyEnv: z.string().role('credential-ref').default(DEFAULT_API_KEY_ENV).volatile(),
  model: z.string().default('gemini-3.8-flash').volatile(),
  providerId: z.string().default(GEMINI_SPEECH_PROVIDER_ID).volatile(),
  timeoutMs: z.number().default(120_000).volatile(),
})

/** One non-empty setting, or undefined when the field carries nothing. */
function settingOf(value: string | undefined): string | undefined {
  return value !== undefined && value.trim().length > 0 ? value.trim() : undefined
}

/**
 * Read one inline-audio response and keep only its text parts.
 * @param body - decoded `generateContent` response.
 * @returns the concatenated transcript, empty when the model said nothing.
 */
function transcriptOf(body: unknown): string {
  if (typeof body !== 'object' || body === null) return ''
  const candidates = (body as { candidates?: unknown }).candidates
  if (!Array.isArray(candidates)) return ''
  const parts: string[] = []
  for (const candidate of candidates) {
    if (typeof candidate !== 'object' || candidate === null) continue
    const content = (candidate as { content?: unknown }).content
    if (typeof content !== 'object' || content === null) continue
    const list = (content as { parts?: unknown }).parts
    if (!Array.isArray(list)) continue
    for (const part of list) {
      if (typeof part !== 'object' || part === null) continue
      const text = (part as { text?: unknown }).text
      if (typeof text === 'string') parts.push(text)
    }
  }
  return parts.join('').trim()
}

/** Register the Gemini recognizer with `ctx.speechToText`. */
export function apply(ctx: Context, config: Config): void {
  let registration: (() => Promise<void>) | undefined
  ctx.effect(() => {
    const id = settingOf(config.providerId.get()) ?? GEMINI_SPEECH_PROVIDER_ID
    registration = ctx.speechToText.register({
      info: { id: id as SpeechProviderId, name: 'Gemini', location: 'cloud', languages: LANGUAGES },
      transcribe: async (input: SpeechInput, signal: AbortSignal): Promise<Transcript> => {
        const baseURL = settingOf(config.baseURL.get()) ?? GEMINI_SPEECH_DEFAULT_BASE_URL
        if (!URL.canParse(baseURL)) throw new Error(`speech-to-text-gemini: baseURL "${baseURL}" is not an absolute URL`)
        const model = settingOf(config.model.get())
        if (model === undefined) throw new Error('speech-to-text-gemini: model is empty')
        const credentials = ctx.get('credentials')
        const ref = credentialRef(settingOf(config.apiKeyEnv.get()) ?? DEFAULT_API_KEY_ENV)
        const ambient = launchEnvironmentOf(ctx).get(ref)
        const apiKey = credentials === undefined
          ? (ambient !== undefined && ambient.value.length > 0 ? ambient.value : undefined)
          : (await credentials.resolve(ref))?.value
        if (apiKey === undefined) throw new Error(`speech-to-text-gemini: no credential for ${ref}`)

        const named = LANGUAGE_NAMES[input.language] ?? input.language
        const hint = input.language === 'auto' || input.language === ''
          ? 'Transcribe this recording verbatim. Output only the transcript text.'
          : `Transcribe this recording verbatim in ${named}. Output only the transcript text.`
        const started = performance.now()
        // The recording is forwarded as-is; a WAV header is already the container Gemini decodes.
        const body = JSON.stringify({
          contents: [{ parts: [
            { inlineData: { mimeType: 'audio/wav', data: Buffer.from(input.audio).toString('base64') } },
            { text: hint },
          ] }],
        })
        const signalToUse = AbortSignal.any([signal, AbortSignal.timeout(config.timeoutMs.get())])
        const response = await fetch(`${baseURL.replace(/\/+$/u, '')}/models/${encodeURIComponent(model)}:generateContent`, {
          method: 'POST',
          // A credential rides this request; following a redirect would forward it to the new origin.
          redirect: 'error',
          headers: { 'content-type': 'application/json', 'x-goog-api-key': apiKey },
          body,
          signal: signalToUse,
        })
        if (!response.ok) {
          const detail = await response.text().catch(() => '')
          throw new Error(`speech-to-text-gemini: ${String(response.status)} ${detail.slice(0, 200)}`)
        }
        const decoded: unknown = await response.json()
        return {
          text: transcriptOf(decoded),
          audioSeconds: Math.max(0, input.audio.byteLength - WAVE_HEADER_BYTES) / BYTES_PER_SECOND,
          inferenceSeconds: (performance.now() - started) / 1000,
        }
      },
    })
    return () => { void registration?.() }
  })
}
