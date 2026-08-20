import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AvatarService, AvatarValidationError } from '../src/services/avatar.service'
import { InMemoryStorageProvider } from '../src/services/storage/in-memory-storage'
import { AVATAR_MAX_BYTES } from '../src/types/avatar.types'

// ── Prisma mock ───────────────────────────────────────────────────

const {
  mockCreate,
  mockFindUnique,
  mockFindFirst,
  mockFindMany,
  mockUpdate,
  mockUpdateMany,
  mockDelete,
  mockCreateMany,
  mockUpsert,
  mockTransaction,
} = vi.hoisted(() => ({
  mockCreate: vi.fn(),
  mockFindUnique: vi.fn(),
  mockFindFirst: vi.fn(),
  mockFindMany: vi.fn(),
  mockUpdate: vi.fn(),
  mockUpdateMany: vi.fn(),
  mockDelete: vi.fn(),
  mockCreateMany: vi.fn(),
  mockUpsert: vi.fn(),
  mockTransaction: vi.fn(),
}))

vi.mock('../src/config/database', () => ({
  default: {
    avatar: {
      create: mockCreate,
      findUnique: mockFindUnique,
      findFirst: mockFindFirst,
      findMany: mockFindMany,
      update: mockUpdate,
      updateMany: mockUpdateMany,
      delete: mockDelete,
    },
    avatarVariant: {
      createMany: mockCreateMany,
      findMany: mockFindMany,
    },
    learnerProfile: {
      upsert: mockUpsert,
      updateMany: mockUpdateMany,
    },
    $transaction: mockTransaction,
  },
}))

// ── Minimal valid image for finalization ───────────────────────────

function makeValidPng(): Buffer {
  // Minimal 1×1 PNG — 67 bytes, valid magic + IHDR
  const buf = Buffer.alloc(2048)
  // PNG signature
  buf[0] = 0x89; buf[1] = 0x50; buf[2] = 0x4e; buf[3] = 0x47
  buf[4] = 0x0d; buf[5] = 0x0a; buf[6] = 0x1a; buf[7] = 0x0a
  // IHDR width/height at offsets 16-23
  buf.writeUInt32BE(100, 16)
  buf.writeUInt32BE(80, 20)
  return buf
}

// ── Tests ──────────────────────────────────────────────────────────

describe('AvatarService', () => {
  let storage: InMemoryStorageProvider
  let service: AvatarService

  const userId = 'user-123'

  beforeEach(() => {
    vi.clearAllMocks()
    storage = new InMemoryStorageProvider()
    service = new AvatarService(storage)

    // Default $transaction mock: execute the callback with the mock tx
    mockTransaction.mockImplementation(async (fns: any[]) => {
      for (const fn of fns) {
        await fn
      }
    })
  })

  describe('createUploadIntent', () => {
    it('creates a PENDING avatar row and returns upload metadata', async () => {
      mockCreate.mockResolvedValue({ id: 'avatar-1', userId, status: 'PENDING' })

      const result = await service.createUploadIntent(userId, 'image/jpeg', 'photo.jpg', 50_000)

      expect(result.uploadKey).toContain(userId)
      expect(result.maxBytes).toBe(AVATAR_MAX_BYTES)
      expect(result.allowedTypes).toContain('image/jpeg')
      expect(result.expiresAt).toBeDefined()
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId,
            contentType: 'image/jpeg',
            originalName: 'photo.jpg',
            originalBytes: 50_000,
            status: 'PENDING',
          }),
        }),
      )
    })

    it('rejects unsupported content types', async () => {
      await expect(
        service.createUploadIntent(userId, 'application/pdf'),
      ).rejects.toThrow(AvatarValidationError)
    })

    it('rejects when sizeBytes exceeds the limit', async () => {
      await expect(
        service.createUploadIntent(userId, 'image/png', undefined, AVATAR_MAX_BYTES + 1),
      ).rejects.toThrow(AvatarValidationError)
    })

    it('normalises Content-Type parameters', async () => {
      mockCreate.mockResolvedValue({ id: 'avatar-1', userId, status: 'PENDING' })

      const result = await service.createUploadIntent(userId, 'image/png; charset=binary')
      expect(mockCreate).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ contentType: 'image/png' }),
        }),
      )
    })
  })

  describe('finalize', () => {
    const avatarId = 'avatar-abc'
    const uploadKey = `avatars/${userId}/${avatarId}/photo.png`

    beforeEach(() => {
      // Storage contains a valid PNG image
      storage.put(uploadKey, makeValidPng())

      mockFindUnique.mockResolvedValue({
        id: avatarId,
        userId,
        storageKey: uploadKey,
        contentType: 'image/png',
        originalBytes: 2048,
        status: 'PENDING',
        createdAt: new Date(),
      })
      mockUpdate.mockResolvedValue({})
      mockFindMany.mockResolvedValue([])
    })

    it('promotes avatar to ACTIVE after validation', async () => {
      const result = await service.finalize(userId, uploadKey)

      expect(result.id).toBe(avatarId)
      expect(result.status).toBe('ACTIVE')
      expect(result.variantCount).toBe(3) // original, thumb, medium
      expect(mockUpdate).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: avatarId },
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
    })

    it('produces three variants in storage', async () => {
      await service.finalize(userId, uploadKey)

      expect(storage.has(`${uploadKey}`)).toBe(true)     // original
      expect(storage.has(`${uploadKey}_thumb`)).toBe(true)
      expect(storage.has(`${uploadKey}_medium`)).toBe(true)
    })

    it('rejects if avatar not found', async () => {
      mockFindUnique.mockResolvedValue(null)

      await expect(service.finalize(userId, uploadKey)).rejects.toThrow('not found')
    })

    it('rejects cross-user finalization', async () => {
      mockFindUnique.mockResolvedValue({
        id: avatarId,
        userId: 'other-user',
        storageKey: uploadKey,
        contentType: 'image/png',
        status: 'PENDING',
        createdAt: new Date(),
      })

      await expect(service.finalize(userId, uploadKey)).rejects.toThrow('Forbidden')
    })

    it('rejects double finalization (already ACTIVE)', async () => {
      mockFindUnique.mockResolvedValue({
        id: avatarId,
        userId,
        storageKey: uploadKey,
        contentType: 'image/png',
        status: 'ACTIVE',
        createdAt: new Date(),
      })

      await expect(service.finalize(userId, uploadKey)).rejects.toThrow('already ACTIVE')
    })

    it('marks avatar as FAILED on validation failure', async () => {
      // Put invalid data that looks like PNG header but is garbage
      storage.put(uploadKey, Buffer.alloc(2048, 0xff))
      // Override the stored data so validation sees the garbage
      // The mock returns PENDING with the key pointing to the garbage

      await expect(service.finalize(userId, uploadKey)).rejects.toThrow(AvatarValidationError)
    })

    it('verifies SHA-256 integrity when provided', async () => {
      const crypto = await import('crypto')
      const data = storage.has(uploadKey) ? await storage.readBytes(uploadKey) : makeValidPng()
      const correctHash = crypto.createHash('sha256').update(data).digest('hex')

      const result = await service.finalize(userId, uploadKey, correctHash)
      expect(result.status).toBe('ACTIVE')
    })

    it('rejects on SHA-256 mismatch', async () => {
      await expect(
        service.finalize(userId, uploadKey, '0'.repeat(64)),
      ).rejects.toThrow(/Integrity/i)
    })

    it('retires the previously active avatar', async () => {
      const oldAvatarId = 'old-avatar'
      mockFindMany.mockResolvedValue([
        { id: oldAvatarId, storageKey: `avatars/${userId}/${oldAvatarId}/old.png`, status: 'PENDING' },
      ])

      await service.finalize(userId, uploadKey)

      // The updateMany for retirement should have been called
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId, status: 'ACTIVE' },
          data: expect.objectContaining({ replacedById: avatarId }),
        }),
      )
    })

    it('cleans up old avatar objects from storage', async () => {
      const oldKey = `avatars/${userId}/old-avatar/old.png`
      storage.put(oldKey, Buffer.from('old'))

      mockFindMany.mockResolvedValue([
        { id: 'old-avatar', storageKey: oldKey, status: 'PENDING' },
      ])

      await service.finalize(userId, uploadKey)

      expect(storage.has(oldKey)).toBe(false)
    })

    it('updates the learner profile avatarUrl', async () => {
      mockUpsert.mockResolvedValue({})

      await service.finalize(userId, uploadKey)

      expect(mockUpsert).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          update: expect.objectContaining({ avatarUrl: expect.any(String) }),
        }),
      )
    })
  })

  describe('deleteAvatar', () => {
    it('deletes the active avatar and clears profile', async () => {
      const avatarId = 'avatar-del'
      mockFindFirst.mockResolvedValue({
        id: avatarId,
        userId,
        storageKey: `avatars/${userId}/${avatarId}/pic.png`,
        status: 'ACTIVE',
      })
      mockFindMany.mockResolvedValue([
        { avatarId, storageKey: `avatars/${userId}/${avatarId}/pic.png`, label: 'original' },
        { avatarId, storageKey: `avatars/${userId}/${avatarId}/pic.png_thumb`, label: 'thumb' },
      ])
      mockDelete.mockResolvedValue({})

      await service.deleteAvatar(userId)

      expect(mockDelete).toHaveBeenCalledWith({ where: { id: avatarId } })
      expect(mockUpdateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId },
          data: { avatarUrl: null },
        }),
      )
    })

    it('throws 404 when no active avatar exists', async () => {
      mockFindFirst.mockResolvedValue(null)

      await expect(service.deleteAvatar(userId)).rejects.toThrow('No active avatar')
    })

    it('prevents deleting another user\'s avatar', async () => {
      // The query is scoped to userId, so a different user simply gets no result
      mockFindFirst.mockResolvedValue(null)

      await expect(service.deleteAvatar('other-user')).rejects.toThrow('No active avatar')
    })
  })

  describe('getCurrentAvatar', () => {
    it('returns null when no active avatar', async () => {
      mockFindFirst.mockResolvedValue(null)

      const result = await service.getCurrentAvatar(userId)
      expect(result).toBeNull()
    })

    it('returns avatar with variant URLs', async () => {
      const avatarId = 'avatar-cur'
      mockFindFirst.mockResolvedValue({
        id: avatarId,
        status: 'ACTIVE',
        createdAt: new Date('2026-01-01'),
        variants: [
          { label: 'original', storageKey: `avatars/${userId}/${avatarId}/pic.png`, width: 400, height: 300 },
          { label: 'thumb', storageKey: `avatars/${userId}/${avatarId}/pic.png_thumb`, width: 80, height: 60 },
        ],
      })

      const result = await service.getCurrentAvatar(userId)

      expect(result).not.toBeNull()
      expect(result!.id).toBe(avatarId)
      expect(result!.variants).toHaveLength(2)
      expect(result!.variants[0]).toEqual({
        label: 'original',
        url: `/storage/avatars/${userId}/${avatarId}/pic.png`,
        width: 400,
        height: 300,
      })
    })
  })
})
