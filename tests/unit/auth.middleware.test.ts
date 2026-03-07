import { NextFunction, Request, Response } from 'express'
// JWT_SECRET must be set before auth.middleware is imported because the module
// throws at load time if the variable is missing. vi.stubEnv + dynamic import
// is the correct Vitest pattern for this scenario.
import { describe, expect, it, vi } from 'vitest'

import jwt from 'jsonwebtoken'

const JWT_SECRET = 'test-secret-key'

// Stub the env variable BEFORE the module is imported
vi.stubEnv('JWT_SECRET', JWT_SECRET)

// Dynamically import AFTER stubbing so the module-level guard sees the value
const { authenticate, optionalAuthenticate, authorize } = await import(
  '../../src/middleware/auth.middleware'
)

// ── helpers ───────────────────────────────────────────────────────────────────

function makeToken (
  payload: Record<string, unknown>,
  expiresIn: string | number = '1h',
): string {
  return jwt.sign(payload, JWT_SECRET, { expiresIn } as jwt.SignOptions)
}

function makeMocks () {
  const req = { headers: {} } as Partial<Request>
  const res = {
    status: vi.fn().mockReturnThis(),
    json: vi.fn(),
  } as Partial<Response>
  const next: NextFunction = vi.fn()

  return { req, res, next }
}

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
    expect(res.json).toHaveBeenCalledWith({ message: 'Authorization token required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when Authorization header does not start with Bearer', () => {
    const { req, res, next } = makeMocks()
    req.headers = { authorization: 'Basic sometoken' }

    authenticate(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Authorization token required' })
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 with "Token has expired" for an expired token', () => {
    const { req, res, next } = makeMocks()
    const token = makeToken({ id: 'u1', email: 'x@y.com', role: 'learner' }, -1)
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
    const token = makeToken({ id: 'u1', email: 'x@y.com', role: 'learner' }, -1)
    req.headers = { authorization: `Bearer ${token}` }

    optionalAuthenticate(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })
})

// ── authorize ─────────────────────────────────────────────────────────────────

describe('authorize', () => {
  it('calls next() when user has a matching role', () => {
    const { req, res, next } = makeMocks();
    (req as any).user = { id: 'u1', email: 'a@b.com', role: 'learner' }

    authorize('learner')(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
    expect(res.status).not.toHaveBeenCalled()
  })

  it('calls next() when user role matches one of multiple allowed roles', () => {
    const { req, res, next } = makeMocks();
    (req as any).user = { id: 'u1', email: 'a@b.com', role: 'employer' }

    authorize('learner', 'employer')(req as Request, res as Response, next)

    expect(next).toHaveBeenCalledOnce()
  })

  it('returns 403 when user role is not in the allowed list', () => {
    const { req, res, next } = makeMocks();
    (req as any).user = { id: 'u1', email: 'a@b.com', role: 'learner' }

    authorize('employer')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(403)
    expect(res.json).toHaveBeenCalledWith(
      expect.objectContaining({ message: expect.stringContaining('Access denied') }),
    )
    expect(next).not.toHaveBeenCalled()
  })

  it('returns 401 when req.user is not set', () => {
    const { req, res, next } = makeMocks()

    authorize('learner')(req as Request, res as Response, next)

    expect(res.status).toHaveBeenCalledWith(401)
    expect(res.json).toHaveBeenCalledWith({ message: 'Authentication required' })
    expect(next).not.toHaveBeenCalled()
  })
})