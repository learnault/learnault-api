import type {
  ImageDimensions,
  SignedUploadUrl,
  StorageProvider,
} from '../../types/avatar.types'

/**
 * In-memory storage provider for development and testing.
 *
 * Objects are keyed by storageKey. This provider never leaks credentials,
 * supports signed-URL generation (returning a data: URL for local use),
 * and keeps all state in a static Map so tests can assert without disk I/O.
 */
export class InMemoryStorageProvider implements StorageProvider {
  /** In-memory bucket keyed by storageKey. */
  private readonly objects = new Map<string, Buffer>()

  async createSignedUpload(
    _userId: string,
    key: string,
    _contentType: string,
    expiresMs: number,
  ): Promise<SignedUploadUrl> {
    // The upload URL is a data-URL placeholder that a real client would
    // never use — the test harness or dev-fake path posts directly.
    return {
      uploadUrl: `data:placeholder/${key}`,
      storageKey: key,
      expiresAt: new Date(Date.now() + expiresMs),
    }
  }

  async readBytes(storageKey: string): Promise<Buffer> {
    const buf = this.objects.get(storageKey)
    if (!buf) {
      throw new Error(`Object not found: ${storageKey}`)
    }

    return Buffer.from(buf)
  }

  async writeBytes(
    storageKey: string,
    data: Buffer,
    _contentType: string,
  ): Promise<void> {
    this.objects.set(storageKey, Buffer.from(data))
  }

  async deleteObject(storageKey: string): Promise<void> {
    this.objects.delete(storageKey)
  }

  getServingUrl(storageKey: string): string {
    return `/storage/${storageKey}`
  }

  // ── Test helpers ──────────────────────────────────────────────────

  /** Directly store bytes (for test setup without going through the upload flow). */
  put(storageKey: string, data: Buffer): void {
    this.objects.set(storageKey, data)
  }

  /** Check if an object exists. */
  has(storageKey: string): boolean {
    return this.objects.has(storageKey)
  }

  /** Return the number of stored objects. */
  get size(): number {
    return this.objects.size
  }

  /** Clear all stored objects (for test teardown). */
  clear(): void {
    this.objects.clear()
  }
}

// ── Minimal image dimension extraction (no external deps) ─────────

const PNG_IHDR_SIGNATURE = Buffer.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a,
])
const GIF87A = Buffer.from('GIF87a')
const GIF89A = Buffer.from('GIF89a')
const WEBP_RIFF = Buffer.from('RIFF')
const WEBP_WEBP = Buffer.from('WEBP')
const JPEG_SOI = Buffer.from([0xff, 0xd8])

/**
 * Extract image dimensions from raw bytes without pulling in sharp/canvas.
 * Returns null when the format is unrecognised or the header is truncated.
 */
export function extractImageDimensions(data: Buffer): ImageDimensions | null {
  if (data.length < 24) {
    return null
  }

  // PNG — IHDR chunk at offset 16 (after 8-byte signature + 4-byte length + 4-byte "IHDR")
  if (data.subarray(0, 8).equals(PNG_IHDR_SIGNATURE)) {
    const width = data.readUInt32BE(16)
    const height = data.readUInt32BE(20)

    return { width, height }
  }

  // GIF — dimensions at bytes 6-9
  if (
    data.subarray(0, 6).equals(GIF87A) ||
    data.subarray(0, 6).equals(GIF89A)
  ) {
    const width = data.readUInt16LE(6)
    const height = data.readUInt16LE(8)

    return { width, height }
  }

  // JPEG — SOI marker
  if (data.subarray(0, 2).equals(JPEG_SOI)) {
    return parseJpegDimensions(data)
  }

  // WebP — RIFF....WEBP
  if (
    data.subarray(0, 4).equals(WEBP_RIFF) &&
    data.subarray(8, 12).equals(WEBP_WEBP)
  ) {
    return parseWebpDimensions(data)
  }

  return null
}

function parseJpegDimensions(data: Buffer): ImageDimensions | null {
  let offset = 2
  while (offset < data.length - 1) {
    if (data[offset] !== 0xff) {
      return null
    }
    const marker = data[offset + 1]
    // SOF0–SOF3, SOF5–SOF7, SOF9–SOF11, SOF13–SOF15
    if (
      (marker >= 0xc0 && marker <= 0xc3) ||
      (marker >= 0xc5 && marker <= 0xc7) ||
      (marker >= 0xc9 && marker <= 0xcb) ||
      (marker >= 0xcd && marker <= 0xcf)
    ) {
      if (offset + 9 >= data.length) {
        return null
      }
      const height = data.readUInt16BE(offset + 5)
      const width = data.readUInt16BE(offset + 7)

      return { width, height }
    }
    if (marker === 0xda) {
      break // SOS — start of scan, no more markers
    }
    if (marker === 0xd9) {
      break // EOI
    }
    if (marker === 0x00) {
      offset++
      continue
    }
    if (offset + 3 >= data.length) {
      return null
    }
    const segLen = data.readUInt16BE(offset + 2)
    offset += 2 + segLen
  }

  return null
}

function parseWebpDimensions(data: Buffer): ImageDimensions | null {
  // VP8 lossy — width/height stored as (actual - 1)
  if (data.subarray(12, 16).equals(Buffer.from('VP8 '))) {
    if (data.length < 30) {
      return null
    }
    const width = (data.readUInt16LE(26) & 0x3fff) + 1
    const height = (data.readUInt16LE(28) & 0x3fff) + 1

    return { width, height }
  }
  // VP8L lossless — already stored as (actual - 1)
  if (data.subarray(12, 16).equals(Buffer.from('VP8L'))) {
    if (data.length < 25) {
      return null
    }
    const bits = data.readUInt32LE(21)
    const width = (bits & 0x3fff) + 1
    const height = ((bits >> 14) & 0x3fff) + 1

    return { width, height }
  }
  // VP8X extended — stored as (actual - 1)
  if (data.subarray(12, 16).equals(Buffer.from('VP8X'))) {
    if (data.length < 30) {
      return null
    }
    const width = data.readUInt32LE(20) + 1
    const height = data.readUInt32LE(24) + 1

    return { width, height }
  }

  return null
}

// ── MIME sniffing from magic bytes ────────────────────────────────

const MIME_SIGNATURES: Array<{ bytes: Uint8Array; mime: string }> = [
  {
    bytes: new Uint8Array([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    mime: 'image/png',
  },
  { bytes: new Uint8Array([0xff, 0xd8, 0xff]), mime: 'image/jpeg' },
  { bytes: new Uint8Array([0x47, 0x49, 0x46, 0x38]), mime: 'image/gif' },
  { bytes: new Uint8Array([0x52, 0x49, 0x46, 0x46]), mime: 'image/webp' }, // RIFF container (WebP)
]

/**
 * Detect the real MIME type from the first bytes of a buffer.
 * Does not rely on file extensions or the declared Content-Type.
 */
export function sniffMimeType(data: Buffer): string | null {
  for (const sig of MIME_SIGNATURES) {
    if (data.length >= sig.bytes.length) {
      let match = true
      for (let i = 0; i < sig.bytes.length; i++) {
        if (data[i] !== sig.bytes[i]) {
          match = false
          break
        }
      }
      if (match) {
        return sig.mime
      }
    }
  }

  return null
}
