import { describe, it, expect, beforeEach } from 'vitest'
import {
  InMemoryStorageProvider,
  sniffMimeType,
  extractImageDimensions,
} from '../src/services/storage/in-memory-storage'

describe('InMemoryStorageProvider', () => {
  let provider: InMemoryStorageProvider

  beforeEach(() => {
    provider = new InMemoryStorageProvider()
  })

  describe('createSignedUpload', () => {
    it('returns a placeholder upload URL and storage key', async () => {
      const result = await provider.createSignedUpload(
        'user1',
        'avatars/user1/abc/file.jpg',
        'image/jpeg',
        60_000,
      )

      expect(result.storageKey).toBe('avatars/user1/abc/file.jpg')
      expect(result.uploadUrl).toContain('avatars/user1/abc/file.jpg')
      expect(result.expiresAt).toBeInstanceOf(Date)
      expect(result.expiresAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('storage credentials are never returned', async () => {
      const result = await provider.createSignedUpload(
        'user1',
        'avatars/user1/abc/file.jpg',
        'image/jpeg',
        60_000,
      )

      const urlStr = JSON.stringify(result)
      expect(urlStr).not.toMatch(/secret/i)
      expect(urlStr).not.toMatch(/password/i)
      expect(urlStr).not.toMatch(/access.?key/i)
      expect(urlStr).not.toMatch(/credential/i)
    })
  })

  describe('writeBytes / readBytes', () => {
    it('stores and retrieves bytes', async () => {
      const data = Buffer.from('hello world')
      await provider.writeBytes('key1', data, 'text/plain')
      const retrieved = await provider.readBytes('key1')
      expect(retrieved.equals(data)).toBe(true)
    })

    it('returns a copy, not a reference', async () => {
      const data = Buffer.from('original')
      await provider.writeBytes('key1', data, 'text/plain')
      data[0] = 0xff // mutate original
      const retrieved = await provider.readBytes('key1')
      expect(retrieved[0]).toBe(0x6f) // 'o' — unchanged
    })

    it('throws on missing key', async () => {
      await expect(provider.readBytes('nonexistent')).rejects.toThrow(
        'not found',
      )
    })
  })

  describe('deleteObject', () => {
    it('removes an object', async () => {
      await provider.writeBytes('key1', Buffer.from('data'), 'text/plain')
      expect(provider.has('key1')).toBe(true)
      await provider.deleteObject('key1')
      expect(provider.has('key1')).toBe(false)
    })

    it('is idempotent', async () => {
      await provider.deleteObject('nonexistent')
      // No error
    })
  })

  describe('getServingUrl', () => {
    it('returns a path-style URL', () => {
      const url = provider.getServingUrl('avatars/user1/abc/file.jpg')
      expect(url).toBe('/storage/avatars/user1/abc/file.jpg')
    })
  })

  describe('test helpers', () => {
    it('put and has track state', () => {
      provider.put('k', Buffer.from('v'))
      expect(provider.has('k')).toBe(true)
      expect(provider.size).toBe(1)
    })

    it('clear resets all state', () => {
      provider.put('k1', Buffer.from('v1'))
      provider.put('k2', Buffer.from('v2'))
      provider.clear()
      expect(provider.size).toBe(0)
      expect(provider.has('k1')).toBe(false)
    })
  })
})

describe('sniffMimeType', () => {
  it('detects PNG', () => {
    const buf = Buffer.from([
      0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00,
    ])
    expect(sniffMimeType(buf)).toBe('image/png')
  })

  it('detects JPEG', () => {
    const buf = Buffer.from([0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10])
    expect(sniffMimeType(buf)).toBe('image/jpeg')
  })

  it('detects GIF', () => {
    const buf = Buffer.from('GIF89a')
    expect(sniffMimeType(buf)).toBe('image/gif')
  })

  it('detects WebP via RIFF header', () => {
    const buf = Buffer.from('RIFF\x00\x00\x00\x00WEBP')
    expect(sniffMimeType(buf)).toBe('image/webp')
  })

  it('returns null for empty buffer', () => {
    expect(sniffMimeType(Buffer.alloc(0))).toBeNull()
  })

  it('returns null for unknown bytes', () => {
    const buf = Buffer.from([0x00, 0x01, 0x02, 0x03, 0x04, 0x05, 0x06, 0x07])
    expect(sniffMimeType(buf)).toBeNull()
  })
})

describe('extractImageDimensions', () => {
  it('extracts PNG dimensions from IHDR', () => {
    // Build minimal PNG with 300×200 dimensions
    const buf = Buffer.alloc(64)
    // PNG signature (8 bytes) + IHDR length (4) + IHDR type (4) + data starts at 16
    buf[0] = 0x89
    buf[1] = 0x50
    buf[2] = 0x4e
    buf[3] = 0x47
    buf[4] = 0x0d
    buf[5] = 0x0a
    buf[6] = 0x1a
    buf[7] = 0x0a
    buf.writeUInt32BE(300, 16) // width
    buf.writeUInt32BE(200, 20) // height
    const dims = extractImageDimensions(buf)
    expect(dims).toEqual({ width: 300, height: 200 })
  })

  it('extracts JPEG dimensions from SOF marker', () => {
    const buf = Buffer.alloc(64)
    buf[0] = 0xff
    buf[1] = 0xd8 // SOI
    buf[2] = 0xff
    buf[3] = 0xc0 // SOF0
    buf.writeUInt16BE(17, 4) // segment length
    buf.writeUInt8(8, 6) // precision
    buf.writeUInt16BE(50, 7) // height
    buf.writeUInt16BE(100, 9) // width
    const dims = extractImageDimensions(buf)
    expect(dims).toEqual({ width: 100, height: 50 })
  })

  it('extracts GIF dimensions', () => {
    const buf = Buffer.alloc(24)
    buf.write('GIF89a', 0, 'ascii')
    buf.writeUInt16LE(80, 6)
    buf.writeUInt16LE(60, 8)
    const dims = extractImageDimensions(buf)
    expect(dims).toEqual({ width: 80, height: 60 })
  })

  it('extracts WebP VP8 dimensions', () => {
    const buf = Buffer.alloc(50)
    buf.write('RIFF', 0, 'ascii')
    buf.writeUInt32LE(38, 4)
    buf.write('WEBP', 8, 'ascii')
    buf.write('VP8 ', 12, 'ascii')
    buf.writeUInt32LE(30, 16) // VP8 chunk size
    // VP8 stores (actual - 1) at offsets 26-29
    buf.writeUInt16LE(199, 26) // width - 1
    buf.writeUInt16LE(149, 28) // height - 1
    const dims = extractImageDimensions(buf)
    expect(dims).toEqual({ width: 200, height: 150 })
  })

  it('returns null for too-small buffer', () => {
    expect(extractImageDimensions(Buffer.alloc(4))).toBeNull()
  })

  it('returns null for unknown format', () => {
    const buf = Buffer.alloc(64)
    buf[0] = 0x00
    expect(extractImageDimensions(buf)).toBeNull()
  })
})
