/**
 * `tool-media` composes the three model-facing media tools — describe an image,
 * generate an image, transcribe audio — over the `ctx.media` capability seam.
 *
 * Each tool is declared independently because each becomes usable at a
 * different moment: describing needs only a describe-capable provider, while
 * generating additionally needs a durable attachment store and takes far longer.
 * A deployment that has one and not the others still gets the tools it can run,
 * and a tool whose provider is missing fails with the seam's structured error
 * name rather than being absent from the catalog.
 *
 * @module @deepseek-ai/dsh-tool-media
 */

import type { Context } from '@deepseek-ai/cordis'
import z from '@deepseek-ai/schemastery'
import { applyMediaDescribeTool } from './describe.ts'
import { applyMediaGenerateTool } from './generate.ts'
import { applyMediaTranscribeTool } from './transcribe.ts'

export {
  applyMediaDescribeTool,
  formatDescribeOutput,
} from './describe.ts'
export {
  applyMediaGenerateTool,
  imageRefFromGenerateValue,
  mediaGenerateContent,
} from './generate.ts'
export type { MediaGenerateValue } from './generate.ts'
export {
  applyMediaTranscribeTool,
  formatTranscribeOutput,
} from './transcribe.ts'
export { resolveMediaImage } from './image-input.ts'
export type { ResolvedMediaImage } from './image-input.ts'
export { resolveMediaAudio } from './audio-input.ts'
export type { ResolvedMediaAudio } from './audio-input.ts'
export { sniffAudioMediaType } from './sniff.ts'
export { sniffImageMediaType } from './sniff.ts'

/** Cordis plugin name used by loader diagnostics. */
export const name = 'tool-media'

/** Services the tools register into; `attachments` and `fs` stay optional reads. */
export const inject = ['tools', 'media', 'systemPrompt']

/** Default cooperative budget for a describe or transcribe call. */
const DEFAULT_QUICK_TIMEOUT_MS = 120_000

/** Default cooperative budget for one image generation, which is slower than a request. */
const DEFAULT_GENERATE_TIMEOUT_MS = 300_000

/** Plugin config: which tools to expose and their cooperative time budgets. */
export interface Config {
  /** Register `media_describe_image`. Defaults to true. */
  describe?: boolean
  /** Register `media_generate_image`. Defaults to true. */
  generate?: boolean
  /** Register `media_transcribe_audio`. Defaults to true. */
  transcribe?: boolean
  /** Budget in milliseconds for a describe or transcribe call. */
  quickTimeoutMs?: number
  /** Budget in milliseconds for one image generation. */
  generateTimeoutMs?: number
}

export const Config: z<Config> = z.object({
  describe: z.boolean().default(true),
  generate: z.boolean().default(true),
  transcribe: z.boolean().default(true),
  quickTimeoutMs: z.number().step(1).min(1).default(DEFAULT_QUICK_TIMEOUT_MS),
  generateTimeoutMs: z.number().step(1).min(1).default(DEFAULT_GENERATE_TIMEOUT_MS),
})

/** The guidance each registered tool contributes to the system prompt. */
function guidanceFor(tool: string, hasMedia: boolean): string {
  if (!hasMedia) return ''
  switch (tool) {
    case 'media_describe_image':
      return 'When the conversation carries an image and the current model cannot accept images, call media_describe_image with its attachment id rather than guessing at the contents. The description comes from a separate vision model: report what it says, and never claim you saw the image yourself.'
    case 'media_generate_image':
      return 'When the user asks for a picture, call media_generate_image with a self-contained prompt. The image is produced by a separate model and committed to the conversation, so subsequent turns can refer to it by its attachment id.'
    case 'media_transcribe_audio':
      return 'When the conversation carries a recording and the current model cannot decode audio, call media_transcribe_audio with its attachment id rather than asking the user to retype it. The transcript comes from a separate audio model.'
    default:
      return ''
  }
}

/**
 * Register the media tools a composition can run.
 *
 * Registration follows configuration, not provider availability: the tool list
 * a scope sees must not change mid-conversation, so a tool whose provider is
 * unconfigured stays visible and reports the missing route when called. Each
 * guidance section is scoped to its own tool, so it disappears wherever a
 * policy hides that tool.
 * @param ctx - context providing the `tools`, `media`, and `systemPrompt` services.
 * @param config - which tools to expose and their cooperative time budgets.
 */
export function apply(ctx: Context, config: Config): void {
  const quick = config.quickTimeoutMs ?? DEFAULT_QUICK_TIMEOUT_MS
  const generate = config.generateTimeoutMs ?? DEFAULT_GENERATE_TIMEOUT_MS

  if (config.describe ?? true) {
    ctx.systemPrompt.section({
      name: 'tool:media_describe_image',
      order: ctx.systemPrompt.getSectionOrder('TOOL_MEDIA'),
      text: ({ scope }) => guidanceFor('media_describe_image', ctx.tools.get('media_describe_image', scope) !== undefined),
    })
    applyMediaDescribeTool(ctx, quick)
  }

  if (config.generate ?? true) {
    ctx.systemPrompt.section({
      name: 'tool:media_generate_image',
      order: ctx.systemPrompt.getSectionOrder('TOOL_MEDIA'),
      text: ({ scope }) => guidanceFor('media_generate_image', ctx.tools.get('media_generate_image', scope) !== undefined),
    })
    applyMediaGenerateTool(ctx, generate)
  }

  if (config.transcribe ?? true) {
    ctx.systemPrompt.section({
      name: 'tool:media_transcribe_audio',
      order: ctx.systemPrompt.getSectionOrder('TOOL_MEDIA'),
      text: ({ scope }) => guidanceFor('media_transcribe_audio', ctx.tools.get('media_transcribe_audio', scope) !== undefined),
    })
    applyMediaTranscribeTool(ctx, quick)
  }
}
