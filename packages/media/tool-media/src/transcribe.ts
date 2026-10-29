/**
 * The model-facing `media_transcribe_audio` tool: turn a recording the user
 * attached, or a file the model can reach, into text.
 *
 * Audio needs the same treatment images get. A main model that accepts text
 * only cannot decode a recording, and most model routes cannot accept audio at
 * all, so transcription runs on the configured media provider and the calling
 * model receives the transcript.
 *
 * @module @deepseek-ai/dsh-tool-media/transcribe
 */

import type { Context } from '@deepseek-ai/cordis'
import type { MediaTranscribeResult } from '@deepseek-ai/dsh-media'
import { defineTool } from '@deepseek-ai/dsh-tools'
import type { GenericCallView } from '@deepseek-ai/dsh-tools'
import { resolveMediaAudio } from './audio-input.ts'

/**
 * Format one transcription outcome for the model.
 * @param result - the seam's transcription outcome.
 * @returns attribution naming the route and any language, then the transcript.
 */
export function formatTranscribeOutput(result: MediaTranscribeResult): string {
  const language = result.language === undefined ? '' : ` as ${result.language}`
  return `Transcribed by ${result.provider}/${result.model}${language}. That separate audio model decoded the recording, not you.\n\n${result.text}`
}

/**
 * Register the `media_transcribe_audio` tool.
 * @param ctx - context whose `tools` registry receives the registration.
 * @param timeoutMs - cooperative tool-call budget attached as `ToolDefinition.timeoutMs`.
 */
export function applyMediaTranscribeTool(ctx: Context, timeoutMs: number): void {
  ctx.tools.register(defineTool({
    name: 'media_transcribe_audio',
    description: 'Turn a recording into text using a separate audio model. '
      + 'Use this when the conversation carries audio, or when the user asks about a recording you can reach by path.',
    parameters: {
      attachmentId: {
        type: 'string',
        description: 'Attachment id of a recording already in this conversation, exactly as shown (for example "sha256:1a2b3c4d…").',
      },
      path: {
        type: 'string',
        description: 'Filesystem path of an audio file in this environment, resolved by the filesystem backend.',
      },
      language: {
        type: 'string',
        description: 'BCP-47 language hint, such as "en" or "ja". Omit to let the model detect the language.',
      },
    },
    output: {
      schema: {
        type: 'object',
        additionalProperties: false,
        properties: {
          provider: { type: 'string', required: true, description: 'Media provider that served the call.' },
          model: { type: 'string', required: true, description: 'Audio model that served the call.' },
          text: { type: 'string', required: true, description: 'The transcript.' },
          language: { type: 'string', description: 'Detected or requested BCP-47 language.' },
        },
      },
      render: (_args, value) => [{
        type: 'text',
        text: formatTranscribeOutput({
          text: value.text,
          provider: value.provider,
          model: value.model,
          ...value.language === undefined ? {} : { language: value.language },
        }),
      }],
      presentationMeta: (_args, value) => ({ provider: value.provider, model: value.model }),
    },
    timeoutMs,
    // A transcription reads provider state and mutates nothing.
    isConcurrencySafe: () => true,
    async execute(args, exec) {
      const audio = await resolveMediaAudio(ctx, exec, args)
      const result = await ctx.media.transcribe({
        data: audio.data,
        mediaType: audio.mediaType,
        ...args.language === undefined || args.language.trim().length === 0
          ? {}
          : { language: args.language.trim() },
      }, exec.signal)
      return {
        provider: result.provider,
        model: result.model,
        text: result.text,
        ...result.language === undefined ? {} : { language: result.language },
      }
    },
    presentCall(args): GenericCallView {
      const label = args.path ?? args.attachmentId ?? 'the recording'
      return {
        card: 'generic',
        title: `Transcribe ${label}`,
        kind: 'read',
        ...args.path === undefined ? {} : { locations: [{ path: args.path }] },
      }
    },
  }))
}
