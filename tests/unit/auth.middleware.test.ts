import { NextFunction, Request, Response } from 'express'
// JWT_SECRET/ISSUER/AUDIENCE must be set before auth.middleware (and the
// config/jwt module it wraps) are imported, since config/jwt reads them at
// module load time. vi.stubEnv + dynamic import is the correct Vitest
// pattern for this scenario.
import { describe, expect, it, vi, beforeEach } from 'vitest'

import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-secret-key'
const JWT_ISSUER = 'learnault-api'
const JWT_AUDIENCE = 'learnault-clients'
const JWT_KEY_ID = 'test-key'

vi.stubEnv('JWT_SECRET', JWT_SECRET)
vi.stubEnv('JWT_ISSUER', JWT_ISSUER)
vi.stubEnv('JWT_AUDIENCE', JWT_AUDIENCE)
vi.stubEnv('JWT_KEY_ID', JWT_KEY_ID)

const findUniqueMock = vi.fn()

vi.mock('../../src/config/database', () => ({
  default: {
    user: {
      findUnique: (...args: unknown[]) => findUniqueMock(...args),
    },
  },
}))

// Dynamically import AFTER stubbing so the module-level guard sees the value
const {
  authenticate,
  optionalAuthenticate,
  authorize,
  requireActiveAccount,
  requireVerifiedEmail,
} = await import('../../src/middleware/auth.middleware')

// ── helpers ───────────────────────────────────────────────────────────────────

function makeToken(
  payload: Record<string, unknown>,
  overrides: {
    expiresIn?: string | number
    issuer?: string
    audience?: string
    keyid?: string
    algorithm?: jwt.Algorithm
  } = {},
): string {
  return jwt.sign(payload, JWT_SECRET, {
    expiresIn: overrides.expiresIn ?? '1h',
    issuer: overrides.issuer ?? JWT_ISSUER,
    audience: overrides.audience ?? JWT_AUDIENCE,
    keyid: overrides.keyid ?? JWT_KEY_ID,
    algorithm: overrides.algorithm ?? 'HS256',
  } as jwt.SignOptions)
}

function makeMocks() {
  const req = { headers: {} } as Partial<Request>
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as Partial<Response>
  const next: NextFunction = vi.fn()

  return { req, res, next }
}

beforeEach(() => {
  findUniqueMock.mockReset()
})

// ── authenticate ──────────────────────────────────────────────────────────────

describe('authenticate', () => {
  it('calls next() and attaches user when token is valid', () => {
    const { req, res, next } = makeMocks()
    req.headers = {
      authorization: `Bearer ${makeToken({ id: 'user-1', email: 'a@b.com', role: 'learner' })}`,
    }

    authenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect((req as any).user).toMatchObject({ id: 'user-1', role: 'learner' })
    expect(res.status).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header is missing', () => {
    const { req, res, next } = makeMocks()
    req.headers = {}

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Authorization token required',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header does not start with Bearer', () => {
    const { req, res, next } = makeMocks()
    req.headers = { authorization: 'Basic sometoken' }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Authorization token required',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with "Token has expired" for an expired token', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { expiresIn: -1 },
    )
    req.headers = { authorization: `Bearer ${token}` }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Token has expired' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with "Invalid token" for a malformed token', () => {
    const { req, res, next } = makeMocks()
    req.headers = { authorization: 'Bearer not.a.valid.token' }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for a token signed with the wrong issuer', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { issuer: 'someone-else' },
    )
    req.headers = { authorization: `Bearer ${token}` }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for a token signed with the wrong audience', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { audience: 'someone-else' },
    )
    req.headers = { authorization: `Bearer ${token}` }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for a token signed with an unrecognized key id', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { keyid: 'unknown-key' },
    )
    req.headers = { authorization: `Bearer ${token}` }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Invalid token' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 for a token signed with a different algorithm', () => {
    const { req, res, next } = makeMocks()
    // none-algorithm/HS384 forgery attempt — must be rejected even though
    // jsonwebtoken itself can produce it.
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { algorithm: 'HS384' },
    )
    req.headers = { authorization: `Bearer ${token}` }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})

// ── optionalAuthenticate ──────────────────────────────────────────────────────

describe('optionalAuthenticate', () => {
  it('calls next() without setting user when no token is provided', () => {
    const { req, res, next } = makeMocks()
    req.headers = {}

    optionalAuthenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect((req as any).user).toBeUndefined()
  })

  it('attaches user and calls next() when a valid token is provided', () => {
    const { req, res, next } = makeMocks()
    req.headers = {
      authorization: `Bearer ${makeToken({ id: 'user-2', email: 'b@c.com', role: 'employer' })}`,
    }

    optionalAuthenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect((req as any).user).toMatchObject({ id: 'user-2', role: 'employer' })
  })

  it('calls next() without blocking when token is invalid', () => {
    const { req, res, next } = makeMocks()
    req.headers = { authorization: 'Bearer bad.token.here' }

    optionalAuthenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() without blocking when token is expired', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken(
      { id: 'u1', email: 'x@y.com', role: 'learner' },
      { expiresIn: -1 },
    )
    req.headers = { authorization: `Bearer ${token}` }

    optionalAuthenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})

// ── requireActiveAccount ─────────────────────────────────────────────────────

describe('requireActiveAccount', () => {
  it('returns 401 when req.user is not set', async () => {
    const { req, res, next } = makeMocks()

    await requireActiveAccount(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() for an ACTIVE account', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue({ status: 'ACTIVE' })

    await requireActiveAccount(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 ACCOUNT_DEACTIVATED for a deactivated account', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue({ status: 'DEACTIVATED' })

    await requireActiveAccount(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCOUNT_DEACTIVATED' }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 403 ACCOUNT_PENDING_DELETION for a pending-deletion account', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue({ status: 'PENDING_DELETION' })

    await requireActiveAccount(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCOUNT_PENDING_DELETION' }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 "Account not found" for a deleted or missing account', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue(null)

    await requireActiveAccount(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Account not found' })
    expect(next).not.toHaveBeenCalled()
  })
})

// ── requireVerifiedEmail ─────────────────────────────────────────────────────

describe('requireVerifiedEmail', () => {
  it('returns 401 when req.user is not set', async () => {
    const { req, res, next } = makeMocks()

    await requireVerifiedEmail(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })

  it('calls next() when the email is verified', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue({ isVerified: true })

    await requireVerifiedEmail(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 EMAIL_NOT_VERIFIED when the email is unverified', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1' }
    findUniqueMock.mockResolvedValue({ isVerified: false })

    await requireVerifiedEmail(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'EMAIL_NOT_VERIFIED' }),
    )
    expect(next).not.toHaveBeenCalled()
  })
})

// ── authorize ─────────────────────────────────────────────────────────────────

describe('authorize', () => {
  it('calls next() when the persisted role matches', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'learner' }
    findUniqueMock.mockResolvedValue({ role: 'learner', status: 'ACTIVE' })

    await authorize('learner')(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() when the persisted role matches one of multiple allowed roles', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'employer' }
    findUniqueMock.mockResolvedValue({ role: 'employer', status: 'ACTIVE' })

    await authorize('learner', 'employer')(
      req as Request,
      res as Response,
      next,
    )

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 when the persisted role is not in the allowed list', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'learner' }
    findUniqueMock.mockResolvedValue({ role: 'learner', status: 'ACTIVE' })

    await authorize('employer')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({
        message: expect.stringContaining('Access denied'),
      }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when req.user is not set', async () => {
    const { req, res, next } = makeMocks()

    await authorize('learner')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({
      message: 'Authentication required',
    })
    expect(next).not.toHaveBeenCalled()
  })

  it('uses the current persisted role even when the JWT claim is stale', async () => {
    const { req, res, next } = makeMocks()
    // Token still claims 'learner', but the account was promoted to
    // 'employer' in the database after the token was issued.
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'learner' }
    findUniqueMock.mockResolvedValue({ role: 'employer', status: 'ACTIVE' })

    await authorize('employer')(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect((req as any).user.role).toBe('employer')
  })

  it('returns 403 ACCOUNT_DEACTIVATED even if the JWT role would otherwise pass', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'employer' }
    findUniqueMock.mockResolvedValue({
      role: 'employer',
      status: 'DEACTIVATED',
    })

    await authorize('employer')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ code: 'ACCOUNT_DEACTIVATED' }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 "Account not found" for a deleted account', async () => {
    const { req, res, next } = makeMocks()
    ;(req as any).user = { id: 'u1', email: 'a@b.com', role: 'employer' }
    findUniqueMock.mockResolvedValue(null)

    await authorize('employer')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(next).not.toHaveBeenCalled()
  })
})
