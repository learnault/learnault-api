import { describe, it, expect, vi, beforeEach } from 'vitest'
import { AvatarController } from '../src/controllers/avatar.controller'
import { AvatarValidationError } from '../src/services/avatar.service'

// ── Mock the AvatarService ────────────────────────────────────────

const {
  mockCreateUploadIntent,
  mockFinalize,
  mockDeleteAvatar,
  mockGetCurrentAvatar,
} = vi.hoisted(() => ({
  mockCreateUploadIntent: vi.fn(),
  mockFinalize: vi.fn(),
  mockDeleteAvatar: vi.fn(),
  mockGetCurrentAvatar: vi.fn(),
}))

vi.mock('../src/services/avatar.service', () => ({
  AvatarValidationError: class extends Error {
    statusCode: number
    constructor(message: string, statusCode = 400) {
      super(message)
      this.name = 'AvatarValidationError'
      this.statusCode = statusCode
    }
  },
  AvatarService: class {
    createUploadIntent = mockCreateUploadIntent
    finalize = mockFinalize
    deleteAvatar = mockDeleteAvatar
    getCurrentAvatar = mockGetCurrentAvatar
  },
}))

vi.mock('../src/services/storage/in-memory-storage', () => ({
  InMemoryStorageProvider: class {},
}))

// ── Tests ──────────────────────────────────────────────────────────

describe('AvatarController', () => {
  let controller: AvatarController
  let req: any
  let res: any

  beforeEach(() => {
    vi.clearAllMocks()
    controller = new AvatarController()
    req = { user: { id: 'user1' }, body: {}, params: {} }
    res = {
      status: vi.fn().mockReturnThis(),
      json: vi.fn().mockReturnThis(),
      send: vi.fn().mockReturnThis(),
    }
  })

  describe('createUploadIntent', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 400 on empty body', async () => {
      req.body = {}

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation failed' }),
      )
    })

    it('returns 400 on unknown fields (strict schema)', async () => {
      req.body = { contentType: 'image/jpeg', hacker: true }

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid contentType', async () => {
      req.body = { contentType: '' }

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 201 on success', async () => {
      req.body = { contentType: 'image/jpeg', originalName: 'photo.jpg', sizeBytes: 50_000 }
      mockCreateUploadIntent.mockResolvedValue({
        uploadKey: 'key',
        uploadUrl: 'url',
        expiresAt: new Date().toISOString(),
        maxBytes: 5_242_880,
        allowedTypes: ['image/jpeg'],
      })

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(201)
      expect(res.json).toHaveBeenCalledWith({ data: expect.any(Object) })
    })

    it('maps AvatarValidationError to its status code', async () => {
      req.body = { contentType: 'application/pdf' }
      mockCreateUploadIntent.mockRejectedValue(new AvatarValidationError('Unsupported content type', 422))

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(422)
      expect(res.json).toHaveBeenCalledWith({ error: 'Unsupported content type' })
    })

    it('returns 500 on unexpected error', async () => {
      req.body = { contentType: 'image/jpeg' }
      mockCreateUploadIntent.mockRejectedValue(new Error('db down'))

      await controller.createUploadIntent(req, res)

      expect(res.status).toHaveBeenCalledWith(500)
    })
  })

  describe('finalize', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 400 when uploadKey is missing', async () => {
      req.body = {}

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 400 on invalid sha256 format', async () => {
      req.body = { uploadKey: 'key', sha256: 'not-hex' }

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 200 on success', async () => {
      req.body = { uploadKey: 'key' }
      mockFinalize.mockResolvedValue({
        id: 'avatar-1',
        status: 'ACTIVE',
        variantCount: 3,
        width: 100,
        height: 80,
        createdAt: new Date().toISOString(),
      })

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ data: expect.any(Object) })
    })

    it('maps 403 Forbidden for cross-user access', async () => {
      req.body = { uploadKey: 'key' }
      mockFinalize.mockRejectedValue(new AvatarValidationError('Forbidden', 403))

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(403)
    })

    it('maps 404 for missing upload', async () => {
      req.body = { uploadKey: 'key' }
      mockFinalize.mockRejectedValue(new AvatarValidationError('Upload not found', 404))

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('maps 422 for validation failure', async () => {
      req.body = { uploadKey: 'key' }
      mockFinalize.mockRejectedValue(new AvatarValidationError('MIME mismatch', 422))

      await controller.finalize(req, res)

      expect(res.status).toHaveBeenCalledWith(422)
    })
  })

  describe('deleteAvatar', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.deleteAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 204 on success', async () => {
      mockDeleteAvatar.mockResolvedValue(undefined)

      await controller.deleteAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(204)
    })

    it('returns 404 when no avatar exists', async () => {
      mockDeleteAvatar.mockRejectedValue(new AvatarValidationError('No active avatar', 404))

      await controller.deleteAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(404)
    })
  })

  describe('getCurrentAvatar', () => {
    it('returns 401 when unauthenticated', async () => {
      req.user = undefined

      await controller.getCurrentAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(401)
    })

    it('returns 200 with null when no avatar', async () => {
      mockGetCurrentAvatar.mockResolvedValue(null)

      await controller.getCurrentAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ data: null })
    })

    it('returns 200 with avatar data', async () => {
      mockGetCurrentAvatar.mockResolvedValue({
        id: 'avatar-1',
        variants: [{ label: 'original', url: '/storage/key', width: 100, height: 80 }],
        createdAt: '2026-01-01T00:00:00.000Z',
      })

      await controller.getCurrentAvatar(req, res)

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ data: expect.objectContaining({ id: 'avatar-1' }) })
    })
  })
})
