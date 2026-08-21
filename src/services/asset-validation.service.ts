import {
  AVATAR_ALLOWED_MIME_TYPES,
  AVATAR_MAX_BYTES,
  AVATAR_MIN_BYTES,
} from '../types/avatar.types'
import { sniffMimeType, extractImageDimensions } from './storage/in-memory-storage'

export interface ValidationResult {
  ok: boolean
  detectedMime: string | null
  dimensions: { width: number, height: number } | null
  error?: string
}

/**
 * Server-side validation of uploaded image bytes.
 *
 * Performs:
 * 1. Size bounds check (min/max)
 * 2. Magic-byte MIME sniffing (not trusting the declared type)
 * 3. MIME spoofing detection (declared vs detected mismatch)
 * 4. Image dimension extraction
 *
 * Storage credentials are never exposed through this interface.
 */
export function validateAvatarBytes(
  data: Buffer,
  declaredContentType: string,
  sizeBytes?: number,
): ValidationResult {
  // ── Size check ────────────────────────────────────────────────
  const actualSize = sizeBytes ?? data.length
  if (actualSize < AVATAR_MIN_BYTES) {
    return { ok: false, detectedMime: null, dimensions: null, error: 'File too small (minimum 1 KB)' }
  }
  if (actualSize > AVATAR_MAX_BYTES) {
    return { ok: false, detectedMime: null, dimensions: null, error: 'File too large (maximum 5 MB)' }
  }
  if (data.length > AVATAR_MAX_BYTES) {
    return { ok: false, detectedMime: null, dimensions: null, error: 'File too large (maximum 5 MB)' }
  }

  // ── MIME sniff from magic bytes ───────────────────────────────
  const detectedMime = sniffMimeType(data)
  if (!detectedMime) {
    return { ok: false, detectedMime: null, dimensions: null, error: 'Unrecognised image format' }
  }

  // ── Allowlist check ───────────────────────────────────────────
  if (!(AVATAR_ALLOWED_MIME_TYPES as readonly string[]).includes(detectedMime)) {
    return { ok: false, detectedMime, dimensions: null, error: `Unsupported image type: ${detectedMime}` }
  }

  // ── MIME spoofing detection ───────────────────────────────────
  // If the client declared a type that doesn't match what we sniffed,
  // reject — this catches cases where the extension or Content-Type
  // header was tampered with.
  const declaredNormalised = declaredContentType.split(';')[0].trim().toLowerCase()
  if (declaredNormalised !== detectedMime) {
    return {
      ok: false,
      detectedMime,
      dimensions: null,
      error: `MIME mismatch: declared "${declaredContentType}" but file is "${detectedMime}"`,
    }
  }

  // ── Dimensions extraction ─────────────────────────────────────
  const dimensions = extractImageDimensions(data)

  return { ok: true, detectedMime, dimensions }
}
