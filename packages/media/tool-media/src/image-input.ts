/**
 * Image acquisition for the media tools: accept either a durable attachment id
 * the conversation already carries or a path the model can reach, and return
 * the encoded bytes with a media type the provider can trust.
 *
 * Both sources are legitimate. An image the user attached is durable and named
 * by id; an image the model itself produced or downloaded is a path. Accepting
 * both in one helper keeps `media_describe_image` and the reference input of
 * `media_generate_image` from diverging.
 *
 * An attachment id is only an identifier: the store verifies a complete
 * reference against the stored bytes, so the reference itself is recovered from
 * the Session log the model was reading. An id that no event of this Session
 * references is refused rather than turned into a fabricated reference.
 *
 * @module @deepseek-ai/dsh-tool-media/image-input
 */

import { basename, extname } from 'node:path'
import type { Context } from '@deepseek-ai/cordis'
import { AttachmentError } from '@deepseek-ai/dsh-attachment'
import type { ImageAttachmentRef, ImageMediaType } from '@deepseek-ai/dsh-attachment'
import type { ToolRunContext } from '@deepseek-ai/dsh-tools'
import type {} from '@deepseek-ai/dsh-fs'
import { resolveMediaReadTarget, readMediaBytes } from './read-target.ts'
import { sniffImageMediaType } from './sniff.ts'

/** Extensions the media tools accept from a path; the bytes remain authoritative. */
export const IMAGE_EXTENSIONS: Readonly<Record<string, ImageMediaType>> = {
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.webp': 'image/webp',
  '.gif': 'image/gif',
}

/** Bytes one path-sourced image may occupy; the attachment service caps durable storage separately. */
const MAX_SOURCE_IMAGE_BYTES = 32 * 1024 * 1024

/** One image resolved from whichever source the model named. */
export interface ResolvedMediaImage {
  /** Encoded bytes. */
  readonly data: Uint8Array
  /** Media type confirmed by the bytes. */
  readonly mediaType: ImageMediaType
  /** Display name, when one is known. */
  readonly name?: string
}

/**
 * Resolve an image the model named by attachment id or by path.
 * @param ctx - plugin context supplying the attachment store and filesystem backend.
 * @param exec - current tool execution supplying the Session directory and cancellation.
 * @param args - the image source, exactly one of `attachmentId` or `path`.
 * @returns the encoded image with its verified media type.
 * @throws when neither source or both sources are named, or when the read fails.
 */
export async function resolveMediaImage(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  args: { attachmentId?: string, path?: string },
): Promise<ResolvedMediaImage> {
  const hasAttachment = args.attachmentId !== undefined && args.attachmentId.length > 0
  const hasPath = args.path !== undefined && args.path.length > 0
  if (hasAttachment === hasPath) {
    throw new Error('name exactly one of attachmentId or path')
  }
  if (hasAttachment) return await readDurableImage(ctx, exec, args.attachmentId!)
  return await readPathImage(ctx, exec, args.path!)
}

/**
 * Read one image the conversation already stores.
 *
 * The store re-verifies the complete reference against the stored bytes, so the
 * reference comes from the Session log rather than from the id alone.
 */
async function readDurableImage(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  attachmentId: string,
): Promise<ResolvedMediaImage> {
  const attachments = ctx.get('attachments')
  if (attachments === undefined) {
    throw new Error('this deployment has no attachment store; pass the image as a path instead')
  }
  const ref = referencedImage(exec, attachmentId)
  if (ref === undefined) {
    throw new Error(
      `cannot read attachment "${attachmentId}": this conversation does not reference an image with that id`,
    )
  }
  try {
    const stored = await attachments.readImage(ref, exec.signal)
    return {
      data: stored.data,
      mediaType: stored.ref.mediaType,
      ...stored.ref.name === undefined ? {} : { name: stored.ref.name },
    }
  } catch (error: unknown) {
    if (!(error instanceof AttachmentError)) throw error
    throw new Error(`cannot read attachment "${attachmentId}": ${error.message}`, { cause: error })
  }
}

/**
 * The complete image reference one attachment id names in this Session.
 *
 * Only first-party declared content fields are read: an id in a tool result, a
 * user message, a summary, or an assistant stream block all count, and an id
 * that no such event carries yields undefined.
 */
function referencedImage(exec: Readonly<ToolRunContext>, attachmentId: string): ImageAttachmentRef | undefined {
  const session = exec.agent?.session
  if (session === undefined) return undefined
  for (const event of session.snapshotEvents()) {
    if (event.type !== 'user/message' && event.type !== 'tool/result') continue
    const content = event.type === 'user/message'
      ? event.data.content
      : (event.data as { readonly message?: { readonly content?: unknown } }).message?.content
    const found = imageBlockIn(content, attachmentId)
    if (found !== undefined) return found
  }
  return undefined
}

/** The first image block in one content array whose reference carries the requested id. */
function imageBlockIn(content: unknown, attachmentId: string): ImageAttachmentRef | undefined {
  if (!Array.isArray(content)) return undefined
  for (const value of content) {
    if (typeof value !== 'object' || value === null || Array.isArray(value)) continue
    const block = value as { readonly type?: unknown; readonly attachment?: unknown }
    if (block.type !== 'image' || typeof block.attachment !== 'object' || block.attachment === null) continue
    const ref = block.attachment as ImageAttachmentRef
    if (String(ref.attachmentId) === attachmentId) return ref
  }
  return undefined
}

/** Read one image from a model-supplied path. */
async function readPathImage(
  ctx: Context,
  exec: Readonly<ToolRunContext>,
  requestedPath: string,
): Promise<ResolvedMediaImage> {
  const extension = extname(requestedPath).toLowerCase()
  const declared = IMAGE_EXTENSIONS[extension]
  if (declared === undefined && extension !== '') {
    throw new Error(`cannot read "${requestedPath}": the ${extension} extension does not declare a supported image format; the media tools accept PNG/JPEG/WebP/GIF files`)
  }
  const { target, displayPath } = await resolveMediaReadTarget(ctx, exec, requestedPath)
  const data = await readMediaBytes(ctx, target, exec.signal, MAX_SOURCE_IMAGE_BYTES)
  const detected = sniffImageMediaType(data)
  if (detected === undefined) {
    throw new Error(`cannot read "${displayPath}": the file content is not a supported image format; the media tools accept PNG/JPEG/WebP/GIF`)
  }
  if (declared !== undefined && declared !== detected) {
    throw new Error(`cannot read "${displayPath}": the ${extension} extension declares ${declared}, but the bytes use ${detected}; rename the file to match its actual format`)
  }
  return { data, mediaType: detected, name: basename(displayPath) }
}
