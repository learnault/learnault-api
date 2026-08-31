import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { AccountController } from '../src/controllers/account.controller'

vi.mock('../src/config/database', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    dataExportRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    accountDeletionRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    session: {
      updateMany: vi.fn(),
      deleteMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('bcryptjs', () => ({
  default: {
    compare: vi.fn(),
    hash: vi.fn().mockResolvedValue('hashed'),
  },
}))

vi.mock('jsonwebtoken', () => ({
  default: {
    sign: vi.fn().mockReturnValue('mock_token'),
  },
}))

vi.mock('../src/services/email.service', () => ({
  emailService: {
    queueEmail: vi.fn().mockResolvedValue({ id: 'email-1' }),
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import prisma from '../src/config/database'
import bcrypt from 'bcryptjs'
import jwt from 'jsonwebtoken'
import { emailService } from '../src/services/email.service'

const flushPromises = () =>
  new Promise<void>((resolve) => setTimeout(resolve, 0))

const DAY_MS = 24 * 60 * 60 * 1000

interface AuthRequest extends Request {
  user?: { id: string; email: string; role: string }
}

const activeUser = {
  id: 'user-1',
  email: 'test@example.com',
  username: 'testuser',
  password: 'hashed_password',
  role: 'LEARNER',
  status: 'ACTIVE',
}

describe('AccountController', () => {
  let controller: AccountController
  let req: Partial<AuthRequest>
  let res: Partial<Response>

  beforeEach(() => {
    vi.resetAllMocks()

    controller = new AccountController()
    req = {
      user: { id: 'user-1', email: 'test@example.com', role: 'LEARNER' },
      body: {},
      params: {},
      headers: { 'user-agent': 'vitest' },
      ip: '127.0.0.1',
    } as Partial<AuthRequest>
    res = {
      json: vi.fn(),
      status: vi.fn().mockReturnThis(),
      setHeader: vi.fn(),
      send: vi.fn(),
    }

    // Quiet defaults for the background lifecycle sweep
    vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([] as any)
    vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue(
      [] as any,
    )
    vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
      count: 0,
    } as any)
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
    vi.mocked(prisma.$transaction).mockImplementation((args: any[]) =>
      Promise.all(args),
    )
    vi.mocked(emailService.queueEmail).mockResolvedValue({
      id: 'email-1',
    } as any)
    vi.mocked(jwt.sign as any).mockReturnValue('mock_token')
  })

  describe('requestExport', () => {
    it('accepts a new export request with 202', async () => {
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue(null)
      vi.mocked(prisma.dataExportRequest.create).mockResolvedValue({
        id: 'exp-1',
        userId: 'user-1',
        status: 'pending',
        createdAt: new Date(),
      } as any)

      await controller.requestExport(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(202)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ id: 'exp-1', status: 'pending' }),
      )
    })

    it('returns 409 with the existing request id on duplicate', async () => {
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: 'exp-existing',
        userId: 'user-1',
        status: 'processing',
      } as any)

      await controller.requestExport(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ existingRequestId: 'exp-existing' }),
      )
      expect(prisma.dataExportRequest.create).not.toHaveBeenCalled()
    })

    it('returns 409 when a concurrent request wins the unique-index race', async () => {
      vi.mocked(prisma.dataExportRequest.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'exp-winner',
          userId: 'user-1',
          status: 'pending',
        } as any)
      vi.mocked(prisma.dataExportRequest.create).mockRejectedValue({
        code: 'P2002',
      })

      await controller.requestExport(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ existingRequestId: 'exp-winner' }),
      )
    })
  })

  describe('getExportStatus', () => {
    it("scopes the lookup to the requesting user and 404s on other users' requests", async () => {
      req.params = { id: '123e4567-e89b-42d3-a456-426614174000' }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue(null)

      await controller.getExportStatus(req as Request, res as Response)

      expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith({
        where: { id: '123e4567-e89b-42d3-a456-426614174000', userId: 'user-1' },
      })
      expect(res.status).toHaveBeenCalledWith(404)
    })

    it('rejects malformed export ids with 400', async () => {
      req.params = { id: 'not-a-uuid' }

      await controller.getExportStatus(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(400)
      expect(prisma.dataExportRequest.findFirst).not.toHaveBeenCalled()
    })

    it('returns status fields without the artifact', async () => {
      req.params = { id: '123e4567-e89b-42d3-a456-426614174000' }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: '123e4567-e89b-42d3-a456-426614174000',
        userId: 'user-1',
        status: 'ready',
        artifact: '{"secret":"data"}',
        createdAt: new Date(),
        completedAt: new Date(),
        expiresAt: new Date(Date.now() + DAY_MS),
        downloadedAt: null,
      } as any)

      await controller.getExportStatus(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(200)
      const payload = vi.mocked(res.json as any).mock.calls[0][0]
      expect(payload.status).toBe('ready')
      expect(payload.artifact).toBeUndefined()
    })
  })

  describe('downloadExport', () => {
    const exportId = '123e4567-e89b-42d3-a456-426614174000'

    it('sends a ready artifact as a JSON attachment and marks it downloaded', async () => {
      req.params = { id: exportId }
      const artifact = JSON.stringify({
        exportVersion: 1,
        data: { profile: { id: 'user-1' } },
      })
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: exportId,
        userId: 'user-1',
        status: 'ready',
        artifact,
        expiresAt: new Date(Date.now() + DAY_MS),
        downloadedAt: null,
      } as any)
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)

      await controller.downloadExport(req as Request, res as Response)

      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Type',
        'application/json',
      )
      expect(res.setHeader).toHaveBeenCalledWith(
        'Content-Disposition',
        `attachment; filename="learnault-export-${exportId}.json"`,
      )
      expect(res.send).toHaveBeenCalledWith(artifact)
      expect(prisma.dataExportRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: exportId, userId: 'user-1', downloadedAt: null },
        }),
      )
    })

    it('returns 409 while the export is still processing', async () => {
      req.params = { id: exportId }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: exportId,
        userId: 'user-1',
        status: 'processing',
        artifact: null,
        expiresAt: null,
      } as any)

      await controller.downloadExport(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('returns 410 for an expired export', async () => {
      req.params = { id: exportId }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: exportId,
        userId: 'user-1',
        status: 'expired',
        artifact: null,
        expiresAt: new Date(0),
      } as any)

      await controller.downloadExport(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(410)
      expect(res.send).not.toHaveBeenCalled()
    })

    it('returns 410 for a ready export whose expiry has passed but is not yet purged', async () => {
      req.params = { id: exportId }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue({
        id: exportId,
        userId: 'user-1',
        status: 'ready',
        artifact: '{"data":1}',
        expiresAt: new Date(Date.now() - 1000),
      } as any)

      await controller.downloadExport(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(410)
      expect(res.send).not.toHaveBeenCalled()
    })

    it('404s for exports owned by another user', async () => {
      req.params = { id: exportId }
      vi.mocked(prisma.dataExportRequest.findFirst).mockResolvedValue(null)

      await controller.downloadExport(req as Request, res as Response)

      expect(prisma.dataExportRequest.findFirst).toHaveBeenCalledWith({
        where: { id: exportId, userId: 'user-1' },
      })
      expect(res.status).toHaveBeenCalledWith(404)
    })
  })

  describe('deactivate', () => {
    it('rejects a wrong password with 401 and audits the failed step-up', async () => {
      req.body = { password: 'wrong' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(false)

      await controller.deactivate(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'STEP_UP_FAILED' }),
      )
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'STEP_UP_FAILED' }),
        }),
      )
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns 409 when the account is already deactivated', async () => {
      req.body = { password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'DEACTIVATED',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)

      await controller.deactivate(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(409)
    })

    it('deactivates the account, revoking sessions in the same transaction', async () => {
      req.body = { password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)

      await controller.deactivate(req as Request, res as Response)

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'user-1' },
          data: expect.objectContaining({ status: 'DEACTIVATED' }),
        }),
      )
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', isRevoked: false },
        }),
      )
      expect(res.status).toHaveBeenCalledWith(200)
    })
  })

  describe('reactivate', () => {
    it('reactivates a deactivated account and returns a fresh token', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'DEACTIVATED',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)

      await controller.reactivate(req as Request, res as Response)

      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ token: 'mock_token' }),
      )
    })

    it('returns a neutral 401 on bad credentials', async () => {
      req.body = { email: 'test@example.com', password: 'wrong' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'DEACTIVATED',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(false)

      await controller.reactivate(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' })
    })

    it('returns a neutral 401 for tombstoned (deleted) accounts', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'DELETED',
      } as any)

      await controller.reactivate(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(res.json).toHaveBeenCalledWith({ error: 'Invalid credentials' })
    })

    it('returns 409 when the account is pending deletion', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'PENDING_DELETION',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)

      await controller.reactivate(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'ACCOUNT_PENDING_DELETION' }),
      )
    })
  })

  describe('requestDeletion', () => {
    it('accepts a deletion request with the configured cooling-off window', async () => {
      req.body = { password: 'correct', reason: 'no longer needed' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue(null)
      const scheduledFor = new Date(Date.now() + 30 * DAY_MS)
      vi.mocked(prisma.accountDeletionRequest.create).mockResolvedValue({
        id: 'del-1',
        userId: 'user-1',
        status: 'pending',
        scheduledFor,
      } as any)

      await controller.requestDeletion(req as Request, res as Response)
      await flushPromises()

      // Cooling-off window: scheduledFor persisted ≈ now + 30 days (default)
      const createArg = vi.mocked(prisma.accountDeletionRequest.create).mock
        .calls[0][0] as any
      const deltaDays =
        (createArg.data.scheduledFor.getTime() - Date.now()) / DAY_MS
      expect(deltaDays).toBeGreaterThan(29.9)
      expect(deltaDays).toBeLessThan(30.1)

      expect(res.status).toHaveBeenCalledWith(202)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          id: 'del-1',
          status: 'pending',
          scheduledFor,
        }),
      )
      expect(emailService.queueEmail).toHaveBeenCalled()
    })

    it('returns 409 when a deletion request is already pending', async () => {
      req.body = { password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)
      const scheduledFor = new Date(Date.now() + 10 * DAY_MS)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue({
        id: 'del-existing',
        userId: 'user-1',
        status: 'pending',
        scheduledFor,
      } as any)

      await controller.requestDeletion(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(409)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({
          existingRequestId: 'del-existing',
          scheduledFor,
        }),
      )
      expect(prisma.accountDeletionRequest.create).not.toHaveBeenCalled()
    })

    it('rejects a wrong password with 401 before touching deletion state', async () => {
      req.body = { password: 'wrong' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(false)

      await controller.requestDeletion(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(401)
      expect(prisma.accountDeletionRequest.findFirst).not.toHaveBeenCalled()
    })
  })

  describe('getDeletionStatus', () => {
    it('returns a null status when no request exists', async () => {
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue(null)

      await controller.getDeletionStatus(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith({ status: null })
    })
  })

  describe('cancelDeletion', () => {
    it('cancels a pending deletion and restores the account', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'PENDING_DELETION',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue({
        id: 'del-1',
        userId: 'user-1',
        status: 'cancelled',
        cancelledAt: new Date(),
      } as any)

      await controller.cancelDeletion(req as Request, res as Response)
      await flushPromises()

      expect(prisma.accountDeletionRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { userId: 'user-1', status: 'pending' },
        }),
      )
      expect(prisma.user.update).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ status: 'ACTIVE' }),
        }),
      )
      expect(res.status).toHaveBeenCalledWith(200)
      expect(emailService.queueEmail).toHaveBeenCalled()
    })

    it('returns 410 when finalization already won the race', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue({
        ...activeUser,
        status: 'PENDING_DELETION',
      } as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue({
        id: 'del-1',
        userId: 'user-1',
        status: 'completed',
      } as any)

      await controller.cancelDeletion(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(410)
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('returns 404 when no deletion request exists', async () => {
      req.body = { email: 'test@example.com', password: 'correct' }
      vi.mocked(prisma.user.findUnique).mockResolvedValue(activeUser as any)
      vi.mocked(bcrypt.compare as any).mockResolvedValue(true)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue(null)

      await controller.cancelDeletion(req as Request, res as Response)

      expect(res.status).toHaveBeenCalledWith(404)
    })
  })
})
