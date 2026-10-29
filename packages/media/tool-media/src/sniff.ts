/**
 * Image and audio container detection for the media tools. A model may name a
 * path whose extension is missing or wrong, so the bytes decide the media type
 * the provider is told; the attachment service's own decode stays authoritative
 * for anything that enters durable history.
 *
 * @module @deepseek-ai/dsh-tool-media/sniff
 */

import type { ImageMediaType } from '@deepseek-ai/dsh-attachment'

const PNG_SIGNATURE = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a] as const
const JPEG_SIGNATURE = [0xff, 0xd8, 0xff] as const

/**
 * Identify the media type declared by a supported image file signature.
 * @param data - file bytes read through the current filesystem backend.
 * @returns the detected supported media type, or undefined for other bytes.
 */
export function sniffImageMediaType(data: Uint8Array): ImageMediaType | undefined {
  if (matchesBytes(data, 0, PNG_SIGNATURE)) return 'image/png'
  if (matchesBytes(data, 0, JPEG_SIGNATURE)) return 'image/jpeg'
  if (matchesAscii(data, 0, 'GIF87a') || matchesAscii(data, 0, 'GIF89a')) return 'image/gif'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WEBP')) return 'image/webp'
  return undefined
}

/**
 * Identify the container media type declared by a supported audio signature.
 * The container is sent to the transcription provider, which needs it to name
 * the upload; an unrecognized signature is reported rather than guessed, since
 * a wrong container makes the provider fail on the upload itself.
 * @param data - file bytes read through the current filesystem backend.
 * @returns the detected container media type, or undefined for other bytes.
 */
export function sniffAudioMediaType(data: Uint8Array): string | undefined {
  if (matchesAscii(data, 0, 'OggS')) return 'audio/ogg'
  if (matchesAscii(data, 0, 'RIFF') && matchesAscii(data, 8, 'WAVE')) return 'audio/wav'
  if (matchesAscii(data, 0, 'fLaC')) return 'audio/flac'
  if (matchesAscii(data, 0, 'FORM') && (matchesAscii(data, 8, 'AIFF') || matchesAscii(data, 8, 'AIFC'))) return 'audio/aiff'
  if (matchesAscii(data, 4, 'ftyp')) return 'audio/mp4'
  if (matchesAscii(data, 0, 'ID3')) return 'audio/mpeg'
  // WebM and Matroska share the EBML magic; every browser recorder writes WebM,
  // and the provider reports a conflicting container from its own decoding.
  if (matchesBytes(data, 0, EBML_MAGIC)) return 'audio/webm'
  // A bare MPEG audio frame begins with eleven set sync bits.
  if (data.byteLength >= 2 && data[0] === 0xff && (data[1]! & 0xe0) === 0xe0) return 'audio/mpeg'
  return undefined
}

const EBML_MAGIC = [0x1a, 0x45, 0xdf, 0xa3] as const

function matchesBytes(data: Uint8Array, offset: number, expected: readonly number[]): boolean {
  if (data.byteLength < offset + expected.length) return false
  return expected.every((byte, index) => data[offset + index] === byte)
}

function matchesAscii(data: Uint8Array, offset: number, value: string): boolean {
  if (data.byteLength < offset + value.length) return false
  for (let index = 0; index < value.length; index += 1) {
    if (data[offset + index] !== value.charCodeAt(index)) return false
  }
  return true
}
