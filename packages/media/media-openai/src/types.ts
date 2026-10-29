/**
 * Provider-private wire types for the OpenAI-compatible media endpoints. Only
 * the fields the provider consumes are declared; a gateway may send more.
 * These types create no dependency on `ctx.llm`.
 *
 * @module @deepseek-ai/dsh-media-openai/types
 */

/** One `chat/completions` content part; only text parts are consumed. */
export interface OpenAiContentPart {
  type?: string
  text?: string | null
}

/** One `chat/completions` choice's message; `content` is either a string or content parts. */
export interface OpenAiMessage {
  content?: OpenAiContentPart[] | string | null
}

/** One `chat/completions` choice; only the message's content parts are consumed. */
export interface OpenAiChoice {
  message?: OpenAiMessage
}

/** The `chat/completions` response envelope. */
export interface OpenAiChatResponse {
  choices?: OpenAiChoice[]
}

/** One `images/generations` result: base64 bytes or a URL to download. */
export interface OpenAiImageItem {
  b64_json?: string
  url?: string
}

/** The `images/generations` response envelope. */
export interface OpenAiImageResponse {
  data?: OpenAiImageItem[]
}

/** The `audio/transcriptions` response envelope. */
export interface OpenAiTranscriptionResponse {
  text?: string
  /** Some gateways report the detected language beside the transcript. */
  language?: string
}

/** The provider error envelope (best-effort; fields vary by gateway). */
export interface OpenAiErrorEnvelope {
  error?: { message?: string } | string
  message?: string
}
