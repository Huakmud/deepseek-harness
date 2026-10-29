/**
 * `OpenAiMediaProvider`: a `MediaProvider` over the OpenAI-compatible HTTP
 * surface every gateway in the harness already speaks.
 *
 * The three operations use three endpoints of that one surface:
 * `POST /chat/completions` for describing an image, `POST /images/generations`
 * for drawing one, and `POST /audio/transcriptions` for transcribing a
 * recording. A provider instance serves only the operations whose model its
 * configuration names, so an endpoint a deployment did not configure is never
 * advertised and never called.
 *
 * @module @deepseek-ai/dsh-media-openai/provider
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
  OpenAiChatResponse,
  OpenAiContentPart,
  OpenAiErrorEnvelope,
  OpenAiImageResponse,
  OpenAiMessage,
  OpenAiTranscriptionResponse,
} from './types.ts'

/** Stable id this provider registers under when the deployment names none. */
export const OPENAI_MEDIA_PROVIDER_ID = 'openai-compatible'

/** Default endpoint base; operation paths are appended to it. */
export const OPENAI_DEFAULT_BASE_URL = 'https://api.openai.com/v1'

/** Attribution header sent on every request. */
const USER_AGENT = 'deepseek-harness/0.0.1'

/** Resolved provider options (the plugin's `apply` supplies env-var and constant defaults). */
export interface OpenAiMediaProviderOptions {
  /** Registered provider id. */
  id: string
  /** Resolve the profile in force for one call; re-read per call so a settings edit applies without a remount. */
  profile: () => OpenAiMediaProfile
  /** Resolve the API key for one request; undefined means no credential is configured. */
  resolveApiKey: () => Promise<string | undefined>
}

/** One resolved endpoint and per-operation model set. */
export interface OpenAiMediaProfile {
  /** Endpoint base without a trailing slash; operation paths are appended. */
  baseURL: string
  /** Image-describing model id; absent disables `describe`. */
  describeModel?: string
  /** Image-generating model id; absent disables `generate`. */
  generateModel?: string
  /** Audio-transcribing model id; absent disables `transcribe`. */
  transcribeModel?: string
}

/** The OpenAI-compatible media provider. */
export class OpenAiMediaProvider implements MediaProvider {
  constructor(private readonly options: OpenAiMediaProviderOptions) {}

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

  /**
   * A usable endpoint is the whole local precondition: which operations this
   * provider offers is a separate axis that selection checks. This check is
   * local by contract, so it assumes a credential exists when one could be
   * resolved later and lets the request itself report a missing key.
   */
  available(): boolean {
    return URL.canParse(this.options.profile().baseURL)
  }

  async describe(request: MediaDescribeRequest, signal?: AbortSignal): Promise<MediaDescribeResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'describe')
    const apiKey = await this.requireApiKey()
    const instruction = request.prompt !== undefined && request.prompt.trim().length > 0
      ? request.prompt
      : 'Describe this image completely and literally: its contents, layout, visible text, and any notable detail.'
    const body = {
      model,
      messages: [{
        role: 'user',
        content: [
          { type: 'text', text: instruction },
          {
            type: 'image_url',
            image_url: { url: `data:${request.image.mediaType};base64,${base64(request.image.data)}` },
          },
        ],
      }],
      ...request.maxOutputTokens === undefined ? {} : { max_tokens: request.maxOutputTokens },
    }
    const payload = await this.post<OpenAiChatResponse>(profile, '/chat/completions', body, apiKey, signal)
    const text = (payload.choices ?? [])
      .flatMap(choice => contentPartsOf(choice.message?.content))
      .map(part => part.text ?? '')
      .join('')
      .trim()
    if (text.length === 0) {
      throw new MediaError(`media provider "${this.id}" returned no description text`, 'MEDIA_EMPTY_RESPONSE')
    }
    return { text, provider: this.id, model }
  }

  async generate(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaGenerateResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'generate')
    const apiKey = await this.requireApiKey()
    const body = {
      model,
      prompt: request.prompt,
      n: 1,
      response_format: { type: 'b64_json' },
      ...request.size === undefined ? {} : { size: request.size },
    }
    const payload = await this.post<OpenAiImageResponse>(profile, '/images/generations', body, apiKey, signal)
    const image = payload.data?.[0]
    if (image === undefined) {
      throw new MediaError(`media provider "${this.id}" returned no image`, 'MEDIA_EMPTY_RESPONSE')
    }
    if (image.b64_json !== undefined && image.b64_json.length > 0) {
      const data = Uint8Array.from(Buffer.from(image.b64_json, 'base64'))
      return { data, mediaType: sniffImageMediaType(data), provider: this.id, model }
    }
    if (image.url !== undefined && image.url.length > 0) {
      // Endpoints that can only hand back a URL are still usable, but the
      // follow-up download carries no credential: it fails rather than follows
      // a redirect, so the configured endpoint is the only URL that sees one.
      const data = await this.download(image.url, signal)
      return { data, mediaType: sniffImageMediaType(data), provider: this.id, model }
    }
    throw new MediaError(`media provider "${this.id}" returned an image without bytes`, 'MEDIA_EMPTY_RESPONSE')
  }

  async transcribe(request: MediaTranscribeRequest, signal?: AbortSignal): Promise<MediaTranscribeResult> {
    const profile = this.options.profile()
    const model = this.requireModel(profile, 'transcribe')
    const apiKey = await this.requireApiKey()
    const form = new FormData()
    // A fresh copy keeps the Blob's buffer an exact ArrayBuffer.
    form.append('file', new Blob([new Uint8Array(request.data)], { type: request.mediaType }), `audio${extensionFor(request.mediaType)}`)
    form.append('model', model)
    if (request.language !== undefined && request.language.length > 0) form.append('language', request.language)
    const payload = await this.request<OpenAiTranscriptionResponse>(profile, '/audio/transcriptions', {
      method: 'POST',
      body: form,
      headers: { authorization: `Bearer ${apiKey}`, accept: 'application/json', 'user-agent': USER_AGENT },
    }, signal)
    const text = payload.text?.trim() ?? ''
    if (text.length === 0) {
      throw new MediaError(`media provider "${this.id}" returned no transcript`, 'MEDIA_EMPTY_RESPONSE')
    }
    return {
      text,
      ...payload.language === undefined ? {} : { language: payload.language },
      provider: this.id,
      model,
    }
  }

  /** The profile's model for one operation, or the unsupported-capability failure. */
  private requireModel(profile: OpenAiMediaProfile, capability: MediaCapability): string {
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

  /** The credential for one request, or the missing-credential failure. */
  private async requireApiKey(): Promise<string> {
    const apiKey = await this.options.resolveApiKey()
    if (apiKey === undefined || apiKey.length === 0) {
      throw new MediaError(`media provider "${this.id}" has no usable credential`, 'MISSING_CREDENTIAL')
    }
    return apiKey
  }

  /** POST one JSON body and decode the JSON response. */
  private async post<T>(
    profile: OpenAiMediaProfile,
    path: string,
    body: unknown,
    apiKey: string,
    signal?: AbortSignal,
  ): Promise<T> {
    return await this.request<T>(profile, path, {
      method: 'POST',
      body: JSON.stringify(body),
      headers: {
        authorization: `Bearer ${apiKey}`,
        'content-type': 'application/json',
        accept: 'application/json',
        'user-agent': USER_AGENT,
      },
    }, signal)
  }

  /** One request against the configured endpoint, with redirects refused. */
  private async request<T>(
    profile: OpenAiMediaProfile,
    path: string,
    init: RequestInit,
    signal?: AbortSignal,
  ): Promise<T> {
    let response: Response
    try {
      response = await fetch(`${profile.baseURL}${path}`, {
        ...init,
        // A credential rides this request; following a redirect would forward
        // it to another origin.
        redirect: 'error',
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(`media provider "${this.id}" request failed: ${String(error)}`, 'MEDIA_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw await this.failure(response, signal)
    try {
      return await response.json() as T
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(
        `media provider "${this.id}" returned an unprocessable response body: ${String(error)}`,
        'MEDIA_PROVIDER_ERROR',
        { cause: error },
      )
    }
  }

  /** Download one provider-supplied image URL, refusing redirects. */
  private async download(
    url: string,
    signal?: AbortSignal,
  ): Promise<Uint8Array> {
    let response: Response
    try {
      response = await fetch(url, {
        redirect: 'error',
        headers: { 'user-agent': USER_AGENT },
        ...signal === undefined ? {} : { signal },
      })
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(`media provider "${this.id}" image download failed: ${String(error)}`, 'MEDIA_PROVIDER_ERROR', { cause: error })
    }
    if (!response.ok) throw await this.failure(response, signal)
    try {
      return new Uint8Array(await response.arrayBuffer())
    } catch (error: unknown) {
      if (isAbortError(error)) throw new MediaError('media request aborted', 'MEDIA_ABORTED', { cause: error })
      throw new MediaError(`media provider "${this.id}" image download failed: ${String(error)}`, 'MEDIA_PROVIDER_ERROR', { cause: error })
    }
  }

  /** Turn one non-2xx response into a provider failure carrying its status and message. */
  private async failure(response: Response, signal?: AbortSignal): Promise<MediaError> {
    const status = response.status
    let detail: string | undefined
    try {
      const parsed = await response.json() as OpenAiErrorEnvelope
      const message = typeof parsed.error === 'string' ? parsed.error : parsed.error?.message ?? parsed.message
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

/** Canonical base64 for one byte sequence. */
function base64(data: Uint8Array): string {
  return Buffer.from(data.buffer, data.byteOffset, data.byteLength).toString('base64')
}

/** Normalize a choice's `content`, which gateways send either as text or as parts. */
function contentPartsOf(content: OpenAiMessage['content']): OpenAiContentPart[] {
  if (content === undefined || content === null) return []
  if (typeof content === 'string') return [{ type: 'text', text: content }]
  return content
}

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const

/**
 * Identify the media type of returned image bytes from their signature, so a
 * provider that omits the type still yields a reference the attachment service
 * can validate.
 * @param data - encoded image bytes.
 * @returns the detected supported media type, defaulting to PNG for other bytes.
 */
export function sniffImageMediaType(data: Uint8Array): MediaImageMediaType {
  if (matches(data, 0, PNG_SIGNATURE)) return 'image/png'
  if (matches(data, 0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (ascii(data, 0, 'GIF87a') || ascii(data, 0, 'GIF89a')) return 'image/gif'
  if (ascii(data, 0, 'RIFF') && ascii(data, 8, 'WEBP')) return 'image/webp'
  // OpenAI-compatible endpoints return base64 without a type; PNG is their
  // documented default, and the attachment service re-verifies the bytes.
  return 'image/png'
}

function matches(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.byteLength < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

function ascii(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}

/** File extension an audio upload needs so the endpoint can name its container. */
function extensionFor(mediaType: string): string {
  switch (mediaType.split(';')[0]?.trim().toLowerCase()) {
    case 'audio/wav':
    case 'audio/x-wav': return '.wav'
    case 'audio/mpeg': return '.mp3'
    case 'audio/mp4':
    case 'audio/x-m4a': return '.m4a'
    case 'audio/webm': return '.webm'
    case 'audio/flac': return '.flac'
    default: return '.ogg'
  }
}

/** True for a fetch/`AbortSignal` abort, surfaced as `MEDIA_ABORTED`. */
function isAbortError(error: unknown): boolean {
  return error instanceof DOMException && error.name === 'AbortError'
}
