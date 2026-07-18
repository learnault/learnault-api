import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../../src/config/database', () => {
  const fn = () => vi.fn()

  return {
    default: {
      uploadIntent: {
        create: fn(),
        findUnique: fn(),
        update: fn(),
        updateMany: fn(),
      },
      uploadProcessingJob: {
        create: fn(),
        findMany: fn().mockResolvedValue([]),
        update: fn(),
      },
      asset: {
        create: fn(),
        findUnique: fn(),
        findFirst: fn(),
        findMany: fn(),
        update: fn(),
        updateMany: fn(),
      },
      assetVariant: {
        createMany: fn(),
        updateMany: fn(),
      },
      learnerProfile: {
        updateMany: fn(),
      },
      $transaction: vi.fn(async (arg: any) => {
        if (Array.isArray(arg)) {
          return Promise.all(arg)
        }
        if (typeof arg === 'function') {
          return arg(transactionMockTx)
        }

        return undefined
      }),
    },
  }
})

const transactionMockTx = {
  asset: {
    create: vi.fn(),
    findMany: vi.fn().mockResolvedValue([]),
    findUnique: vi.fn(),
    update: vi.fn(),
    updateMany: vi.fn(),
  },
  assetVariant: {
    createMany: vi.fn(),
    updateMany: vi.fn(),
  },
  uploadIntent: {
    update: vi.fn(),
  },
  learnerProfile: {
    updateMany: vi.fn(),
  },
}

import prisma from '../../src/config/database'
import { AvatarUploadService } from '../../src/services/avatar-upload.service'
import { FakeStorageProvider } from '../../src/services/storage.provider'
import { ImageProcessor } from '../../src/services/image-processor.service'
import {
  AVScanner,
  NoopScanner,
  ScanResult,
} from '../../src/services/av-scanner.service'
import { makePng } from '../helpers'

class FakeDetectedScanner implements AVScanner {
  constructor(private infected: boolean, private virus: string | null = 'EICAR') {}
  async scan(_buffer: Buffer): Promise<ScanResult> {
    return { isInfected: this.infected, virusName: this.virus, error: null }
  }
}

class FailingScanner implements AVScanner {
  constructor(private err: Error) {}
  async scan(_buffer: Buffer): Promise<ScanResult> {
    throw this.err
  }
}

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0))

describe('AvatarUploadService', () => {
  let storage: FakeStorageProvider
  let service: AvatarUploadService

  beforeEach(() => {
    storage = new FakeStorageProvider()
    vi.clearAllMocks()
    service = new AvatarUploadService(storage, new ImageProcessor(), new NoopScanner())
  })

  describe('createUploadIntent', () => {
    it('issues an intent with a 15-minute expiry and returns a presigned URL', async () => {
      ;(prisma.uploadIntent.create as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        mimeType: 'image/png',
        sizeBytes: 1024,
        storageKey: 'avatars/user-A/x/original',
        status: 'pending',
        expiresAt: new Date(Date.now() + 900 * 1000),
      })

      const intent = await service.createUploadIntent('user-A', {
        mimeType: 'image/png',
        sizeBytes: 1024,
      })

      expect(intent.uploadUrl).toContain('fake-storage.local')
      expect(intent.storageKey.startsWith('avatars/user-A/')).toBe(true)
      const ttlSeconds = Math.round((intent.expiresAt.getTime() - Date.now()) / 1000)

      expect(ttlSeconds).toBeGreaterThanOrEqual(890)
      expect(ttlSeconds).toBeLessThanOrEqual(910)
      expect(prisma.uploadIntent.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'user-A',
            mimeType: 'image/png',
            sizeBytes: 1024,
            status: 'pending',
          }),
        }),
      )
    })

    it('rejects unsupported MIME types', async () => {
      await expect(
        service.createUploadIntent('user-A', { mimeType: 'image/bmp' as any, sizeBytes: 1024 }),
      ).rejects.toThrow(/Unsupported avatar MIME type/i)
    })

    it('rejects empty files', async () => {
      await expect(
        service.createUploadIntent('user-A', { mimeType: 'image/png', sizeBytes: 0 }),
      ).rejects.toThrow(/empty/i)
    })

    it('rejects files above the 5MB limit', async () => {
      await expect(
        service.createUploadIntent('user-A', { mimeType: 'image/png', sizeBytes: 6 * 1024 * 1024 }),
      ).rejects.toThrow(/5MB/i)
    })
  })

  describe('finalizeUpload', () => {
    const futureDate = new Date(Date.now() + 10 * 60 * 1000)

    it('throws NotFoundError when the intent does not exist', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(null)

      await expect(service.finalizeUpload('nope', 'user-A')).rejects.toThrow(/not found/i)
    })

    it('throws Forbidden when the intent belongs to another user (cross-user guard)', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        status: 'pending',
        expiresAt: futureDate,
      })

      await expect(service.finalizeUpload('intent-1', 'user-B')).rejects.toThrow(
        /cannot finalize another user/i,
      )
    })

    it('throws BadRequest when the intent has expired', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        status: 'pending',
        expiresAt: new Date(Date.now() - 60 * 1000),
      })

      await expect(service.finalizeUpload('intent-1', 'user-A')).rejects.toThrow(/expired/i)
      expect(prisma.uploadIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-1' },
          data: { status: 'expired' },
        }),
      )
    })

    it('throws ConflictError when the intent is in failed state', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        status: 'failed',
        expiresAt: futureDate,
      })

      await expect(service.finalizeUpload('intent-1', 'user-A')).rejects.toThrow(/failed/i)
    })

    it('marks intent finalized and queues a processing job', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        status: 'pending',
        expiresAt: futureDate,
      })

      const result = await service.finalizeUpload('intent-1', 'user-A')

      expect(prisma.uploadIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-1' },
          data: expect.objectContaining({ status: 'finalized' }),
        }),
      )
      expect(prisma.uploadProcessingJob.create).toHaveBeenCalled()
      expect(result.status).toBe('processing')
    })

    it('is idempotent — second finalize returns the finalized asset', async () => {
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue({
        id: 'intent-1',
        userId: 'user-A',
        status: 'finalized',
        assetId: 'asset-1',
        expiresAt: futureDate,
      })
      ;(prisma.asset.findUnique as any).mockResolvedValue({
        id: 'asset-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/x',
        mimeType: 'image/webp',
        sizeBytes: 100,
        width: 32,
        height: 32,
        status: 'active',
        finalizedAt: new Date(),
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [],
      })

      const result = await service.finalizeUpload('intent-1', 'user-A')

      expect(result.status).toBe('finalized')
      expect(result.asset?.id).toBe('asset-1')
    })
  })

  describe('processQueue', () => {
    it('processes a pending job: stores variants, creates asset records, retires previous active asset, and updates learnerProfile', async () => {
      const intent = {
        id: 'intent-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/uuid/original',
        mimeType: 'image/png',
        status: 'finalized',
        sizeBytes: 100,
      }
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(intent)

      const imageBuffer = await makePng(64, 64)
      // simulate the presigned upload happening
      await storage.simulateUpload(intent.storageKey, imageBuffer, 'image/png')

      ;(prisma.uploadProcessingJob.findMany as any).mockResolvedValue([
        {
          id: 'job-1',
          intentId: 'intent-1',
          attemptCount: 0,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
          lastAttemptAt: null,
        },
      ])

      transactionMockTx.asset.create.mockImplementation(async (args: any) => ({
        id: args.data.id,
        userId: args.data.userId,
        storageKey: args.data.storageKey,
        mimeType: args.data.mimeType,
        sizeBytes: args.data.sizeBytes,
        width: args.data.width,
        height: args.data.height,
        status: args.data.status,
        finalizedAt: args.data.finalizedAt,
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      transactionMockTx.asset.findMany.mockResolvedValue([])
      transactionMockTx.asset.findUnique.mockResolvedValue({
        id: 'asset-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/uuid',
        mimeType: 'image/webp',
        sizeBytes: 100,
        width: 32,
        height: 32,
        status: 'active',
        finalizedAt: new Date(),
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [
          {
            id: 'v1',
            assetId: 'asset-1',
            variant: 'original',
            format: 'webp',
            storageKey: 'avatars/user-A/uuid/original',
            sizeBytes: 100,
            width: 32,
            height: 32,
            status: 'active',
            createdAt: new Date(),
          },
        ],
      })
      // Stub storage.presignDownload so derivePublicAvatarUrl returns a usable URL.
      vi
        .spyOn(storage, 'presignDownload')
        .mockResolvedValue('http://fake-storage.local/download/avatars/user-A/uuid/original')
      ;(prisma.learnerProfile.updateMany as any).mockResolvedValue({ count: 1 })

      await service.processQueue()
      await flushPromises()

      // Asset created via transaction
      expect(transactionMockTx.asset.create).toHaveBeenCalled()
      // No previous active asset -> no retiring updateMany call
      expect(transactionMockTx.asset.updateMany).not.toHaveBeenCalled()
      // Avatar URL persisted to LearnerProfile for the owning user
      expect(prisma.learnerProfile.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-A' },
          data: expect.objectContaining({
            avatar: 'http://fake-storage.local/download/avatars/user-A/uuid/original',
          }),
        }),
      )
    })

    it('retires the previously active asset when finalizing a replacement', async () => {
      const intent = {
        id: 'intent-replace',
        userId: 'user-A',
        storageKey: 'avatars/user-A/new/original',
        mimeType: 'image/png',
        status: 'finalized',
        sizeBytes: 100,
      }
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(intent)
      await storage.simulateUpload(intent.storageKey, await makePng(32, 32), 'image/png')

      ;(prisma.uploadProcessingJob.findMany as any).mockResolvedValue([
        {
          id: 'job-r',
          intentId: 'intent-replace',
          attemptCount: 0,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
        },
      ])
      transactionMockTx.asset.create.mockImplementation(async (args: any) => ({
        id: args.data.id,
        userId: args.data.userId,
        storageKey: args.data.storageKey,
        mimeType: args.data.mimeType,
        sizeBytes: args.data.sizeBytes,
        width: args.data.width,
        height: args.data.height,
        status: args.data.status,
        finalizedAt: args.data.finalizedAt,
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
      }))
      transactionMockTx.asset.findMany.mockResolvedValue([
        {
          id: 'asset-old',
          userId: 'user-A',
          storageKey: 'avatars/user-A/old',
          status: 'active',
        },
      ])
      transactionMockTx.asset.findUnique.mockResolvedValue({
        id: 'asset-new',
        userId: 'user-A',
        storageKey: 'avatars/user-A/new',
        mimeType: 'image/webp',
        sizeBytes: 100,
        width: 32,
        height: 32,
        status: 'active',
        finalizedAt: new Date(),
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [
          {
            id: 'v-new',
            assetId: 'asset-new',
            variant: 'original',
            format: 'webp',
            storageKey: 'avatars/user-A/new/original',
            sizeBytes: 100,
            width: 32,
            height: 32,
            status: 'active',
            createdAt: new Date(),
          },
        ],
      })
      vi.spyOn(storage, 'presignDownload').mockResolvedValue(
        'http://fake-storage.local/download/avatars/user-A/new/original',
      )
      ;(prisma.learnerProfile.updateMany as any).mockResolvedValue({ count: 1 })

      await service.processQueue()
      await flushPromises()

      // Previous active asset must be retired.
      expect(transactionMockTx.asset.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: { in: ['asset-old'] } },
          data: expect.objectContaining({ status: 'retired' }),
        }),
      )
      // Variants of previous asset must also be retired.
      expect(transactionMockTx.assetVariant.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({ assetId: { in: ['asset-old'] } }),
          data: { status: 'retired' },
        }),
      )
    })

    it('marks intent failed and dead-letters job when a MIME-spoofed file is detected', async () => {
      const infectedService = new AvatarUploadService(
        storage,
        new ImageProcessor(),
        new FakeDetectedScanner(true),
      )
      const intent = {
        id: 'intent-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/uuid/original',
        status: 'finalized',
      }
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(intent)
      await storage.simulateUpload(intent.storageKey, await makePng(16, 16), 'image/png')

      ;(prisma.uploadIntent.update as any).mockResolvedValue({})
      ;(prisma.uploadProcessingJob.findMany as any).mockResolvedValue([
        {
          id: 'job-1',
          intentId: 'intent-1',
          attemptCount: 4,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
        },
      ])
      ;(prisma.uploadProcessingJob.update as any).mockResolvedValue({})

      await infectedService.processQueue()
      await flushPromises()

      expect(prisma.uploadIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-1' },
          data: { status: 'failed' },
        }),
      )
      // After exhausting all 5 attempts, the job becomes a dead-letter.
      const deadLetterCall = (prisma.uploadProcessingJob.update as any).mock.calls.find(
        (call: any) => call[0]?.data?.status === 'dead-letter',
      )
      expect(deadLetterCall).toBeDefined()
    })

    it('rejects MIME-spoofed buffers during image processing (real sharp failure)', async () => {
      const intent = {
        id: 'intent-2',
        userId: 'user-A',
        storageKey: 'avatars/user-A/spoofed/original',
        status: 'finalized',
      }
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(intent)
      // Pretend client uploaded a text file as 'image/png'.
      await storage.simulateUpload(intent.storageKey, Buffer.from('not image bytes', 'utf8'), 'image/png')
      ;(prisma.uploadProcessingJob.findMany as any).mockResolvedValue([
        {
          id: 'job-2',
          attemptCount: 0,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
        },
      ])
      ;(prisma.uploadProcessingJob.update as any).mockResolvedValue({})
      ;(prisma.uploadIntent.update as any).mockResolvedValue({})

      await service.processQueue()
      await flushPromises()

      // The intent was marked failed because image processing rejected the buffer.
      expect(prisma.uploadIntent.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'intent-2' },
          data: { status: 'failed' },
        }),
      )
    })

    it('applies exponential backoff on a processing failure with attempts remaining', async () => {
      const failingService = new AvatarUploadService(
        storage,
        new ImageProcessor(),
        new FailingScanner(new Error('scanner offline')),
      )
      const intent = {
        id: 'intent-3',
        userId: 'user-A',
        storageKey: 'avatars/user-A/u/original',
        status: 'finalized',
      }
      ;(prisma.uploadIntent.findUnique as any).mockResolvedValue(intent)
      await storage.simulateUpload(intent.storageKey, await makePng(8, 8), 'image/png')
      ;(prisma.uploadProcessingJob.findMany as any).mockResolvedValue([
        {
          id: 'job-3',
          attemptCount: 1,
          maxAttempts: 5,
          nextAttemptAt: new Date(),
        },
      ])
      ;(prisma.uploadProcessingJob.update as any).mockResolvedValue({})

      await failingService.processQueue()
      await flushPromises()

      const backoffCall = (prisma.uploadProcessingJob.update as any).mock.calls.find(
        (call: any) => call[0]?.data?.nextAttemptAt,
      )
      expect(backoffCall).toBeDefined()
      expect(backoffCall[0].data.status).toBe('pending')
    })
  })

  describe('deleteAvatar', () => {
    it('throws NotFoundError when there is no active avatar', async () => {
      ;(prisma.asset.findFirst as any).mockResolvedValue(null)

      await expect(service.deleteAvatar('user-A')).rejects.toThrow(/no active avatar/i)
    })

    it('marks the asset retired in a transaction and removes storage objects', async () => {
      ;(prisma.asset.findFirst as any).mockResolvedValue({
        id: 'asset-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/x',
        status: 'active',
      })
      await storage.putObject('avatars/user-A/x/original', Buffer.from([1]), 'image/png')

      await service.deleteAvatar('user-A')
      await flushPromises()

      expect(prisma.$transaction).toHaveBeenCalled()
      // After delete, storage prefix must be cleared.
      await expect(storage.getObject('avatars/user-A/x/original')).rejects.toThrow()
    })

    it('throws Forbidden when called with a mismatching user id', async () => {
      ;(prisma.asset.findFirst as any).mockImplementation(async (args: any) => {
        // Asset only exists for user-A; an attempt to delete with user-B
        // cannot match any asset because the controller scopes the lookup
        // to the authenticated userId. Therefore the caller sees NotFound.
        if (args.where.userId === 'user-A') {
          return { id: 'asset-1', userId: 'user-A', storageKey: 'avatars/user-A/x' }
        }

        return null
      })

      await expect(service.deleteAvatar('user-B')).rejects.toThrow(/no active avatar/i)
    })
  })

  describe('getActiveAvatar', () => {
    it('returns null when the user has no active avatar', async () => {
      ;(prisma.asset.findFirst as any).mockResolvedValue(null)

      const result = await service.getActiveAvatar('user-A')
      expect(result).toBeNull()
    })

    it('returns the active asset DTO including variants', async () => {
      ;(prisma.asset.findFirst as any).mockResolvedValue({
        id: 'asset-1',
        userId: 'user-A',
        storageKey: 'avatars/user-A/x',
        mimeType: 'image/webp',
        sizeBytes: 1000,
        width: 32,
        height: 32,
        status: 'active',
        finalizedAt: new Date(),
        retiredAt: null,
        createdAt: new Date(),
        updatedAt: new Date(),
        variants: [
          {
            id: 'v1',
            assetId: 'asset-1',
            variant: 'original',
            format: 'webp',
            storageKey: 'avatars/user-A/x/original',
            sizeBytes: 200,
            width: 32,
            height: 32,
            status: 'active',
            createdAt: new Date(),
          },
        ],
      })

      const result = await service.getActiveAvatar('user-A')

      expect(result?.id).toBe('asset-1')
      expect(result?.variants).toHaveLength(1)
      expect(result?.variants[0].variant).toBe('original')
      expect(result?.variants[0].format).toBe('webp')
    })
  })
})
