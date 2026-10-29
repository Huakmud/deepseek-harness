/**
 * Provider-private wire types for the native Google Gemini REST API
 * (`generativelanguage.googleapis.com`). The three operations use two
 * endpoints: `:generateContent` for describing and drawing, and the same
 * request shape with inline audio for transcription. Only the fields the
 * provider consumes are declared.
 *
 * @module @deepseek-ai/dsh-media-gemini/types
 */

/** One inline request part: base64 bytes plus their declared MIME type. */
export interface GeminiInlineData {
  mimeType: string
  data: string
}

/** One request part: text, inline bytes, or an opaque unsupported part. */
export type GeminiPart =
  | { text: string }
  | { inlineData: GeminiInlineData }
  | { inline_data?: GeminiInlineData }
  | { functionCall?: unknown }

/** One candidate's content envelope. */
export interface GeminiContent {
  parts?: GeminiPart[]
  role?: string
}

/** One generation candidate; `finishReason` explains an empty or blocked answer. */
export interface GeminiCandidate {
  content?: GeminiContent
  finishReason?: string
}

/** The `:generateContent` response envelope. */
export interface GeminiResponse {
  candidates?: GeminiCandidate[]
  /** Block-level refusal metadata when the answer was withheld. */
  promptFeedback?: { blockReason?: string }
}

/** The Gemini error envelope. */
export interface GeminiErrorEnvelope {
  error?: { message?: string; status?: string; code?: number }
}
