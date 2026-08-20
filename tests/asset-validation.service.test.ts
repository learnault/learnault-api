import { describe, it, expect } from 'vitest'
import { validateAvatarBytes } from '../src/services/asset-validation.service'

// ── Test image fixtures ────────────────────────────────────────────
// Minimal valid images built from their binary headers.

/** 1×1 red PNG */
function makePng(width = 1, height = 1): Buffer {
  // Minimal PNG: signature + IHDR + IDAT + IEND
  const signature = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])

  // IHDR chunk
  const ihdrData = Buffer.alloc(13)
  ihdrData.writeUInt32BE(width, 0)   // width
  ihdrData.writeUInt32BE(height, 4)  // height
  ihdrData.writeUInt8(8, 8)          // bit depth
  ihdrData.writeUInt8(2, 9)          // color type (RGB)
  ihdrData.writeUInt8(0, 10)         // compression
  ihdrData.writeUInt8(0, 11)         // filter
  ihdrData.writeUInt8(0, 12)         // interlace
  const ihdrCrc = crc32(Buffer.concat([Buffer.from('IHDR'), ihdrData]))
  const ihdr = Buffer.alloc(25)
  ihdr.writeUInt32BE(13, 0) // length
  ihdr.write('IHDR', 4)
  ihdrData.copy(ihdr, 8)
  ihdr.writeUInt32BE(ihdrCrc, 21)

  // IDAT chunk (empty compressed data — just valid enough for dimension parsing)
  const idatData = Buffer.from([0x08, 0xd7, 0x01, 0x04, 0x00, 0xfb, 0xff, 0xfd, 0x02, 0x40, 0x02])
  const idatCrc = crc32(Buffer.concat([Buffer.from('IDAT'), idatData]))
  const idat = Buffer.alloc(4 + 4 + idatData.length + 4)
  idat.writeUInt32BE(idatData.length, 0)
  idat.write('IDAT', 4)
  idatData.copy(idat, 8)
  idat.writeUInt32BE(idatCrc, 8 + idatData.length)

  // IEND chunk
  const iendCrc = crc32(Buffer.from('IEND'))
  const iend = Buffer.alloc(12)
  iend.writeUInt32BE(0, 0)
  iend.write('IEND', 4)
  iend.writeUInt32BE(iendCrc, 8)

  return Buffer.concat([signature, ihdr, idat, iend])
}

/** Minimal JPEG SOI + SOF0 marker with dimensions */
function makeJpeg(width = 100, height = 50): Buffer {
  const buf = Buffer.alloc(64)
  buf.writeUInt8(0xff, 0)
  buf.writeUInt8(0xd8, 1) // SOI

  // SOF0 marker
  buf.writeUInt8(0xff, 2)
  buf.writeUInt8(0xc0, 3) // SOF0
  buf.writeUInt16BE(17, 4) // segment length
  buf.writeUInt8(8, 6)     // precision
  buf.writeUInt16BE(height, 7)
  buf.writeUInt16BE(width, 9)

  return buf
}

/** GIF89a with dimensions at bytes 6-9 */
function makeGif(width = 20, height = 10): Buffer {
  const buf = Buffer.alloc(13)
  buf.write('GIF89a', 0, 'ascii')
  buf.writeUInt16LE(width, 6)
  buf.writeUInt16LE(height, 8)

  return buf
}

/** Minimal VP8 WebP */
function makeWebp(width = 80, height = 60): Buffer {
  const buf = Buffer.alloc(50)
  buf.write('RIFF', 0, 'ascii')
  buf.writeUInt32LE(38, 4)  // file size
  buf.write('WEBP', 8, 'ascii')
  buf.write('VP8 ', 12, 'ascii')
  buf.writeUInt32LE(30, 16) // chunk size
  // VP8 bitstream header stores (actual - 1) at offsets 26-29
  buf.writeUInt16LE(width - 1, 26)
  buf.writeUInt16LE(height - 1, 28)

  return buf
}

// CRC-32 for PNG chunk validation
function crc32(buf: Buffer): number {
  let crc = 0xffffffff
  for (let i = 0; i < buf.length; i++) {
    crc ^= buf[i]
    for (let j = 0; j < 8; j++) {
      crc = (crc >>> 1) ^ (crc & 1 ? 0xedb88320 : 0)
    }
  }

  return (crc ^ 0xffffffff) >>> 0
}

// ── Tests ──────────────────────────────────────────────────────────

describe('validateAvatarBytes', () => {
  describe('size validation', () => {
    it('rejects files smaller than 1 KB', () => {
      const tinyPng = makePng(1, 1)
      // Pad to 500 bytes (under 1 KB min) but must still have valid magic bytes
      const small = Buffer.alloc(500)
      tinyPng.copy(small)
      const result = validateAvatarBytes(small, 'image/png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too small/i)
    })

    it('rejects files larger than 5 MB', () => {
      const hugePng = makePng(1, 1)
      const result = validateAvatarBytes(hugePng, 'image/png', 6 * 1024 * 1024)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too large/i)
    })

    it('rejects buffer exceeding 5 MB even if sizeBytes is small', () => {
      const bigBuf = Buffer.alloc(6 * 1024 * 1024)
      makePng().copy(bigBuf)
      const result = validateAvatarBytes(bigBuf, 'image/png', 1024)
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/too large/i)
    })
  })

  describe('MIME sniffing and allowlist', () => {
    it('accepts a valid PNG with matching declared type', () => {
      const png = makePng(1, 1)
      const padded = Buffer.alloc(2048)
      png.copy(padded)
      const result = validateAvatarBytes(padded, 'image/png')
      expect(result.ok).toBe(true)
      expect(result.detectedMime).toBe('image/png')
    })

    it('accepts a valid JPEG with matching declared type', () => {
      const jpeg = makeJpeg(100, 50)
      const padded = Buffer.alloc(2048)
      jpeg.copy(padded)
      const result = validateAvatarBytes(padded, 'image/jpeg')
      expect(result.ok).toBe(true)
      expect(result.detectedMime).toBe('image/jpeg')
    })

    it('accepts a valid GIF with matching declared type', () => {
      const gif = makeGif(20, 10)
      const padded = Buffer.alloc(2048)
      gif.copy(padded)
      const result = validateAvatarBytes(padded, 'image/gif')
      expect(result.ok).toBe(true)
      expect(result.detectedMime).toBe('image/gif')
    })

    it('accepts a valid WebP with matching declared type', () => {
      const webp = makeWebp(80, 60)
      const padded = Buffer.alloc(2048)
      webp.copy(padded)
      const result = validateAvatarBytes(padded, 'image/webp')
      expect(result.ok).toBe(true)
      expect(result.detectedMime).toBe('image/webp')
    })

    it('rejects unrecognised formats', () => {
      const junk = Buffer.alloc(2048)
      junk[0] = 0x00
      junk[1] = 0x01
      const result = validateAvatarBytes(junk, 'image/png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/unrecognised/i)
    })
  })

  describe('MIME spoofing detection', () => {
    it('rejects a PNG declared as image/jpeg', () => {
      const png = makePng(1, 1)
      const padded = Buffer.alloc(2048)
      png.copy(padded)
      const result = validateAvatarBytes(padded, 'image/jpeg')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/mismatch/i)
      expect(result.detectedMime).toBe('image/png')
    })

    it('rejects a JPEG declared as image/png', () => {
      const jpeg = makeJpeg(100, 50)
      const padded = Buffer.alloc(2048)
      jpeg.copy(padded)
      const result = validateAvatarBytes(padded, 'image/png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/mismatch/i)
      expect(result.detectedMime).toBe('image/jpeg')
    })

    it('rejects a GIF declared as image/webp', () => {
      const gif = makeGif(20, 10)
      const padded = Buffer.alloc(2048)
      gif.copy(padded)
      const result = validateAvatarBytes(padded, 'image/webp')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/mismatch/i)
    })

    it('rejects an executable file declared as image/png', () => {
      // MZ header (PE executable)
      const exe = Buffer.alloc(2048)
      exe[0] = 0x4d // M
      exe[1] = 0x5a // Z
      const result = validateAvatarBytes(exe, 'image/png')
      expect(result.ok).toBe(false)
      expect(result.error).toMatch(/unrecognised/i)
    })
  })

  describe('dimension extraction', () => {
    it('extracts PNG dimensions', () => {
      const png = makePng(300, 200)
      const padded = Buffer.alloc(2048)
      png.copy(padded)
      const result = validateAvatarBytes(padded, 'image/png')
      expect(result.ok).toBe(true)
      expect(result.dimensions).toEqual({ width: 300, height: 200 })
    })

    it('extracts JPEG dimensions', () => {
      const jpeg = makeJpeg(800, 600)
      const padded = Buffer.alloc(2048)
      jpeg.copy(padded)
      const result = validateAvatarBytes(padded, 'image/jpeg')
      expect(result.ok).toBe(true)
      expect(result.dimensions).toEqual({ width: 800, height: 600 })
    })

    it('extracts GIF dimensions', () => {
      const gif = makeGif(150, 75)
      const padded = Buffer.alloc(2048)
      gif.copy(padded)
      const result = validateAvatarBytes(padded, 'image/gif')
      expect(result.ok).toBe(true)
      expect(result.dimensions).toEqual({ width: 150, height: 75 })
    })

    it('extracts WebP dimensions', () => {
      const webp = makeWebp(400, 300)
      const padded = Buffer.alloc(2048)
      webp.copy(padded)
      const result = validateAvatarBytes(padded, 'image/webp')
      expect(result.ok).toBe(true)
      expect(result.dimensions).toEqual({ width: 400, height: 300 })
    })
  })

  describe('Content-Type normalisation', () => {
    it('strips parameters before comparing MIME types', () => {
      const png = makePng(1, 1)
      const padded = Buffer.alloc(2048)
      png.copy(padded)
      const result = validateAvatarBytes(padded, 'image/png; charset=binary')
      expect(result.ok).toBe(true)
    })

    it('is case-insensitive for the declared type', () => {
      const png = makePng(1, 1)
      const padded = Buffer.alloc(2048)
      png.copy(padded)
      const result = validateAvatarBytes(padded, 'Image/PNG')
      expect(result.ok).toBe(true)
    })
  })
})
