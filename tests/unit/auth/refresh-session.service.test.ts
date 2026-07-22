import { describe, it, expect, vi, beforeEach } from 'vitest'
import { RefreshSessionService, hashToken } from '../../../src/domain/auth'
import prisma from '../../../src/config/database'

vi.mock('../../../src/config/database', () => ({
  default: {
    refreshSession: {
      create: vi.fn(),
      findFirst: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
      findMany: vi.fn(),
    },
  },
}))

describe('RefreshSessionService', () => {
  let service: RefreshSessionService

  beforeEach(() => {
    service = new RefreshSessionService()
    vi.clearAllMocks()
  })

  describe('createSession', () => {
    it('creates a session and returns raw token (not stored)', async () => {
      ;(prisma.refreshSession.create as any).mockResolvedValue({ id: 's1' })

      const result = await service.createSession('u1', {
        userAgent: 'test-agent',
        ipAddress: '127.0.0.1',
      })

      expect(result.rawToken).toBeTruthy()
      expect(result.sessionId).toBe('s1')
      expect(prisma.refreshSession.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            userId: 'u1',
            tokenHash: expect.stringMatching(/^[0-9a-f]{64}$/),
            userAgent: 'test-agent',
            ipAddress: '127.0.0.1',
          }),
        })
      )
    })
  })

  describe('rotateSession', () => {
    it('revokes old session and creates new one on successful rotation', async () => {
      const oldToken = 'old-token'
      const oldHash = hashToken(oldToken)
      const oldSession = {
        id: 's1',
        userId: 'u1',
        tokenHash: oldHash,
        tokenFamily: 'fam1',
        status: 'ACTIVE',
        expiresAt: new Date(Date.now() + 3600000),
      }

      ;(prisma.refreshSession.findFirst as any).mockResolvedValue(oldSession)
      ;(prisma.refreshSession.update as any).mockResolvedValue({})
      ;(prisma.refreshSession.updateMany as any).mockResolvedValue({ count: 0 })
      ;(prisma.refreshSession.create as any).mockResolvedValue({ id: 's2' })

      const result = await service.rotateSession(oldToken)

      expect(result.ok).toBe(true)
      if (result.ok) {
        expect(result.userId).toBe('u1')
        expect(result.newSessionId).toBe('s2')
      }
      expect(prisma.refreshSession.update).toHaveBeenCalledWith({
        where: { id: 's1' },
        data: { status: 'REVOKED', revokedAt: expect.any(Date) },
      })
    })

    it('returns invalid for non-existent token', async () => {
      ;(prisma.refreshSession.findFirst as any).mockResolvedValue(null)

      const result = await service.rotateSession('invalid-token')

      expect(result.ok).toBe(false)
      expect(result.reason).toBe('invalid')
    })
  })
})
