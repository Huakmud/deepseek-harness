/**
 * Audio acquisition for the media tools: accept a durable attachment id or a
 * path and return the encoded recording with a container type derived from its
 * bytes.
 *
 * Providers reject an upload whose declared type does not match its content, so
 * the container comes from a signature scan first and the filename only breaks a
 * tie; a recording whose bytes match nothing is refused instead of guessed.
 *
 * @module @deepseek-ai/dsh-tool-media/audio-input
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { FileAttachmentRef } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveMediaReadTarget, readMediaBytes } from './read-target.ts'
import { sniffAudioMediaType } from './sniff.ts'

/** Audio extensions the tool accepts from a path, used only to name an upload. */
const AUDIO_EXTENSIONS: Readonly<Record<string, string>> = {
  '.ogg': 'audio/ogg',
  '.oga': 'audio/ogg',
  '.opus': 'audio/ogg',
  '.wav': 'audio/wav',
  '.mp3': 'audio/mpeg',
  '.m4a': 'audio/mp4',
  '.mp4': 'audio/mp4',
  '.webm': 'audio/webm',
  '.flac': 'audio/flac',
  '.aiff': 'audio/aiff',
}

/** Bytes one path-sourced recording may occupy before the tool refuses. */
const MAX_SOURCE_AUDIO_BYTES = 64 * 1024 * 1024

/** One recording resolved from whichever source the model named. */
export interface ResolvedMediaAudio {
  /** Encoded bytes. */
  readonly data: Uint8Array
  /** Container media type established from the bytes. */
  readonly mediaType: string
  /** Display name, when one is known. */
  readonly name?: string
}

/**
 * Resolve a recording the model named by attachment id or by path.
 * @param ctx - plugin context supplying the attachment store and filesystem backend.
 * @param exec - current tool execution supplying the Session directory and cancellation.
 * @param args - the audio source, exactly one of `attachmentId` or `path`.
 * @returns the encoded audio with its detected container type.
 * @throws when neither source or both sources are named, or when the read fails.
 */
export async function resolveMediaAudio(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  args: { attachmentId?: string, path?: string },
): Promise<ResolvedMediaAudio> {
  const hasAttachment = args.attachmentId !== undefined && args.attachmentId.length > 0
  const hasPath = args.path !== undefined && args.path.length > 0
  if (hasAttachment === hasPath) {
    throw new Error('name exactly one of attachmentId or path')
  }
  if (hasAttachment) return await readDurableAudio(ctx, exec, args.attachmentId!)
  return await readPathAudio(ctx, exec, args.path!)
}

/** Read one recording the conversation stores verbatim. */
async function readDurableAudio(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  attachmentId: string,
): Promise<ResolvedMediaAudio> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('this deployment has no attachment store; pass the recording as a path instead')
  }
  const ref = referencedFile(exec, attachmentId)
  if (ref === undefined) {
    throw new Error(
      `cannot transcribe attachment "${attachmentId}": this conversation does not reference a file with that id`,
    )
  }
  // Audio is stored verbatim, so its reference declares no container type; the
  // bytes decide the type the provider is told.
  const chunks: Uint8Array[] = []
  let total = 0
  try {
    for await (const chunk of attachments.readFileStream(ref, exec.signal)) {
      total += chunk.byteLength
      if (total > MAX_SOURCE_AUDIO_BYTES) {
        throw new Error(`attachment "${attachmentId}" exceeds the ${MAX_SOURCE_AUDIO_BYTES}-byte transcription limit`)
      }
      chunks.push(chunk)
    }
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError)) throw error
    throw new Error(`cannot read attachment "${attachmentId}": ${error.message}`, { cause: error })
  }
  const data = concat(chunks, total)
  const mediaType = sniffAudioMediaType(data)
  if (mediaType === undefined) {
    throw new Error(`cannot transcribe attachment "${attachmentId}": the content is not a recognized audio container`)
  }
  return { data, mediaType }
}

/**
 * The complete file reference one attachment id names in this Session.
 *
 * Only first-party declared content fields are read; an id that no such event
 * carries yields undefined rather than a fabricated reference.
 */
function referencedFile(exec: Readonly<ToolRunContext>, attachmentId: string): FileAttachmentRef | undefined {
  const session = exec.agent?.session
  if (session === undefined) return undefined
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'user/message' && event.type !== 'tool/result') continue
    const content = event.type === 'user/message'
      ? event.data.content
      : (event.data as { readonly message?: { readonly content?: unknown } }).message?.content
    const found = fileBlockIn(content, attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** The first file block in one content array whose reference carries the requested id. */
function fileBlockIn(content: unknown, attachmentId: string): FileAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown }
    if (block.type !== 'file' || typeof block.attachment !== 'object' || block.attachment === null) continue
    const ref = block.attachment as FileAttachmentRef
    if (String(ref.attachmentId) === attachmentId) return ref
  }
  return undefined
}

/** Read one recording from a model-supplied path. */
async function readPathAudio(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  requestedPath: string,
): Promise<ResolvedMediaAudio> {
  const extension = extname(requestedPath).toLowerCase()
  const declared = AUDIO_EXTENSIONS[extension]
  if (declared === undefined && extension !== '') {
    throw new Error(`cannot transcribe "${requestedPath}": the ${extension} extension does not declare a supported audio format; media_transcribe_audio accepts OGG/WAV/MP3/M4A/WebM/FLAC/AIFF`)
  }
  const { target, displayPath } = await resolveMediaReadTarget(ctx, exec, requestedPath)
  const data = await readMediaBytes(ctx, target, exec.signal, MAX_SOURCE_AUDIO_BYTES)
  // The bytes decide the container: a provider rejects an upload whose declared
  // type contradicts its content, so an unrecognized recording is refused here
  // rather than uploaded under a name the file extension guessed.
  const mediaType = sniffAudioMediaType(data)
  if (mediaType === undefined) {
    throw new Error(`cannot transcribe "${displayPath}": the content is not a recognized audio container`)
  }
  return { data, mediaType, name: basename(displayPath) }
}

/** Join bounded chunks into one byte sequence. */
function concat(chunks: readonly Uint8Array[], total: number): Uint8Array {
  const [only] = chunks
  if (chunks.length === 1 && only !== undefined) return only
  const joined = new Uint8Array(total)
  let offset = 0
  for (const chunk of chunks) {
    joined.set(chunk, offset)
    offset += chunk.byteLength
  }
  return joined
}
