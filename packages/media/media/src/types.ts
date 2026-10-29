/**
 * Vocabulary for the media capability seam (`ctx.media`): describe an image,
 * generate an image, and transcribe audio through interchangeable backends.
 *
 * The three operations share one seam so provider selection, cancellation,
 * error reporting, and product configuration have a single owner, while each
 * keeps its own request and result type. A provider implements only the
 * operations its API supports; an operation it does not implement is absent
 * rather than throwing, so capability is a property of the provider.
 *
 * @module @deepseek-ai/dsh-media/types
 */

import { HarnessError } from '@deepseek-ai/dsh-llm'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'

/** Media operation kinds one provider may serve. */
export type MediaCapability = 'describe' | 'generate' | 'transcribe'

/** Raster image formats a generation provider may return; the attachment service re-verifies the bytes. */
export type MediaImageMediaType = ImageMediaType

/** One encoded image handed to a provider, detached from durable storage. */
export interface MediaImageInput {
  /** Encoded image bytes in their stored form. */
  readonly data: Uint8Array
  /** Media type verified by the attachment service for these exact bytes. */
  readonly mediaType: MediaImageMediaType
}

/**
 * What one describe-capable backend is asked about one image. `prompt` is the
 * caller's instruction; omission asks for a complete, literal description.
 * `maxOutputTokens` bounds the answer, and the seam enforces nothing further so
 * a provider's own protocol cap stays authoritative.
 */
export interface MediaDescribeRequest {
  /** One image, already read from durable storage by the consumer. */
  readonly image: MediaImageInput
  /** Instruction for the describing model; omission asks for a full description. */
  readonly prompt?: string
  /** Upper bound on generated answer tokens, when the caller imposes one. */
  readonly maxOutputTokens?: number
}

/** Normalized describe outcome: the model's answer text and the exact route that produced it. */
export interface MediaDescribeResult {
  /** The describing model's answer. */
  readonly text: string
  /** Provider route id that served the call, for citation and diagnostics. */
  readonly provider: string
  /** Exact model id that served the call. */
  readonly model: string
}

/**
 * What one generation-capable backend is asked to draw. `size` is a
 * provider-neutral request the provider maps into its own accepted set; a
 * provider that cannot honor it throws `MEDIA_UNSUPPORTED_OPTION` rather than
 * silently drawing something else. `reference` conditions the image on an
 * existing one, which providers that support editing accept.
 */
export interface MediaGenerateRequest {
  /** What the generated image must show. */
  readonly prompt: string
  /** Requested output size as `WIDTHxHEIGHT`; omission uses the provider default. */
  readonly size?: string
  /** Optional source image the generation is conditioned on. */
  readonly reference?: MediaImageInput
}

/**
 * Normalized generation outcome. The bytes are returned rather than stored:
 * the consuming tool owns durable attachment storage, so this seam never
 * depends on `ctx.attachments`.
 */
export interface MediaGenerateResult {
  /** Encoded image bytes as the provider returned them. */
  readonly data: Uint8Array
  /** Media type the provider declared for these bytes. */
  readonly mediaType: MediaImageMediaType
  /** Provider route id that served the call. */
  readonly provider: string
  /** Exact model id that served the call. */
  readonly model: string
}

/**
 * What one transcribe-capable backend is asked to transcribe. `mediaType` is
 * the container type of the supplied bytes, which providers need in order to
 * name the upload; `language` is an optional BCP-47 hint and never a
 * requirement, because providers may detect it.
 */
export interface MediaTranscribeRequest {
  /** Encoded audio bytes. */
  readonly data: Uint8Array
  /** Container media type of `data`, such as `audio/ogg`. */
  readonly mediaType: string
  /** Optional BCP-47 language hint. */
  readonly language?: string
}

/** Normalized transcription outcome. */
export interface MediaTranscribeResult {
  /** Transcribed text. */
  readonly text: string
  /** Optional detected or supplied BCP-47 language. */
  readonly language?: string
  /** Provider route id that served the call. */
  readonly provider: string
  /** Exact model id that served the call. */
  readonly model: string
}

/**
 * A media-capable backend. Registered with `ctx.media.registerProvider`. A
 * provider declares only the operations it implements; the seam refuses a call
 * for an absent operation with `MEDIA_UNSUPPORTED_CAPABILITY` before dispatch.
 */
export interface MediaProvider {
  /** Stable id, unique across registered providers. */
  readonly id: string
  /** Operations this provider implements, consulted by selection. */
  readonly capabilities: readonly MediaCapability[]
  /** Cheap local usability check; must not make network calls. */
  available(): boolean
  /**
   * Describe one image.
   * @param request - the image, optional instruction, and output bound.
   * @param signal - optional cancellation forwarded to the provider request.
   * @returns the model's answer and the exact route that produced it.
   */
  describe?(request: MediaDescribeRequest, signal?: AbortSignal): Promise<MediaDescribeResult>
  /**
   * Generate one image.
   * @param request - the prompt, optional size, and optional source image.
   * @param signal - optional cancellation forwarded to the provider request.
   * @returns encoded bytes plus the exact route that produced them.
   */
  generate?(request: MediaGenerateRequest, signal?: AbortSignal): Promise<MediaGenerateResult>
  /**
   * Transcribe one audio recording.
   * @param request - the audio bytes, container type, and optional language hint.
   * @param signal - optional cancellation forwarded to the provider request.
   * @returns the transcribed text plus the exact route that produced it.
   */
  transcribe?(request: MediaTranscribeRequest, signal?: AbortSignal): Promise<MediaTranscribeResult>
}

/** Durable reference and encoded bytes of one stored image, as a consumer hands them to the seam. */
export interface MediaStoredImage {
  /** Durable reference the consumer resolved before calling. */
  readonly attachment: ImageAttachmentRef
  /** Encoded bytes of that reference. */
  readonly data: Uint8Array
}

/**
 * Typed media failure with a machine-routable, open-string `code` and chained
 * `cause`. Consumers route on the code and must tolerate provider-specific
 * values. Shared codes cover a missing, unusable, or ambiguous provider, an
 * unsupported capability or option, cancellation, and provider failure.
 */
export class MediaError extends HarnessError {}
