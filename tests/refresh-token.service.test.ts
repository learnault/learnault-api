/**
 * tests/refresh-token.service.test.ts
 *
 * Unit tests for the rotating refresh-token service (#130).
 *
 * Coverage checklist (per acceptance criteria):
 *  ✓ IssueSession — creates session + first token, stores only a hash
 *  ✓ Rotate — consumes ACTIVE token, mints new token in the same family
 *  ✓ Reuse — replaying a ROTATED token revokes the whole family
 *  ✓ Race — concurrent rotation (updateMany count 0) is treated as reuse
 *  ✓ Expiry — expired token/session is rejected without rotating
 *  ✓ Revocation — revoked token/session is rejected; logout-current/all revoke
 *  ✓ Logout — logout-current revokes one family, logout-all revokes the user
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import prisma from '../src/config/database'
import { issueAccessToken } from '../src/config/jwt'
import {
  RefreshTokenService,
  generateOpaqueToken,
  hashToken,
} from '../src/services/refresh-token.service'
import { SessionAuditAction } from '../src/types/session.types'

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('../src/config/database', () => ({
  default: {
    session: {
      create: vi.fn(),
      findMany: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    refreshToken: {
      create: vi.fn(),
      findUnique: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(async (ops: any[]) => Promise.all(ops)),
  },
}))

vi.mock('../src/config/jwt', () => ({
  accessTokenTtlSeconds: 900,
  issueAccessToken: vi.fn(),
}))

vi.mock('../src/config/env', () => ({
  env: { REFRESH_TOKEN_TTL_SECONDS: 2592000 },
}))

vi.mock('../src/services/audit.service', () => ({
  auditService: { op: vi.fn(() => ({})), record: vi.fn() },
}))

// ── Helpers ─────────────────────────────────────────────────────────────

const FUTURE = () => new Date(Date.now() + 3600_000)
const PAST = () => new Date(Date.now() - 1000)

function foundRow(overrides: Record<string, unknown> = {}) {
  const future = FUTURE()

  return {
    id: 'rt-1',
    sessionId: 'sess-1',
    familyId: 'family-1',
    status: 'ACTIVE',
    expiresAt: future,
    session: {
      id: 'sess-1',
      userId: 'user-1',
      isRevoked: false,
      expiresAt: future,
      user: { id: 'user-1', role: 'learner' },
    },
    ...overrides,
  }
}

// ── Tests ────────────────────────────────────────────────────────────────

describe('RefreshTokenService', () => {
  let service: RefreshTokenService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new RefreshTokenService()

    vi.mocked(issueAccessToken).mockImplementation(({ id }: { id: string }) => `access-token-${id}`)
    vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 1 } as any)
    vi.mocked(prisma.session.create).mockResolvedValue({ id: 'sess-1' } as any)
    vi.mocked(prisma.refreshToken.create).mockResolvedValue({} as any)
    vi.mocked(prisma.session.update).mockResolvedValue({} as any)
  })

  describe('helpers', () => {
    it('generates an opaque 64-character base64url token', () => {
      expect(generateOpaqueToken()).toMatch(/^[A-Za-z0-9_-]{64}$/)
    })

    it('hashes a token to a 64-char hex digest', () => {
      expect(hashToken('hello')).toMatch(/^[0-9a-f]{64}$/)
      expect(hashToken('hello')).toBe(hashToken('hello'))
    })
  })

  describe('issueSession', () => {
    it('creates a session and first refresh token atomically, storing only the hash', async () => {
      const result = await service.issueSession({
        userId: 'user-1',
        role: 'learner',
        userAgent: 'vitest',
        ipAddress: '1.2.3.4',
      })

      expect(issueAccessToken).toHaveBeenCalledWith({ id: 'user-1', role: 'learner' })
      expect(prisma.$transaction).toHaveBeenCalled()

      const txOps = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown[]
      expect(txOps).toHaveLength(2)

      expect(prisma.session.create).toHaveBeenCalledWith({
        data: expect.objectContaining({
          userId: 'user-1',
          token: 'access-token-user-1',
          userAgent: 'vitest',
          ipAddress: '1.2.3.4',
        }),
      })

      // Only the hash of the refresh token is persisted — never the raw value.
      const createArgs = vi.mocked(prisma.refreshToken.create).mock.calls[0][0] as any
      expect(createArgs.data.tokenHash).not.toBe(result.refreshToken)
      expect(createArgs.data.tokenHash).toBe(hashToken(result.refreshToken))
      expect(createArgs.data.status).toBe('ACTIVE')

      expect(result).toMatchObject({
        sessionId: expect.any(String),
        accessToken: 'access-token-user-1',
        expiresIn: 900,
      })
      expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/)
    })
  })

  describe('rotate', () => {
    it('rotates an ACTIVE token: consumes it and mints a new token in the same family', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(foundRow() as any)

      const result = await service.rotate('raw-refresh-token', { ipAddress: '1.2.3.4' })

      // Looked up by hash
      expect(prisma.refreshToken.findUnique).toHaveBeenCalledWith(
        expect.objectContaining({ where: { tokenHash: hashToken('raw-refresh-token') } })
      )

      // Atomic claim
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith({
        where: { id: 'rt-1', status: 'ACTIVE' },
        data: { status: 'ROTATED' },
      })

      // New token is minted in the same family and the session is advanced
      const createArgs = vi.mocked(prisma.refreshToken.create).mock.calls[0][0] as any
      expect(createArgs.data).toMatchObject({
        sessionId: 'sess-1',
        familyId: 'family-1',
        status: 'ACTIVE',
      })
      expect(prisma.session.update).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1' },
          data: expect.objectContaining({ token: 'access-token-user-1' }),
        })
      )

      expect(result).toMatchObject({
        kind: 'ok',
        accessToken: 'access-token-user-1',
        expiresIn: 900,
      })
      if (result.kind === 'ok') {
        expect(result.refreshToken).toMatch(/^[A-Za-z0-9_-]{64}$/)
      }
    })

    it('rejects an unknown token as invalid without any writes', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null)

      const result = await service.rotate('unknown')

      expect(result).toEqual({ kind: 'invalid' })
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    })

    it('rejects an expired token without rotating', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ expiresAt: PAST() }) as any
      )

      const result = await service.rotate('expired-token')

      expect(result).toEqual({ kind: 'expired' })
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
    })

    it('rejects a REVOKED token', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ status: 'REVOKED' }) as any
      )

      expect(await service.rotate('revoked-token')).toEqual({ kind: 'revoked' })
    })

    it('returns revoked without rotating when the session is already revoked', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ session: { id: 'sess-1', userId: 'user-1', isRevoked: true, expiresAt: FUTURE(), user: { id: 'user-1', role: 'learner' } } }) as any
      )

      const result = await service.rotate('token-of-revoked-session')

      expect(result).toEqual({ kind: 'revoked' })
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
      expect(prisma.refreshToken.create).not.toHaveBeenCalled()
    })

    it('rejects an expired session', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ session: { id: 'sess-1', userId: 'user-1', isRevoked: false, expiresAt: PAST(), user: { id: 'user-1', role: 'learner' } } }) as any
      )

      expect(await service.rotate('token-of-expired-session')).toEqual({ kind: 'expired' })
    })

    it('detects replay of a ROTATED token and revokes the entire family', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ status: 'ROTATED' }) as any
      )

      const result = await service.rotate('replayed-token')

      expect(result).toEqual({ kind: 'reuse' })
      // Family revoked…
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { familyId: 'family-1', status: { not: 'REVOKED' } },
          data: { status: 'REVOKED' },
        })
      )
      // …and the parent session revoked
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { id: 'sess-1', isRevoked: false },
          data: expect.objectContaining({ isRevoked: true }),
        })
      )
    })

    it('treats a lost rotation race as reuse and revokes the family', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(foundRow() as any)
      // Another request claimed the ACTIVE→ROTATED transition first.
      vi.mocked(prisma.refreshToken.updateMany).mockResolvedValue({ count: 0 } as any)

      const result = await service.rotate('raced-token')

      expect(result).toEqual({ kind: 'reuse' })
      expect(prisma.session.updateMany).toHaveBeenCalled()
    })
  })

  describe('revokeByRefreshToken (logout current)', () => {
    it('revokes the session and family for a known token', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        sessionId: 'sess-1',
        familyId: 'family-1',
        session: { userId: 'user-1' },
      } as any)

      const result = await service.revokeByRefreshToken('current-token', { ipAddress: '1.2.3.4' })

      expect(result).toEqual({ revokedCount: 1 })
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { familyId: 'family-1', status: { not: 'REVOKED' } } })
      )
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: 'sess-1', isRevoked: false } })
      )
    })

    it('is a neutral no-op for an unknown token', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null)

      const result = await service.revokeByRefreshToken('unknown')

      expect(result).toEqual({ revokedCount: 0 })
      expect(prisma.refreshToken.updateMany).not.toHaveBeenCalled()
    })
  })

  describe('revokeAllByRefreshToken / revokeAllForUser (logout all)', () => {
    it('revokes every session and their refresh tokens for the identified user', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        session: { userId: 'user-1' },
      } as any)
      vi.mocked(prisma.session.findMany).mockResolvedValue([{ id: 'sess-1' }, { id: 'sess-2' }] as any)

      const result = await service.revokeAllByRefreshToken('any-token')

      expect(result).toEqual({ revokedCount: 2 })
      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({ where: { id: { in: ['sess-1', 'sess-2'] }, isRevoked: false } })
      )
      expect(prisma.refreshToken.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: { sessionId: { in: ['sess-1', 'sess-2'] }, status: { not: 'REVOKED' } },
        })
      )
    })

    it('returns 0 when the user has no active sessions', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        session: { userId: 'user-1' },
      } as any)
      vi.mocked(prisma.session.findMany).mockResolvedValue([] as any)

      const result = await service.revokeAllByRefreshToken('any-token')

      expect(result).toEqual({ revokedCount: 0 })
    })

    it('is a neutral no-op for an unknown token', async () => {
      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(null)

      expect(await service.revokeAllByRefreshToken('unknown')).toEqual({ revokedCount: 0 })
    })
  })

  describe('audit actions', () => {
    it('uses REFRESH_REUSE_DETECTED when a family is revoked due to replay', async () => {
      const { auditService } = await import('../src/services/audit.service')

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue(
        foundRow({ status: 'ROTATED' }) as any
      )

      await service.rotate('replayed-token')

      expect(auditService.op).toHaveBeenCalledWith(
        expect.objectContaining({
          userId: 'user-1',
          action: SessionAuditAction.REFRESH_REUSE_DETECTED,
        })
      )
    })

    it('uses SESSION_LOGGED_OUT for logout-current', async () => {
      const { auditService } = await import('../src/services/audit.service')

      vi.mocked(prisma.refreshToken.findUnique).mockResolvedValue({
        sessionId: 'sess-1',
        familyId: 'family-1',
        session: { userId: 'user-1' },
      } as any)

      await service.revokeByRefreshToken('current-token')

      expect(auditService.op).toHaveBeenCalledWith(
        expect.objectContaining({ action: SessionAuditAction.SESSION_LOGGED_OUT })
      )
    })
  })
})
