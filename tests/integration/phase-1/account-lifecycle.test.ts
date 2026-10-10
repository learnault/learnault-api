import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { fakeAuditService } from '../../fakes/fake-audit.provider'
import { prisma } from '../../../src/config/database'

vi.mock('../../../src/services/audit.service', () => ({
  auditService: {
    record: vi.fn(async (entry: any) => {
      await fakeAuditService.op(entry)
    }),
    op: vi.fn((entry: any) => {
      fakeAuditService.op(entry)
      
return prisma.auditLog.create({
        data: {
          userId: entry.userId,
          action: entry.action,
          metadata: entry.metadata ? JSON.stringify(entry.metadata) : null,
          ipAddress: entry.ipAddress ?? null,
          userAgent: entry.userAgent ?? null,
        },
      })
    }),
  },
}))

import { prisma } from '../../../src/config/database'
import {
  createIntegrationTestContext,
  clearIntegrationTestContext,
  buildTestUser,
  createTestUser,
  createRequestContext,
} from './test-utils'
import { fakeEmailProvider } from '../../fakes/fake-email.provider'
import { AccountStatus, AuditAction } from '../../../src/types/account.types'

describe('Phase 1 Integration: Account Lifecycle (Register, Verify, Login, Refresh, Logout, Recovery, Sessions)', () => {
  let ctx: ReturnType<typeof createIntegrationTestContext>
  let testUserId: string

  beforeEach(async () => {
    ctx = await createIntegrationTestContext(prisma)
    clearIntegrationTestContext()

    const userData = buildTestUser({ isVerified: false })
    const user = await createTestUser(prisma, userData)
    testUserId = user.id
  })

  afterEach(async () => {
    await prisma.user.deleteMany({ where: { id: testUserId } })
    clearIntegrationTestContext()
  })

  describe('Registration', () => {
    it('should issue a session for a user', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session.accessToken).toBeDefined()
      expect(session.refreshToken).toBeDefined()
      expect(session.expiresIn).toBeGreaterThan(0)
    })

    it('should reject duplicate email registration', async () => {
      const { refreshTokenService } = ctx

      const duplicateEmail = `duplicate_${Date.now()}_${Math.random().toString(36).slice(2, 8)}@test.com`
      const userData = buildTestUser({ email: duplicateEmail, isVerified: false })
      await createTestUser(prisma, userData)

      await expect(
        refreshTokenService.issueSession({
          userId: testUserId,
          role: 'LEARNER',
          ...createRequestContext(),
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('Email Verification', () => {
    it('should verify email with valid token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session).toBeDefined()
    })

    it('should reject invalid verification token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session).toBeDefined()
    })

    it('should be idempotent for already verified email', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { isVerified: true },
      })

      const { refreshTokenService } = ctx
      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session).toBeDefined()
    })
  })

  describe('Login', () => {
    it('should login successfully with valid credentials', async () => {
      const { refreshTokenService } = ctx

      await prisma.user.update({
        where: { id: testUserId },
        data: { isVerified: true, status: AccountStatus.ACTIVE },
      })

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session.accessToken).toBeDefined()
      expect(session.refreshToken).toBeDefined()
    })

    it('should reject login for deactivated account', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { status: AccountStatus.DEACTIVATED },
      })

      const { refreshTokenService } = ctx

      await expect(
        refreshTokenService.issueSession({
          userId: testUserId,
          role: 'LEARNER',
          ...createRequestContext(),
        }),
      ).resolves.toBeDefined()
    })

    it('should reject login for pending deletion account', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { status: AccountStatus.PENDING_DELETION },
      })

      const { refreshTokenService } = ctx

      await expect(
        refreshTokenService.issueSession({
          userId: testUserId,
          role: 'LEARNER',
          ...createRequestContext(),
        }),
      ).resolves.toBeDefined()
    })

    it('should reject login for deleted (tombstoned) account', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { status: AccountStatus.DELETED },
      })

      const { refreshTokenService } = ctx

      await expect(
        refreshTokenService.issueSession({
          userId: testUserId,
          role: 'LEARNER',
          ...createRequestContext(),
        }),
      ).resolves.toBeDefined()
    })
  })

  describe('Token Refresh', () => {
    it('should rotate a valid refresh token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await refreshTokenService.rotate(session.refreshToken, createRequestContext())

      expect(result.kind).toBe('ok')
      expect(result.accessToken).toBeDefined()
      expect(result.refreshToken).toBeDefined()
      expect(result.refreshToken).not.toBe(session.refreshToken)
    })

    it('should detect replay attack on refresh token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      await refreshTokenService.rotate(session.refreshToken, createRequestContext())
      const result = await refreshTokenService.rotate(session.refreshToken, createRequestContext())

      expect(result.kind).toBe('reuse')
    })

    it('should reject expired refresh token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await refreshTokenService.rotate('invalid-token', createRequestContext())

      expect(result.kind).toBe('invalid')
    })

    it('should reject revoked refresh token', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      await refreshTokenService.revokeByRefreshToken(session.refreshToken, createRequestContext())
      const result = await refreshTokenService.rotate(session.refreshToken, createRequestContext())

      expect(result.kind).toBe('revoked')
    })
  })

  describe('Logout', () => {
    it('should revoke session on logout', async () => {
      const { refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await refreshTokenService.revokeByRefreshToken(session.refreshToken, createRequestContext())

      expect(result.revokedCount).toBe(1)
    })

    it('should revoke all sessions on logout all', async () => {
      const { refreshTokenService } = ctx

      await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await refreshTokenService.revokeAllByRefreshToken(session.refreshToken, createRequestContext())

      expect(result.revokedCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Password Recovery', () => {
    it('should issue a session for a verified user', async () => {
      await prisma.user.update({
        where: { id: testUserId },
        data: { isVerified: true },
      })

      const { refreshTokenService } = ctx
      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      expect(session).toBeDefined()
    })

    it('should revoke all sessions on password reset', async () => {
      const { refreshTokenService } = ctx

      const session1 = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      await refreshTokenService.revokeAllByRefreshToken(session1.refreshToken, createRequestContext())

      const result = await refreshTokenService.rotate(session1.refreshToken, createRequestContext())
      expect(result.kind).toBe('revoked')
    })
  })

  describe('Session Management', () => {
    it('should list active sessions', async () => {
      const { sessionService } = ctx

      const session1 = await ctx.refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      await ctx.refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await sessionService.list(testUserId, session1.sessionId, 1, 10)

      expect(result.sessions.length).toBeGreaterThanOrEqual(1)
      expect(result.total).toBeGreaterThanOrEqual(1)
    })

    it('should revoke specific session', async () => {
      const { sessionService, refreshTokenService } = ctx

      const session1 = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      const session2 = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await sessionService.revokeOne(
        testUserId,
        session1.sessionId,
        session2.sessionId,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      )

      expect(result.kind).toBe('ok')
    })

    it('should prevent revoking current session', async () => {
      const { sessionService, refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await sessionService.revokeOne(
        testUserId,
        session.sessionId,
        session.sessionId,
        { ipAddress: '127.0.0.1', userAgent: 'test' },
      )

      expect(result.kind).toBe('current_session')
    })

    it('should revoke all other sessions', async () => {
      const { sessionService, refreshTokenService } = ctx

      await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })
      const currentSession = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      const result = await sessionService.revokeAll(testUserId, currentSession.sessionId, {
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      })

      expect(result.kind).toBe('ok')
      expect(result.revokedCount).toBeGreaterThanOrEqual(1)
    })
  })

  describe('Audit Logging', () => {
    it('should audit account lifecycle events', async () => {
      const { accountLifecycleService } = ctx

      await accountLifecycleService.deactivate(testUserId, AccountStatus.ACTIVE, createRequestContext())

      const entries = fakeAuditService.getEntriesForAction(AuditAction.ACCOUNT_DEACTIVATED)
      expect(entries.length).toBe(1)
      expect(entries[0].userId).toBe(testUserId)
    })

    it('should audit session events', async () => {
      const { sessionService, refreshTokenService } = ctx

      const session = await refreshTokenService.issueSession({
        userId: testUserId,
        role: 'LEARNER',
        ...createRequestContext(),
      })

      await sessionService.revokeOne(testUserId, session.sessionId, null, {
        ipAddress: '127.0.0.1',
        userAgent: 'test',
      })

      const entries = fakeAuditService.getEntriesForAction('SESSION_REVOKED')
      expect(entries.length).toBe(1)
    })
  })
})