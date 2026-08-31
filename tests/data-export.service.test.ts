import { describe, it, expect, vi, beforeEach } from 'vitest'

vi.mock('../src/config/database', () => ({
  default: {
    user: {
      findUnique: vi.fn(),
    },
    dataExportRequest: {
      findFirst: vi.fn(),
      findMany: vi.fn(),
      create: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    completion: { findMany: vi.fn() },
    credential: { findMany: vi.fn() },
    transaction: { findMany: vi.fn() },
    referralCode: { findFirst: vi.fn() },
    referral: { findMany: vi.fn(), findFirst: vi.fn() },
    syncEvent: { findMany: vi.fn() },
    notificationPreference: { findFirst: vi.fn() },
    notificationLog: { findMany: vi.fn() },
    session: { findMany: vi.fn() },
    auditLog: { findMany: vi.fn(), create: vi.fn() },
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
import { emailService } from '../src/services/email.service'
import { DataExportService } from '../src/services/data-export.service'

const DAY_MS = 24 * 60 * 60 * 1000

const pendingRow = {
  id: 'exp-1',
  userId: 'user-1',
  status: 'pending',
  attemptCount: 0,
  maxAttempts: 5,
  nextAttemptAt: new Date(0),
}

function mockUserData() {
  vi.mocked(prisma.user.findUnique).mockResolvedValue({
    id: 'user-1',
    email: 'test@example.com',
    username: 'testuser',
    role: 'LEARNER',
    walletAddress: 'GABC',
    isVerified: true,
    status: 'ACTIVE',
    createdAt: new Date(),
    lastLoginAt: null,
  } as any)
  vi.mocked(prisma.completion.findMany).mockResolvedValue([
    {
      moduleId: 'm1',
      module: { title: 'Module One' },
      score: 90,
      completedAt: new Date(),
    },
  ] as any)
  vi.mocked(prisma.credential.findMany).mockResolvedValue([
    {
      moduleId: 'm1',
      module: { title: 'Module One' },
      onChainId: 'chain-1',
      issuedAt: new Date(),
    },
  ] as any)
  vi.mocked(prisma.transaction.findMany).mockResolvedValue([
    {
      id: 't1',
      amountStroops: 100_000_000n,
      type: 'reward',
      status: 'completed',
      createdAt: new Date(),
    },
  ] as any)
  vi.mocked(prisma.referralCode.findFirst).mockResolvedValue({
    code: 'REF1',
    createdAt: new Date(),
  } as any)
  vi.mocked(prisma.referral.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.referral.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.syncEvent.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.notificationPreference.findFirst).mockResolvedValue(null)
  vi.mocked(prisma.notificationLog.findMany).mockResolvedValue([] as any)
  vi.mocked(prisma.session.findMany).mockResolvedValue([
    {
      userAgent: 'ua',
      ipAddress: '1.2.3.4',
      createdAt: new Date(),
      expiresAt: new Date(),
      isRevoked: false,
    },
  ] as any)
  vi.mocked(prisma.auditLog.findMany).mockResolvedValue([
    { action: 'LOGIN', createdAt: new Date() },
  ] as any)
}

describe('DataExportService', () => {
  let service: DataExportService

  beforeEach(() => {
    vi.resetAllMocks()
    service = new DataExportService()
    vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)
    vi.mocked(emailService.queueEmail).mockResolvedValue({
      id: 'email-1',
    } as any)
  })

  describe('processQueue', () => {
    it('skips generation when another runner already claimed the row', async () => {
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([
        pendingRow,
      ] as any)
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 0,
      } as any)

      await service.processQueue()

      expect(prisma.dataExportRequest.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'exp-1', status: 'pending' } }),
      )
      expect(prisma.user.findUnique).not.toHaveBeenCalled()
      expect(prisma.dataExportRequest.update).not.toHaveBeenCalled()
    })

    it('generates a redacted artifact and marks the request ready with an expiry', async () => {
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([
        pendingRow,
      ] as any)
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      mockUserData()

      await service.processQueue()

      const updateArg = vi.mocked(prisma.dataExportRequest.update).mock
        .calls[0][0] as any
      expect(updateArg.data.status).toBe('ready')

      // Redaction: no credentials/secrets anywhere in the artifact
      const artifact = updateArg.data.artifact as string
      expect(artifact).not.toContain('"password"')
      expect(artifact).not.toContain('"token"')
      expect(artifact).not.toContain('"tokenHash"')
      expect(artifact).not.toContain('"refreshToken"')
      expect(artifact).not.toContain('hashed_password')

      const parsed = JSON.parse(artifact)
      expect(parsed.exportVersion).toBe(1)
      expect(parsed.data.profile.id).toBe('user-1')
      expect(parsed.data.completions[0].moduleTitle).toBe('Module One')

      // Time-bounded: expiresAt ≈ now + EXPORT_TTL_DAYS (default 7)
      const deltaDays =
        (updateArg.data.expiresAt.getTime() - Date.now()) / DAY_MS
      expect(deltaDays).toBeGreaterThan(6.9)
      expect(deltaDays).toBeLessThan(7.1)

      expect(emailService.queueEmail).toHaveBeenCalledWith(
        'user-1',
        'test@example.com',
        expect.any(String),
        expect.any(String),
        'DATA_EXPORT',
      )
    })

    it('backs off and returns the request to pending on failure', async () => {
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([
        pendingRow,
      ] as any)
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('db down'))

      await service.processQueue()

      const updateArg = vi.mocked(prisma.dataExportRequest.update).mock
        .calls[0][0] as any
      expect(updateArg.data.status).toBe('pending')
      expect(updateArg.data.error).toBe('db down')
      expect(updateArg.data.nextAttemptAt).toBeInstanceOf(Date)
      expect(updateArg.data.nextAttemptAt.getTime()).toBeGreaterThan(Date.now())
    })

    it('dead-letters the request as failed after max attempts', async () => {
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([
        { ...pendingRow, attemptCount: 4 },
      ] as any)
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 1,
      } as any)
      vi.mocked(prisma.user.findUnique).mockRejectedValue(new Error('db down'))

      await service.processQueue()

      const updateArg = vi.mocked(prisma.dataExportRequest.update).mock
        .calls[0][0] as any
      expect(updateArg.data.status).toBe('failed')
    })

    it('re-running after completion is a no-op (idempotent)', async () => {
      // The completed row no longer matches the pending filter
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([] as any)

      await service.processQueue()

      expect(prisma.dataExportRequest.updateMany).not.toHaveBeenCalled()
      expect(prisma.dataExportRequest.update).not.toHaveBeenCalled()
    })
  })

  describe('purgeExpired', () => {
    it('expires ready requests past their expiry and nulls the artifact', async () => {
      vi.mocked(prisma.dataExportRequest.updateMany).mockResolvedValue({
        count: 2,
      } as any)

      const purged = await service.purgeExpired()

      expect(purged).toBe(2)
      expect(prisma.dataExportRequest.updateMany).toHaveBeenCalledWith({
        where: { status: 'ready', expiresAt: { lte: expect.any(Date) } },
        data: { status: 'expired', artifact: null },
      })
    })
  })

  describe('requestExport', () => {
    it('treats a unique-index violation from a concurrent create as a duplicate', async () => {
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
      vi.mocked(prisma.dataExportRequest.findMany).mockResolvedValue([] as any)

      const result = await service.requestExport('user-1')

      expect(result.kind).toBe('duplicate')
      expect(result.request.id).toBe('exp-winner')
    })
  })
})
