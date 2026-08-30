import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/config/database', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
      update: vi.fn(),
    },
    session: { updateMany: vi.fn(), deleteMany: vi.fn() },
    verificationToken: { deleteMany: vi.fn() },
    deviceToken: { deleteMany: vi.fn() },
    syncEvent: { deleteMany: vi.fn() },
    notificationLog: { deleteMany: vi.fn() },
    notificationPreference: { deleteMany: vi.fn() },
    emailDelivery: { deleteMany: vi.fn() },
    completion: { deleteMany: vi.fn() },
    referralCode: { deleteMany: vi.fn() },
    transaction: { deleteMany: vi.fn(), findMany: vi.fn() },
    credential: { deleteMany: vi.fn(), findMany: vi.fn() },
    referral: { deleteMany: vi.fn(), findMany: vi.fn(), findFirst: vi.fn() },
    stellarFunding: { deleteMany: vi.fn() },
    dataExportRequest: {
      deleteMany: vi.fn(),
      findMany: vi.fn(),
      updateMany: vi.fn(),
    },
    accountDeletionRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: { create: vi.fn(), updateMany: vi.fn() },
    $transaction: vi.fn(),
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

import prisma from '../src/config/database'
import { AccountLifecycleService } from '../src/services/account-lifecycle.service'

const dueRequest = {
  id: 'del-1',
  userId: 'user-1',
  status: 'pending',
  scheduledFor: new Date(Date.now() - 1000),
  attemptCount: 0,
  maxAttempts: 5,
  nextAttemptAt: null,
}

describe('AccountLifecycleService', () => {
  let service: AccountLifecycleService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new AccountLifecycleService()
    vi.mocked(prisma.$transaction).mockImplementation((args: any[]) =>
      Promise.all(args),
    )
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
  })

  describe('deactivate', () => {
    it('returns a conflict when the account is not active', async () => {
      const result = await service.deactivate('user-1', 'PENDING_DELETION', {})

      expect(result).toEqual({ kind: 'conflict', status: 'PENDING_DELETION' })
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })
  })

  describe('requestDeletion', () => {
    it('treats a unique-index violation from a concurrent request as a duplicate', async () => {
      vi.mocked(prisma.accountDeletionRequest.findFirst)
        .mockResolvedValueOnce(null)
        .mockResolvedValueOnce({
          id: 'del-winner',
          userId: 'user-1',
          status: 'pending',
        } as any)
      vi.mocked(prisma.$transaction).mockRejectedValue({ code: 'P2002' })

      const result = await service.requestDeletion('user-1', undefined, {})

      expect(result.kind).toBe('duplicate')
      expect((result as any).request.id).toBe('del-winner')
    })
  })

  describe('processDue — finalization matrix', () => {
    it('applies the deletion/anonymization matrix and completes the request', async () => {
      vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue([
        dueRequest,
      ] as any)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)

      await service.processDue()

      // Hard-deleted models (PII / auth artifacts / behavioral data)
      for (const model of [
        prisma.session,
        prisma.verificationToken,
        prisma.deviceToken,
        prisma.syncEvent,
        prisma.notificationLog,
        prisma.notificationPreference,
        prisma.emailDelivery,
        prisma.completion,
        prisma.referralCode,
        prisma.dataExportRequest,
      ]) {
        expect(model.deleteMany).toHaveBeenCalledWith({
          where: { userId: 'user-1' },
        })
      }

      // Retained models: financial/on-chain records must NOT be deleted
      expect(prisma.transaction.deleteMany).not.toHaveBeenCalled()
      expect(prisma.credential.deleteMany).not.toHaveBeenCalled()
      expect(prisma.referral.deleteMany).not.toHaveBeenCalled()
      expect(prisma.stellarFunding.deleteMany).not.toHaveBeenCalled()

      // Audit logs retained but PII-scrubbed
      expect(prisma.auditLog.updateMany).toHaveBeenCalledWith({
        where: { userId: 'user-1' },
        data: {
          ipAddress: null,
          userAgent: null,
          metadata: JSON.stringify({ redacted: true }),
        },
      })

      // User row anonymized in place (tombstone), never hard-deleted
      const userUpdate = vi.mocked(prisma.user.update).mock.calls[0][0] as any
      expect(userUpdate.where).toEqual({ id: 'user-1' })
      expect(userUpdate.data.email).toMatch(
        /^deleted\+[a-z0-9]+@anon\.invalid$/,
      )
      expect(userUpdate.data.username).toMatch(/^deleted_[a-z0-9]+$/)
      expect(userUpdate.data.password).toMatch(/^[0-9a-f]{64}$/)
      expect(userUpdate.data.walletAddress).toBeNull()
      expect(userUpdate.data.isVerified).toBe(false)
      expect(userUpdate.data.lastLoginAt).toBeNull()
      expect(userUpdate.data.status).toBe('DELETED')

      // Request marked completed + completion audited
      expect(prisma.accountDeletionRequest.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'del-1' },
          data: expect.objectContaining({ status: 'completed' }),
        }),
      )
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({ action: 'DELETION_COMPLETED' }),
        }),
      )
    })

    it('skips rows another runner already claimed', async () => {
      vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue([
        dueRequest,
      ] as any)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)

      await service.processDue()

      expect(prisma.$transaction).not.toHaveBeenCalled()
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('re-running after completion is a no-op (idempotent)', async () => {
      // Completed requests no longer match the pending filter
      vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue(
        [] as any,
      )

      await service.processDue()

      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns the request to pending with backoff on finalization failure', async () => {
      vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue([
        dueRequest,
      ] as any)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error('db down'))

      await service.processDue()

      const retryCall = vi.mocked(prisma.accountDeletionRequest.updateMany).mock
        .calls[1][0] as any
      expect(retryCall.where).toEqual({ id: 'del-1', status: 'processing' })
      expect(retryCall.data.status).toBe('pending')
      expect(retryCall.data.error).toBe('db down')
      expect(retryCall.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('dead-letters the request as failed after max attempts', async () => {
      vi.mocked(prisma.accountDeletionRequest.findMany).mockResolvedValue([
        { ...dueRequest, attemptCount: 4 },
      ] as any)
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      vi.mocked(prisma.$transaction).mockRejectedValue(new Error('db down'))

      await service.processDue()

      const failCall = vi.mocked(prisma.accountDeletionRequest.updateMany).mock
        .calls[1][0] as any
      expect(failCall.data.status).toBe('failed')
    })
  })

  describe('cancelDeletion', () => {
    it('reports finalized when the finalizer won the race', async () => {
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue({
        id: 'del-1',
        userId: 'user-1',
        status: 'processing',
      } as any)

      const result = await service.cancelDeletion('user-1', {})

      expect(result.kind).toBe('finalized')
      expect(prisma.user.update).not.toHaveBeenCalled()
    })

    it('reports none when no request exists', async () => {
      vi.mocked(prisma.accountDeletionRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)
      vi.mocked(prisma.accountDeletionRequest.findFirst).mockResolvedValue(null)

      const result = await service.cancelDeletion('user-1', {})

      expect(result.kind).toBe('none')
    })
  })
})
