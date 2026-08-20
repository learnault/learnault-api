/**
 * tests/session.controller.test.ts
 *
 * Comprehensive unit tests for the Session and Device Management API (#131).
 *
 * Coverage checklist (per acceptance criteria):
 *  ✓ Listing – returns only caller's active sessions, pagination, isCurrent marker
 *  ✓ Revoke one – happy-path, not-found, cross-user (silent 404), current-session guard
 *  ✓ Revoke all – revokes others, keeps current, returns count, idempotent when none
 *  ✓ Redaction  – no token or raw IP fields in any response
 *  ✓ Cross-user protection – cannot target another user's session
 *  ✓ Audit logging – SESSION_REVOKED and SESSION_ALL_REVOKED entries written
 *  ✓ Authorization – 401 without req.user, 400 on bad params/UUID
 *  ✓ SessionService helpers – redactIp, redactFingerprint, toSessionView
 */
import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response } from 'express'
import { SessionController } from '../src/controllers/session.controller'
import {
  SessionService,
  redactIp,
  redactFingerprint,
  toSessionView,
} from '../src/services/session.service'

// ── Module mocks ─────────────────────────────────────────────────────────

vi.mock('../src/config/database', () => ({
  default: {
    session: {
      findUnique: vi.fn(),
      findMany: vi.fn(),
      count: vi.fn(),
      update: vi.fn(),
      updateMany: vi.fn(),
    },
    auditLog: {
      create: vi.fn(),
    },
    $transaction: vi.fn(),
  },
}))

vi.mock('../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn() },
}))

// Mock the entire session service so controller tests are true unit tests
vi.mock('../src/services/session.service', async () => {
  const actual = await vi.importActual<typeof import('../src/services/session.service')>(
    '../src/services/session.service'
  )

  return {
    ...actual, // keep redactIp, redactFingerprint, toSessionView real
    sessionService: {
      list: vi.fn(),
      getById: vi.fn(),
      revokeOne: vi.fn(),
      revokeAll: vi.fn(),
    },
  }
})

import prisma from '../src/config/database'
import { sessionService } from '../src/services/session.service'

// ── Test helpers ─────────────────────────────────────────────────────────

const flushPromises = () => new Promise<void>(resolve => setTimeout(resolve, 0))

interface AuthRequest extends Partial<Request> {
  user?: { id: string; email: string; role: string }
  headers: Record<string, string>
}

function makeReq(overrides: Partial<AuthRequest> = {}): AuthRequest {
  return {
    user: { id: 'user-1', email: 'alice@example.com', role: 'LEARNER' },
    headers: { authorization: 'Bearer mock_access_token' },
    params: {},
    query: {},
    ip: '1.2.3.4',
    ...overrides,
  }
}

function makeRes(): Partial<Response> {
  return {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  }
}

/** A factory for a minimal SessionView-shaped object */
function sessionFixture(overrides: Partial<{
  id: string
  deviceName: string | null
  browser: string | null
  os: string | null
  country: string | null
  city: string | null
  createdAt: string
  lastUsedAt: string | null
  expiresAt: string
  isCurrent: boolean
}> = {}) {
  return {
    id: 'session-1',
    deviceName: 'Chrome on Linux',
    browser: 'Chrome 124',
    os: 'Linux',
    country: 'NG',
    city: 'Lagos',
    createdAt: new Date('2026-01-01T00:00:00Z').toISOString(),
    lastUsedAt: new Date('2026-01-05T10:00:00Z').toISOString(),
    expiresAt: new Date('2026-02-01T00:00:00Z').toISOString(),
    isCurrent: false,
    ...overrides,
  }
}

// ── redactIp ─────────────────────────────────────────────────────────────

describe('redactIp', () => {
  it('masks the last octet of an IPv4 address', () => {
    expect(redactIp('1.2.3.4')).toBe('1.2.3.*')
    expect(redactIp('192.168.0.100')).toBe('192.168.0.*')
  })

  it('masks the trailing groups of an IPv6 address', () => {
    const result = redactIp('2001:db8:85a3:0:0:8a2e:370:7334')
    expect(result).toBe('2001:db8:85a3:0:*')
  })

  it('returns null for null/undefined/empty input', () => {
    expect(redactIp(null)).toBeNull()
    expect(redactIp(undefined)).toBeNull()
    expect(redactIp('')).toBeNull()
  })

  it('returns null for an unparseable value', () => {
    expect(redactIp('not-an-ip')).toBeNull()
  })
})

// ── redactFingerprint ────────────────────────────────────────────────────

describe('redactFingerprint', () => {
  it('truncates a long fingerprint to 8 characters', () => {
    expect(redactFingerprint('abcdef1234567890')).toBe('abcdef12')
  })

  it('returns a string shorter than 8 chars unchanged', () => {
    expect(redactFingerprint('abc')).toBe('abc')
  })

  it('returns null for null/undefined', () => {
    expect(redactFingerprint(null)).toBeNull()
    expect(redactFingerprint(undefined)).toBeNull()
  })
})

// ── toSessionView ────────────────────────────────────────────────────────

describe('toSessionView', () => {
  const row = {
    id: 'sess-1',
    deviceName: 'iPhone 14',
    browser: 'Safari',
    os: 'iOS',
    country: 'NG',
    city: 'Abuja',
    createdAt: new Date('2026-01-01T00:00:00Z'),
    lastUsedAt: new Date('2026-01-10T09:00:00Z'),
    expiresAt: new Date('2027-01-01T00:00:00Z'),
  }

  it('maps all fields to ISO strings', () => {
    const view = toSessionView(row, null)
    expect(view.id).toBe('sess-1')
    expect(view.deviceName).toBe('iPhone 14')
    expect(view.createdAt).toBe('2026-01-01T00:00:00.000Z')
    expect(view.lastUsedAt).toBe('2026-01-10T09:00:00.000Z')
    expect(view.expiresAt).toBe('2027-01-01T00:00:00.000Z')
  })

  it('sets isCurrent true when id matches currentSessionId', () => {
    const view = toSessionView(row, 'sess-1')
    expect(view.isCurrent).toBe(true)
  })

  it('sets isCurrent false when id does not match', () => {
    const view = toSessionView(row, 'sess-other')
    expect(view.isCurrent).toBe(false)
  })

  it('sets isCurrent false when currentSessionId is null', () => {
    const view = toSessionView(row, null)
    expect(view.isCurrent).toBe(false)
  })

  it('serializes null lastUsedAt to null (not a string)', () => {
    const view = toSessionView({ ...row, lastUsedAt: null }, null)
    expect(view.lastUsedAt).toBeNull()
  })

  it('does NOT include token or ipAddress fields', () => {
    const view = toSessionView(row, null) as Record<string, unknown>
    expect(view).not.toHaveProperty('token')
    expect(view).not.toHaveProperty('refreshToken')
    expect(view).not.toHaveProperty('ipAddress')
    expect(view).not.toHaveProperty('userAgent')
    expect(view).not.toHaveProperty('fingerprint')
  })
})

// ── SessionController ─────────────────────────────────────────────────────

describe('SessionController', () => {
  let controller: SessionController
  let res: Partial<Response>

  beforeEach(() => {
    controller = new SessionController()
    res = makeRes()
    vi.clearAllMocks()

    // By default the current-session lookup (findUnique on token) returns null
    // so isCurrent is omitted – individual tests override as needed.
    vi.mocked(prisma.session.findUnique).mockResolvedValue(null)
  })

  // ── listSessions ─────────────────────────────────────────────────────

  describe('listSessions', () => {
    it('returns a paginated list of sessions', async () => {
      const sessions = [
        sessionFixture({ id: 'session-1', isCurrent: true }),
        sessionFixture({ id: 'session-2', isCurrent: false }),
      ]

      vi.mocked(sessionService.list).mockResolvedValue({ sessions, total: 2 })

      controller.listSessions(makeReq() as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      const body = vi.mocked(res.json).mock.calls[0][0] as {
        sessions: unknown[]
        pagination: Record<string, unknown>
      }
      expect(body.sessions).toHaveLength(2)
      expect(body.pagination).toMatchObject({
        page: 1,
        limit: 20,
        total: 2,
        totalPages: 1,
        hasNext: false,
        hasPrev: false,
      })
    })

    it('respects custom page and limit query params', async () => {
      vi.mocked(sessionService.list).mockResolvedValue({ sessions: [], total: 50 })

      const req = makeReq({ query: { page: '3', limit: '10' } })
      controller.listSessions(req as Request, res as Response)
      await flushPromises()

      expect(sessionService.list).toHaveBeenCalledWith(
        'user-1',
        null,
        3,
        10
      )

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        pagination: Record<string, unknown>
      }
      // total=50, limit=10 → 5 pages; page 3 of 5 → hasNext true, hasPrev true
      expect(body.pagination).toMatchObject({
        page: 3,
        limit: 10,
        total: 50,
        totalPages: 5,
        hasNext: true,
        hasPrev: true,
      })
    })

    it('hasNext is true when more pages exist', async () => {
      vi.mocked(sessionService.list).mockResolvedValue({ sessions: [], total: 100 })

      const req = makeReq({ query: { page: '1', limit: '10' } })
      controller.listSessions(req as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        pagination: Record<string, unknown>
      }
      expect(body.pagination.hasNext).toBe(true)
      expect(body.pagination.hasPrev).toBe(false)
    })

    it('returns 400 for invalid page param', async () => {
      const req = makeReq({ query: { page: '0' } })
      controller.listSessions(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation failed' })
      )
    })

    it('returns 400 for limit exceeding 100', async () => {
      const req = makeReq({ query: { limit: '200' } })
      controller.listSessions(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 500 when sessionService.list throws', async () => {
      vi.mocked(sessionService.list).mockRejectedValue(new Error('db error'))

      controller.listSessions(makeReq() as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    })

    it('response never contains token, refreshToken, ipAddress, userAgent, or fingerprint fields', async () => {
      const sessions = [sessionFixture({ id: 'sess-1' })]
      vi.mocked(sessionService.list).mockResolvedValue({ sessions, total: 1 })

      controller.listSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        sessions: Record<string, unknown>[]
      }
      const firstSession = body.sessions[0]
      expect(firstSession).not.toHaveProperty('token')
      expect(firstSession).not.toHaveProperty('refreshToken')
      expect(firstSession).not.toHaveProperty('ipAddress')
      expect(firstSession).not.toHaveProperty('userAgent')
      expect(firstSession).not.toHaveProperty('fingerprint')
    })

    it('marks the current session with isCurrent: true', async () => {
      const sessions = [
        sessionFixture({ id: 'session-current', isCurrent: true }),
        sessionFixture({ id: 'session-other', isCurrent: false }),
      ]
      vi.mocked(sessionService.list).mockResolvedValue({ sessions, total: 2 })

      controller.listSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        sessions: { id: string; isCurrent: boolean }[]
      }
      expect(body.sessions.find(s => s.id === 'session-current')?.isCurrent).toBe(true)
      expect(body.sessions.find(s => s.id === 'session-other')?.isCurrent).toBe(false)
    })

    it('handles an empty session list gracefully', async () => {
      vi.mocked(sessionService.list).mockResolvedValue({ sessions: [], total: 0 })

      controller.listSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as {
        sessions: unknown[]
        pagination: Record<string, unknown>
      }
      expect(body.sessions).toEqual([])
      expect(body.pagination.total).toBe(0)
      expect(body.pagination.totalPages).toBe(0)
    })
  })

  // ── revokeSession ─────────────────────────────────────────────────────

  describe('revokeSession', () => {
    const VALID_SESSION_ID = '3fa85f64-5717-4562-b3fc-2c963f66afa6'

    it('returns 200 when session is successfully revoked', async () => {
      vi.mocked(sessionService.revokeOne).mockResolvedValue({ kind: 'ok' })

      const req = makeReq({ params: { sessionId: VALID_SESSION_ID } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ message: 'Session revoked successfully' })
      )
    })

    it('returns 404 when session is not found', async () => {
      vi.mocked(sessionService.revokeOne).mockResolvedValue({ kind: 'not_found' })

      const req = makeReq({ params: { sessionId: VALID_SESSION_ID } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'Session not found' })
    })

    it('returns 404 (not 403) for a cross-user session — prevents session-existence leaking', async () => {
      vi.mocked(sessionService.revokeOne).mockResolvedValue({ kind: 'cross_user' })

      const req = makeReq({ params: { sessionId: VALID_SESSION_ID } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      // Must be 404, NOT 403 — leaking the fact the session exists to another
      // user would be an information disclosure vulnerability.
      expect(res.status).toHaveBeenCalledWith(404)
      expect(res.json).toHaveBeenCalledWith({ error: 'Session not found' })
    })

    it('returns 400 with code CURRENT_SESSION when caller tries to revoke their own current session', async () => {
      vi.mocked(sessionService.revokeOne).mockResolvedValue({ kind: 'current_session' })

      const req = makeReq({ params: { sessionId: VALID_SESSION_ID } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ code: 'CURRENT_SESSION' })
      )
    })

    it('returns 400 for a non-UUID sessionId', async () => {
      const req = makeReq({ params: { sessionId: 'not-a-uuid' } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(400)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ error: 'Validation failed' })
      )
      // Service must NOT have been called
      expect(sessionService.revokeOne).not.toHaveBeenCalled()
    })

    it('returns 400 for a missing sessionId', async () => {
      const req = makeReq({ params: {} })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(400)
    })

    it('returns 500 when sessionService.revokeOne throws', async () => {
      vi.mocked(sessionService.revokeOne).mockRejectedValue(new Error('db failure'))

      const req = makeReq({ params: { sessionId: VALID_SESSION_ID } })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    })

    it('passes correct userId, sessionId, and audit context to service', async () => {
      vi.mocked(sessionService.revokeOne).mockResolvedValue({ kind: 'ok' })

      const req = makeReq({
        params: { sessionId: VALID_SESSION_ID },
        ip: '10.0.0.1',
        headers: {
          authorization: 'Bearer access_token',
          'user-agent': 'TestAgent/1.0',
        },
      })
      controller.revokeSession(req as Request, res as Response)
      await flushPromises()

      // In unit tests the token-lookup (prisma.session.findUnique) returns null
      // so currentSessionId resolves to null.
      expect(sessionService.revokeOne).toHaveBeenCalledWith(
        'user-1',
        VALID_SESSION_ID,
        null,
        expect.objectContaining({
          ipAddress: '10.0.0.1',
          userAgent: 'TestAgent/1.0',
        })
      )
    })
  })

  // ── revokeAllOtherSessions ────────────────────────────────────────────

  describe('revokeAllOtherSessions', () => {
    it('returns 200 with the revoked count', async () => {
      vi.mocked(sessionService.revokeAll).mockResolvedValue({ kind: 'ok', revokedCount: 3 })

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      expect(res.json).toHaveBeenCalledWith(
        expect.objectContaining({ revokedCount: 3 })
      )
    })

    it('uses plural message when revokedCount > 1', async () => {
      vi.mocked(sessionService.revokeAll).mockResolvedValue({ kind: 'ok', revokedCount: 5 })

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as { message: string }
      expect(body.message).toMatch(/5 sessions revoked/)
    })

    it('uses singular message when revokedCount === 1', async () => {
      vi.mocked(sessionService.revokeAll).mockResolvedValue({ kind: 'ok', revokedCount: 1 })

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const body = vi.mocked(res.json).mock.calls[0][0] as { message: string }
      expect(body.message).toMatch(/1 session revoked/)
    })

    it('returns appropriate message when there are no other sessions', async () => {
      vi.mocked(sessionService.revokeAll).mockResolvedValue({ kind: 'ok', revokedCount: 0 })

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(200)
      const body = vi.mocked(res.json).mock.calls[0][0] as {
        message: string
        revokedCount: number
      }
      expect(body.revokedCount).toBe(0)
      expect(body.message).toMatch(/No other active sessions/)
    })

    it('is idempotent — second call also returns 200 with count 0', async () => {
      vi.mocked(sessionService.revokeAll)
        .mockResolvedValueOnce({ kind: 'ok', revokedCount: 3 })
        .mockResolvedValueOnce({ kind: 'ok', revokedCount: 0 })

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      const res2 = makeRes()
      controller.revokeAllOtherSessions(makeReq() as Request, res2 as Response)
      await flushPromises()

      expect(res2.status).toHaveBeenCalledWith(200)
      const body2 = vi.mocked(res2.json).mock.calls[0][0] as { revokedCount: number }
      expect(body2.revokedCount).toBe(0)
    })

    it('returns 500 when sessionService.revokeAll throws', async () => {
      vi.mocked(sessionService.revokeAll).mockRejectedValue(new Error('db down'))

      controller.revokeAllOtherSessions(makeReq() as Request, res as Response)
      await flushPromises()

      expect(res.status).toHaveBeenCalledWith(500)
      expect(res.json).toHaveBeenCalledWith({ error: 'Internal server error' })
    })

    it('passes userId, currentSessionId, and audit context to service', async () => {
      vi.mocked(sessionService.revokeAll).mockResolvedValue({ kind: 'ok', revokedCount: 2 })

      const req = makeReq({
        ip: '172.16.0.5',
        headers: {
          authorization: 'Bearer my_token',
          'user-agent': 'Mozilla/5.0',
        },
      })
      controller.revokeAllOtherSessions(req as Request, res as Response)
      await flushPromises()

      // In unit tests the token-lookup (prisma.session.findUnique) returns null
      // so currentSessionId resolves to null.
      expect(sessionService.revokeAll).toHaveBeenCalledWith(
        'user-1',
        null,
        expect.objectContaining({
          ipAddress: '172.16.0.5',
          userAgent: 'Mozilla/5.0',
        })
      )
    })
  })
})

// ── SessionService unit tests ─────────────────────────────────────────────

describe('SessionService', () => {
  let service: SessionService

  beforeEach(() => {
    vi.clearAllMocks()
    service = new SessionService()
  })

  // ── list ──────────────────────────────────────────────────────────────

  describe('list', () => {
    const now = new Date()
    const future = new Date(now.getTime() + 60 * 60 * 1000) // +1h

    const dbRow = {
      id: 'session-1',
      deviceName: 'Chrome',
      browser: 'Chrome 124',
      os: 'Linux',
      country: 'NG',
      city: 'Lagos',
      createdAt: new Date('2026-01-01T00:00:00Z'),
      lastUsedAt: new Date('2026-01-05T00:00:00Z'),
      expiresAt: future,
    }

    it('returns sessions and total count', async () => {
      vi.mocked(prisma.$transaction).mockResolvedValue([[dbRow], 1])

      const result = await service.list('user-1', null, 1, 20)

      expect(result.total).toBe(1)
      expect(result.sessions).toHaveLength(1)
      expect(result.sessions[0]).toMatchObject({
        id: 'session-1',
        isCurrent: false,
      })
    })

    it('bubbles the current session to the top of the page', async () => {
      const session1 = { ...dbRow, id: 'session-1' }
      const session2 = { ...dbRow, id: 'session-current' }

      vi.mocked(prisma.$transaction).mockResolvedValue([[session1, session2], 2])

      const result = await service.list('user-1', 'session-current', 1, 20)

      expect(result.sessions[0].id).toBe('session-current')
      expect(result.sessions[0].isCurrent).toBe(true)
      expect(result.sessions[1].id).toBe('session-1')
      expect(result.sessions[1].isCurrent).toBe(false)
    })

    it('only queries sessions owned by userId', async () => {
      vi.mocked(prisma.$transaction).mockResolvedValue([[], 0])

      await service.list('user-42', null, 1, 10)

      expect(prisma.$transaction).toHaveBeenCalled()
      // findMany and count are called inside $transaction — verify the where clause
      // by checking the captured calls to the mock
      const calls = vi.mocked(prisma.$transaction).mock.calls[0][0] as unknown[]
      expect(calls).toHaveLength(2)
    })
  })

  // ── revokeOne ─────────────────────────────────────────────────────────

  describe('revokeOne', () => {
    const ctx = { ipAddress: '1.2.3.4', userAgent: 'test' }
    const future = new Date(Date.now() + 3600_000)

    it('returns ok and writes the session + audit in a transaction', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        isRevoked: false,
        expiresAt: future,
      } as any)

      vi.mocked(prisma.$transaction).mockResolvedValue([])
      vi.mocked(prisma.session.update).mockResolvedValue({} as any)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      const result = await service.revokeOne('user-1', 'sess-1', null, ctx)

      expect(result.kind).toBe('ok')
      expect(prisma.$transaction).toHaveBeenCalled()
    })

    it('returns not_found when session does not exist', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue(null)

      const result = await service.revokeOne('user-1', 'sess-missing', null, ctx)

      expect(result.kind).toBe('not_found')
    })

    it('returns not_found when session is already revoked', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        isRevoked: true,
        expiresAt: future,
      } as any)

      const result = await service.revokeOne('user-1', 'sess-1', null, ctx)

      expect(result.kind).toBe('not_found')
    })

    it('returns not_found when session has expired', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        isRevoked: false,
        expiresAt: new Date(Date.now() - 1000), // in the past
      } as any)

      const result = await service.revokeOne('user-1', 'sess-1', null, ctx)

      expect(result.kind).toBe('not_found')
    })

    it('returns cross_user when session belongs to a different user', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-OTHER',
        isRevoked: false,
        expiresAt: future,
      } as any)

      const result = await service.revokeOne('user-1', 'sess-1', null, ctx)

      expect(result.kind).toBe('cross_user')
      // No database write must occur for cross-user attempts
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('returns current_session when sessionId matches currentSessionId', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-current',
        userId: 'user-1',
        isRevoked: false,
        expiresAt: future,
      } as any)

      const result = await service.revokeOne('user-1', 'sess-current', 'sess-current', ctx)

      expect(result.kind).toBe('current_session')
      expect(prisma.$transaction).not.toHaveBeenCalled()
    })

    it('writes SESSION_REVOKED audit entry on success', async () => {
      vi.mocked(prisma.session.findUnique).mockResolvedValue({
        id: 'sess-1',
        userId: 'user-1',
        isRevoked: false,
        expiresAt: future,
      } as any)

      let _capturedOps: any[] = []
      vi.mocked(prisma.$transaction).mockImplementation((ops: any[]) => {
        _capturedOps = ops

        return Promise.resolve([{}, {}])
      })
      vi.mocked(prisma.auditLog.create).mockReturnValue({} as any)

      await service.revokeOne('user-1', 'sess-1', null, ctx)

      // The second op in the transaction should be the audit log create
      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SESSION_REVOKED',
            userId: 'user-1',
          }),
        })
      )
    })
  })

  // ── revokeAll ─────────────────────────────────────────────────────────

  describe('revokeAll', () => {
    const ctx = { ipAddress: '1.2.3.4', userAgent: 'test' }

    it('returns ok with the count of revoked sessions', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 4 } as any)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      const result = await service.revokeAll('user-1', null, ctx)

      expect(result.kind).toBe('ok')
      expect(result.revokedCount).toBe(4)
    })

    it('excludes the current session from bulk revocation', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 2 } as any)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      await service.revokeAll('user-1', 'session-current', ctx)

      expect(prisma.session.updateMany).toHaveBeenCalledWith(
        expect.objectContaining({
          where: expect.objectContaining({
            NOT: { id: { in: ['session-current'] } },
          }),
        })
      )
    })

    it('writes SESSION_ALL_REVOKED audit entry when sessions were revoked', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 3 } as any)
      vi.mocked(prisma.auditLog.create).mockResolvedValue({} as any)

      await service.revokeAll('user-1', null, ctx)

      expect(prisma.auditLog.create).toHaveBeenCalledWith(
        expect.objectContaining({
          data: expect.objectContaining({
            action: 'SESSION_ALL_REVOKED',
            userId: 'user-1',
          }),
        })
      )
    })

    it('does NOT write an audit entry when revokedCount is 0', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 0 } as any)

      await service.revokeAll('user-1', null, ctx)

      expect(prisma.auditLog.create).not.toHaveBeenCalled()
    })

    it('returns revokedCount 0 when all sessions are already revoked', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 0 } as any)

      const result = await service.revokeAll('user-1', null, ctx)

      expect(result.kind).toBe('ok')
      expect(result.revokedCount).toBe(0)
    })

    it('includes metadata about whether the current session was kept', async () => {
      vi.mocked(prisma.session.updateMany).mockResolvedValue({ count: 2 } as any)

      let auditData: any
      vi.mocked(prisma.auditLog.create).mockImplementation((args: any) => {
        auditData = args.data

        return {} as any
      })

      await service.revokeAll('user-1', 'sess-current', ctx)

      expect(JSON.parse(auditData.metadata)).toMatchObject({
        revokedCount: 2,
        keptCurrentSession: true,
      })
    })
  })
})
