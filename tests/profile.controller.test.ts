import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'

vi.mock('../src/config/database', () => ({
  default: {
    learnerProfile: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
  },
}))

import prisma from '../src/config/database'
import { ProfileController } from '../src/controllers/profile.controller'
import { AvatarUploadService } from '../src/services/avatar-upload.service'
import {
  BadRequestError,
  ForbiddenError,
  NotFoundError,
  UnauthorizedError,
} from '../src/utils/errors'

interface AuthRequest extends Request {
  user?: { id: string }
}

const flushPromises = () => new Promise<void>((r) => setTimeout(r, 0))

describe('ProfileController', () => {
  let controller: ProfileController
  let avatarUploadService: { [K in keyof AvatarUploadService]: any }
  let req: Partial<AuthRequest>
  let res: Partial<Response>
  let next: ReturnType<typeof vi.fn>

  beforeEach(() => {
    avatarUploadService = {
      createUploadIntent: vi.fn(),
      finalizeUpload: vi.fn(),
      getActiveAvatar: vi.fn(),
      deleteAvatar: vi.fn(),
    }
    controller = new ProfileController(avatarUploadService as unknown as AvatarUploadService)
    req = { user: { id: 'user-A' }, body: {} }
    res = { json: vi.fn().mockReturnThis(), status: vi.fn().mockReturnThis() }
    next = vi.fn()
    vi.clearAllMocks()
  })

  describe('createUploadIntent', () => {
    it('returns 201 with the presigned URL on success', async () => {
      req.body = { mimeType: 'image/png', sizeBytes: 1024 }
      ;(avatarUploadService.createUploadIntent as any).mockResolvedValue({
        id: 'intent-1',
        uploadUrl: 'http://fake-storage.local/upload/avatars/user-A/x/original',
        storageKey: 'avatars/user-A/x/original',
        expiresAt: new Date(Date.now() + 900 * 1000),
        mimeType: 'image/png',
        maxSizeBytes: 5 * 1024 * 1024,
      })

      controller.createUploadIntent(req as Request, res as Response, next)
      await flushPromises()

      expect(avatarUploadService.createUploadIntent).toHaveBeenCalledWith('user-A', {
        mimeType: 'image/png',
        sizeBytes: 1024,
      })
      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ id: 'intent-1' }) }),
      )
    })

    it('returns 401 when no authenticated user is present', async () => {
      req.user = undefined
      req.body = { mimeType: 'image/png', sizeBytes: 1024 }

      controller.createUploadIntent(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
      expect(avatarUploadService.createUploadIntent).not.toHaveBeenCalled()
    })

    it('returns 400 when mimeType is missing', async () => {
      req.body = { sizeBytes: 1024 }

      controller.createUploadIntent(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError))
    })

    it('returns 400 on service MIME rejection (oversize/invalid MIME)', async () => {
      req.body = { mimeType: 'image/png', sizeBytes: 10 * 1024 * 1024 }
      ;(avatarUploadService.createUploadIntent as any).mockRejectedValue(
        new BadRequestError('File exceeds the maximum avatar size of 5MB'),
      )

      controller.createUploadIntent(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError))
    })
  })

  describe('finalizeUpload', () => {
    it('returns 200 with status processing on success', async () => {
      req.body = { intentId: 'intent-1' }
      ;(avatarUploadService.finalizeUpload as any).mockResolvedValue({
        intentId: 'intent-1',
        status: 'processing',
      })

      controller.finalizeUpload(req as Request, res as Response, next)
      await flushPromises()

      expect(avatarUploadService.finalizeUpload).toHaveBeenCalledWith('intent-1', 'user-A')
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 403 (ForbiddenError) when finalizing another user\'s intent (cross-user guard)', async () => {
      req.body = { intentId: 'intent-1' }
      ;(avatarUploadService.finalizeUpload as any).mockRejectedValue(
        new ForbiddenError('You cannot finalize another user\'s upload intent'),
      )

      controller.finalizeUpload(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(ForbiddenError))
    })

    it('returns 404 when the intent does not exist', async () => {
      req.body = { intentId: 'intent-404' }
      ;(avatarUploadService.finalizeUpload as any).mockRejectedValue(new NotFoundError('Upload intent not found'))

      controller.finalizeUpload(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError))
    })

    it('returns 400 when intentId is missing', async () => {
      req.body = {}

      controller.finalizeUpload(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(BadRequestError))
    })

    it('returns 401 when no authenticated user is present', async () => {
      req.user = undefined
      req.body = { intentId: 'intent-1' }

      controller.finalizeUpload(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
    })
  })

  describe('getAvatar', () => {
    it('returns 200 with a null asset when the user has no active avatar', async () => {
      ;(avatarUploadService.getActiveAvatar as any).mockResolvedValue(null)

      controller.getAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ success: true, data: expect.objectContaining({ asset: null }) }),
      )
    })

    it('returns 200 with the asset on success', async () => {
      ;(avatarUploadService.getActiveAvatar as any).mockResolvedValue({ id: 'asset-1', variants: [] })

      controller.getAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({ asset: expect.objectContaining({ id: 'asset-1' }) }),
        }),
      )
    })

    it('returns 401 without authentication', async () => {
      req.user = undefined

      controller.getAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
    })
  })

  describe('deleteAvatar', () => {
    it('returns 200 on successful deletion', async () => {
      ;(avatarUploadService.deleteAvatar as any).mockResolvedValue(undefined)

      controller.deleteAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(avatarUploadService.deleteAvatar).toHaveBeenCalledWith('user-A')
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 404 when the user has no active avatar', async () => {
      ;(avatarUploadService.deleteAvatar as any).mockRejectedValue(
        new NotFoundError('No active avatar to delete'),
      )

      controller.deleteAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError))
    })

    it('returns 401 without authentication', async () => {
      req.user = undefined

      controller.deleteAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
    })

    it('cannot delete another user\'s avatar (no-op because controller scopes lookup to req.user.id)', async () => {
      // The controller only ever passes the authenticated user id to the
      // service; attempts by user-B to delete an avatar that belongs to
      // user-A therefore always resolve to "no active avatar" — there is
      // no path that can mutate user-A's asset.
      req.user = { id: 'user-B' }
      ;(avatarUploadService.deleteAvatar as any).mockRejectedValue(
        new NotFoundError('No active avatar to delete'),
      )

      controller.deleteAvatar(req as Request, res as Response, next)
      await flushPromises()

      expect(avatarUploadService.deleteAvatar).toHaveBeenCalledWith('user-B')
      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError))
    })
  })

  describe('getProfile', () => {
    it('returns 200 with the learner profile', async () => {
      ;(prisma.learnerProfile.findUnique as any).mockResolvedValue({
        id: 'profile-1',
        userId: 'user-A',
        displayName: 'Ada',
        bio: 'Test bio',
        avatar: null,
        country: 'NG',
        timezone: 'Africa/Lagos',
        languages: '["en","yo"]',
        skillLevel: 'intermediate',
        interests: '["crypto"]',
        goals: 'Learn Stellar',
        profileVisibility: 'public',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      controller.getProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          success: true,
          data: expect.objectContaining({
            languages: ['en', 'yo'],
            displayName: 'Ada',
            skillLevel: 'intermediate',
            profileVisibility: 'public',
          }),
        }),
      )
    })

    it('returns 404 when the profile is missing', async () => {
      ;(prisma.learnerProfile.findUnique as any).mockResolvedValue(null)

      controller.getProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError))
    })

    it('returns 401 without authentication', async () => {
      req.user = undefined

      controller.getProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
    })
  })

  describe('updateProfile', () => {
    it('updates the supplied profile fields and returns the new profile', async () => {
      ;(prisma.learnerProfile.findUnique as any).mockResolvedValue({
        id: 'profile-1',
        userId: 'user-A',
      })
      ;(prisma.learnerProfile.update as any).mockResolvedValue({
        id: 'profile-1',
        userId: 'user-A',
        displayName: 'Grace',
        bio: null,
        avatar: null,
        country: 'US',
        timezone: null,
        languages: '["en"]',
        skillLevel: 'advanced',
        interests: '[]',
        goals: null,
        profileVisibility: 'private',
        createdAt: new Date(),
        updatedAt: new Date(),
      })

      req.body = {
        displayName: 'Grace',
        country: 'US',
        languages: ['en'],
        skillLevel: 'advanced',
        profileVisibility: 'private',
      }

      controller.updateProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(prisma.learnerProfile.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-A' },
          data: expect.objectContaining({
            displayName: 'Grace',
            country: 'US',
            languages: '["en"]',
            skillLevel: 'advanced',
            profileVisibility: 'private',
          }),
        }),
      )
      expect(res.status).toHaveBeenCalledWith(200)
    })

    it('returns 404 when the profile does not exist', async () => {
      ;(prisma.learnerProfile.findUnique as any).mockResolvedValue(null)

      req.body = { displayName: 'Whatever' }
      controller.updateProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(NotFoundError))
    })

    it('returns 401 without authentication', async () => {
      req.user = undefined
      req.body = { displayName: 'A' }

      controller.updateProfile(req as Request, res as Response, next)
      await flushPromises()

      expect(next).toHaveBeenCalledWith(expect.any(UnauthorizedError))
    })
  })
})
