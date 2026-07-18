import { describe, it, expect, beforeEach } from 'vitest'
import { FakeStorageProvider } from '../../src/services/storage.provider'
import { NotFoundError } from '../../src/utils/errors'

describe('FakeStorageProvider', () => {
  let storage: FakeStorageProvider

  beforeEach(() => {
    storage = new FakeStorageProvider()
  })

  describe('presignUpload', () => {
    it('returns a fake upload URL preserving the key', async () => {
      const result = await storage.presignUpload('avatars/u1/abc/original', 'image/png', 900)

      expect(result.key).toBe('avatars/u1/abc/original')
      expect(result.uploadUrl).toContain('fake-storage.local')
      expect(result.uploadUrl).toContain('avatars')
    })
  })

  describe('putObject / getObject', () => {
    it('stores and returns the buffer verbatim', async () => {
      const key = 'avatars/u1/abc/original'
      const buffer = Buffer.from([1, 2, 3, 4, 5])

      await storage.putObject(key, buffer, 'image/png')
      const retrieved = await storage.getObject(key)

      expect(retrieved.equals(buffer)).toBe(true)
    })

    it('throws NotFoundError for missing objects', async () => {
      await expect(storage.getObject('missing')).rejects.toBeInstanceOf(NotFoundError)
    })
  })

  describe('deletePrefix', () => {
    it('removes only the objects under the supplied prefix', async () => {
      const a = Buffer.from('a')
      const b = Buffer.from('b')
      await storage.putObject('avatars/u1/asset1/small', a, 'image/webp')
      await storage.putObject('avatars/u1/asset1/large', a, 'image/png')
      await storage.putObject('avatars/u2/asset2/original', b, 'image/webp')

      await storage.deletePrefix('avatars/u1/asset1')

      await expect(storage.getObject('avatars/u1/asset1/small')).rejects.toBeInstanceOf(NotFoundError)
      await expect(storage.getObject('avatars/u1/asset1/large')).rejects.toBeInstanceOf(NotFoundError)
      // Other-user asset remains intact.
      const u2 = await storage.getObject('avatars/u2/asset2/original')
      expect(u2.equals(b)).toBe(true)
    })
  })

  describe('simulateUpload', () => {
    it('lets tests PUT bytes against a previously presigned key', async () => {
      const presign = await storage.presignUpload('avatars/u1/abc/original', 'image/png', 900)
      const buffer = Buffer.from([9, 9, 9])

      await storage.simulateUpload(presign.key, buffer, 'image/png')

      expect(storage.isUploaded(presign.key)).toBe(true)
      const retrieved = await storage.getObject(presign.key)
      expect(retrieved.equals(buffer)).toBe(true)
    })
  })

  describe('presignDownload', () => {
    it('returns a fake download URL containing the key', async () => {
      const url = await storage.presignDownload('avatars/u1/abc/large', 3600)

      expect(url).toContain('fake-storage.local')
      expect(url).toContain('avatars')
    })
  })
})
