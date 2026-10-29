/**
 * The model-facing `media_describe_image` tool: let a model that cannot see
 * images learn what one contains.
 *
 * The tool accepts either a durable attachment id the conversation already
 * carries or a filesystem path the model can reach, reads the bytes through the
 * owning service, and dispatches one describe call on `ctx.media`. This module
 * owns the schema and result formatting; acquisition lives in
 * {@link resolveMediaImage} and provider selection and network access stay in
 * the seam.
 *
 * The result is labelled as another model's reading. The calling model did not
 * receive the bytes and must not report the picture as its own observation.
 *
 * @module @deepseek-ai/dsh-tool-media/describe
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MediaDescribeResult } from '@deepseek-ai/dsh-media'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { resolveMediaImage } from './image-input.ts'

/**
 * Format one describe outcome for the model.
 * @param result - the seam's describe outcome.
 * @returns attribute text naming the route, then the description.
 */
export function formatDescribeOutput(result: MediaDescribeResult): string {
  return `Described by ${result.provider}/${result.model}, a separate vision model that received the image; you did not see it yourself.\n\n${result.text}`
}

/**
 * Register the `media_describe_image` tool.
 * @param ctx - context whose `tools` registry receives the registration; it is
 *   effect-scoped and unregisters on plugin dispose.
 * @param timeoutMs - cooperative tool-call budget attached as `ToolDefinition.timeoutMs`.
 */
export function applyMediaDescribeTool(ctx: Context, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'media_describe_image',
    description: 'Look at an image through a separate vision model and get a written description of it. '
      + 'Use this when an image matters but the current model cannot accept images itself. '
      + 'Name the image by the attachment id shown in the conversation, or by a path for a file you produced.',
    parameters: {
      attachmentId: {
        type: 'string',
        description: 'Attachment id of an image already in this conversation, exactly as shown (for example "sha256:1a2b3c4d…").',
      },
      path: {
        type: 'string',
        description: 'Filesystem path of an image file in this environment, resolved by the filesystem backend.',
      },
      prompt: {
        type: 'string',
        description: 'What to find out about the image. Omit for a complete description.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true, description: 'Media provider that served the call.' },
          model: { type: 'string', required: true, description: 'Vision model that served the call.' },
          description: { type: 'string', required: true, description: 'The vision model\'s description.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatDescribeOutput({ text: value.description, provider: value.provider, model: value.model }),
      }],
      presentationMeta: (_args, value) => ({ provider: value.provider, model: value.model }),
    },
    timeoutMs,
    // A describe call reads provider state and mutates nothing.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const image = await resolveMediaImage(ctx, exec, args)
      const result = await ctx.media.describe({
        image: { data: image.data, mediaType: image.mediaType },
        ...args.prompt === undefined || args.prompt.trim().length === 0 ? {} : { prompt: args.prompt },
      }, exec.signal)
      return { provider: result.provider, model: result.model, description: result.text }
    },
    presentCall(args): GenericCallView {
      const label = args.path ?? args.attachmentId ?? 'the image'
      return {
        card: 'generic',
        title: `Look at image ${label}`,
        kind: 'read',
        ...args.path === undefined ? {} : { locations: [{ path: args.path }] },
      }
    },
  }))
}
