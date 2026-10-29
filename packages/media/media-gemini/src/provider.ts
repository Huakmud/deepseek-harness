/**
 * `GeminiMediaProvider`: a `MediaProvider` over Google's native Gemini REST
 * API, for deployments that hold a Gemini key rather than an OpenAI-compatible
 * gateway.
 *
 * Describing and generating share `POST /v1beta/models/{model}:generateContent`:
 * Gemini answers an image instruction either with text (a description) or with
 * an inline image part (a drawing), so the response decides which operation
 * actually happened. Transcribing sends the recording as inline audio in the
 * same shape. When the configured model can both answer and draw, `generate`
 * still asks for an image and reports `MEDIA_EMPTY_RESPONSE` if none came back,
 * so a caller never receives text where it asked for a drawing.
 *
 * @module @deepseek-ai/dsh-media-gemini/provider
 */

import { MediaError } from '@deepseek-ai/dsh-media'
import type {
  MediaCapability,
  MediaDescribeRequest,
  MediaDescribeResult,
  MediaGenerateRequest,
  MediaGenerateResult,
  MediaImageMediaType,
  MediaProvider,
  MediaTranscribeRequest,
  MediaTranscribeResult,
} from '@deepseek-ai/dsh-media'
import type {
  GeminiErrorEnvelope,
  GeminiPart,
  GeminiResponse,
} from './types.ts'

/** Stable id this provider registers under when the deployment names none. */
export const GEMINI_MEDIA_PROVIDER_ID = 'gemini'

/** Default endpoint base; `/models/{model}:generateContent` is appended. */
export const GEMINI_DEFAULT_BASE_URL = 'https://generativelanguage.googleapis.com/v1beta'

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface GeminiMediaProviderOptions {
  /** Registered provider id. */
  id: string
  /** Resolve the profile in force for one call; re-read per call so a settings edit applies without a remount. */
  profile: () => GeminiMediaProfile
  /** Resolve the API key for one request; undefined means no credential is configured. */
  resolveApiKey: () => Promise<string | undefined>
}

/** One resolved endpoint and per-operation model set. */
export interface GeminiMediaProfile {
  /** Endpoint base without a trailing slash. */
  baseURL: string
  /** Image-describing model id; absent disables `describe`. */
  describeModel?: string
  /** Image-generating model id; absent disables `generate`. */
  generateModel?: string
  /** Audio-transcribing model id; absent disables `transcribe`. */
  transcribeModel?: string
}

/** The Gemini-backed media provider. */
export class GeminiMediaProvider implements MediaProvider {
  constructor(private readonly options: GeminiMediaProviderOptions) {}

  /** Registered provider id. */
  get id(): string {
    return this.options.id
  }

  /** Operations whose model the current profile names, in canonical order. */
  get capabilities(): readonly MediaCapability[] {
    const profile = this.options.profile()
    const declared: MediaCapability[] = []
    if (profile.describeModel !== undefined) declared.push('describe')
    if (profile.generateModel !== undefined) declared.push('generate')
    if (profile.transcribeModel !== undefined) declared.push('transcribe')
    return declared
  }

  /** A configured model and a parseable endpoint; the credential is resolved per request. */
  available(): boolean {
    return URL.canParse(this.options.profile().baseURL)
  }

  async describe(request: MediaDescribeRequest, signal?: AbortSignal): Promise<MediaDescribeResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'describe')
    const instruction = request.prompt !== undefined && request.prompt.trim().length > 0
      ? request.prompt
      : 'Describe this image completely and literally: its contents, layout, visible text, and any notable detail.'
    const text = await this.generateText(profile, model, [
      { text: instruction },
      inlinePart(request.image.mediaType, request.image.data),
    ], request.maxOutputTokens, signal)
    return { text, provider: this.id, model }
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaGenerateResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'generate')
    const parts: GeminiPart[] = [{ text: request.prompt }]
    if (request.reference !== undefined) {
      parts.push(inlinePart(request.reference.mediaType, request.reference.data))
    }
    const payload = await this.call(profile, model, {
      contents: [{ role: 'user', parts }],
      ...imageGenerationConfig(request.size),
    }, signal)
    const image = imagePartOf(payload)
    if (image === undefined) {
      throw new MediaError(
        `media provider "${this.id}" returned no image for model "${model}"`,
        'MEDIA_EMPTY_RESPONSE',
      )
    }
    const data = Uint8Array.from(Buffer.from(image.inlineData.data, 'base64'))
    return {
      data,
      mediaType: normalizeMediaType(image.inlineData.mimeType, data),
      provider: this.id,
      model,
    }
  }

  async transcribe(request: MediaTranscribeRequest, signal?: AbortSignal): Promise<MediaTranscribeResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'transcribe')
    const instruction = request.language !== undefined && request.language.length > 0
      ? `Transcribe this recording verbatim. Write the transcript in the language spoken; the expected BCP-47 code is ${request.language}. Output only the transcript text.`
      : 'Transcribe this recording verbatim. Output only the transcript text.'
    const text = await this.generateText(profile, model, [
      { text: instruction },
      inlinePart(request.mediaType, request.data),
    ], undefined, signal)
    return {
      text,
      ...request.language === undefined ? {} : { language: request.language },
      provider: this.id,
      model,
    }
  }

  /** The profile's model for one operation, or the unsupported-capability failure. */
  private requireModel(profile: GeminiMediaProfile, capability: MediaCapability): string {
    const model = capability === 'describe'
      ? profile.describeModel
      : capability === 'generate'
        ? profile.generateModel
        : profile.transcribeModel
    if (model === undefined) {
      throw new MediaError(`media provider "${this.id}" does not support ${capability}`, 'MEDIA_UNSUPPORTED_CAPABILITY')
    }
    return model
  }

  /** One text answer for a part list, refusing an empty one. */
  private async generateText(
    profile: GeminiMediaProfile,
    model: string,
    parts: GeminiPart[],
    maxOutputTokens: number | undefined,
    signal?: AbortSignal,
  ): Promise<string> {
    const payload = await this.call(profile, model, {
      contents: [{ role: 'user', parts }],
      ...maxOutputTokens === undefined ? {} : { generationConfig: { maxOutputTokens } },
    }, signal)
    const text = (payload.candidates ?? [])
      .flatMap(candidate => candidate.content?.parts ?? [])
      .map(part => 'text' in part ? part.text : '')
      .join('')
      .trim()
    if (text.length === 0) {
      throw new MediaError(`media provider "${this.id}" returned no answer text`, 'MEDIA_EMPTY_RESPONSE')
    }
    return text
  }

  /** POST one `:generateContent` body and decode the JSON response. */
  private async call(
    profile: GeminiMediaProfile,
    model: string,
    body: unknown,
    signal?: AbortSignal,
  ): Promise<GeminiResponse> {
    const apiKey = await this.requireApiKey()
    let response: Response
    try {
      response = await fetch(`${profile.baseURL}/models/${encodeURIComponent(model)}:generateContent`, {
        method: 'POST',
        // A credential rides this request; following a redirect would forward
        // it to another origin.
        redirect: 'error',
        headers: {
          'x-goog-api-key': apiKey,
          'content-type': 'application/json',
          accept: 'application/json',
          'user-agent': USER_AGENT,
        },
        body: JSON.stringify(body),
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(`media provider "${this.id}" request failed: ${String(error)}`, 'MEDIA_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw await this.failure(response, signal)
    try {
      return await response.json() as GeminiResponse
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(
        `media provider "${this.id}" returned an unprocessable response body: ${String(error)}`,
        'MEDIA_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }

  /** The credential for one request, or the missing-credential failure. */
  private async requireApiKey(): Promise<string> {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new MediaError(`media provider "${this.id}" has no usable credential`, 'MISSING_CREDENTIAL')
    }
    return apiKey
  }

  /** Turn one non-2xx response into a provider failure carrying its status and message. */
  private async failure(response: Response, signal?: AbortSignal): Promise<MediaError> {
    const status = response.status
    let detail: string | undefined
    try {
      const parsed = await response.json() as GeminiErrorEnvelope
      const message = parsed.error?.message
      if (message !== undefined && message.length > 0) detail = message
    } catch (error: unknown) {
      // Cancellation is not a provider error, so it must not be swallowed into
      // the generic HTTP message; a malformed error body can only cost a richer
      // message, never the real status.
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      if (signal?.aborted === true) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: signal.reason })
    }
    return new MediaError(
      detail ?? `media provider "${this.id}" returned HTTP ${String(status)}`,
      'MEDIA_PROVIDER_ERROR',
    )
  }
}

/** One inline-data part for bytes already verified by the attachment service. */
function inlinePart(mimeType: string, data: Uint8Array): GeminiPart {
  return {
    inlineData: {
      mimeType,
      data: Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64'),
    },
  }
}

/** The first inline image part a generation response carried, if any. */
function imagePartOf(payload: GeminiResponse): { inlineData: { mimeType: string; data: string } } | undefined {
  for (const candidate of payload.candidates ?? []) {
    for (const part of candidate.content?.parts ?? []) {
      if ('inlineData' in part && part.inlineData.mimeType.startsWith('image/')) return part
      if ('inline_data' in part && part.inline_data !== undefined && part.inline_data.mimeType.startsWith('image/')) {
        return { inlineData: part.inline_data }
      }
    }
  }
  return undefined
}

/** The declared MIME type when it names a supported raster format, else detected from the bytes. */
function normalizeMediaType(declared: string, data: Uint8Array): MediaImageMediaType {
  const base = declared.split(';')[0]?.trim().toLowerCase()
  if (base === 'image/png' || base === 'image/jpeg' || base === 'image/webp' || base === 'image/gif') return base
  if (data.byteLength >= 8 && data[0] === 0x89 && data[1] === 0x50) return 'image/png'
  if (data.byteLength >= 3 && data[0] === 0xff && data[1] === 0xd8) return 'image/jpeg'
  // Gemini's image models return PNG; the attachment service re-verifies the
  // bytes, so an unrecognized declaration still commits or refuses on evidence.
  return 'image/png'
}

/** The generation config that asks Gemini for an image, mapping the neutral size string. */
function imageGenerationConfig(size: string | undefined): Record<string, unknown> {
  return {
    generationConfig: {
      responseModalities: ['TEXT', 'IMAGE'],
      ...size === undefined ? {} : { imageConfig: { aspectRatio: aspectRatioOf(size) } },
    },
  }
}

/** Map `WIDTHxHEIGHT` to the aspect ratio Gemini accepts, or leave it to the model. */
function aspectRatioOf(size: string): string {
  const match = /^(\d+)x(\d+)$/.exec(size.trim())
  if (match === null) return '1:1'
  const width = Number(match[1])
  const height = Number(match[2])
  const divisor = greatestCommonDivisor(width, height)
  return `${String(width / divisor)}:${String(height / divisor)}`
}

function greatestCommonDivisor(left: number, right: number): number {
  let a = left
  let b = right
  while (b !== 0) [a, b] = [b, a % b]
  return a === 0 ? 1 : a
}

/** True for a fetch/`AbortSignal` abort, surfaced as `MEDIA_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
