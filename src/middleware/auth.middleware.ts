import { NextFunction, Request, Response } from 'express'

import jwt from 'jsonwebtoken'
import prisma from '../config/database'
import { verifyAccessToken } from '../config/jwt'

export type UserRole = 'learner' | 'employer'

export interface JwtPayload {
  id: string
  email: string
  role: UserRole
  iat?: number
  exp?: number
}

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: JwtPayload
    }
  }
}

/**
 * Strict authentication — rejects requests without a valid JWT.
 * Delegates to verifyAccessToken(), which pins algorithm, issuer,
 * audience, and resolves the signing key via the token's kid header.
 */
export const authenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    res.status(401).json({ message: 'Authorization token required' })

    return
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = verifyAccessToken(token) as unknown as JwtPayload
    req.user = decoded
    next()
  } catch (err) {
    if (err instanceof jwt.TokenExpiredError) {
      res.status(401).json({ message: 'Token has expired' })

      return
    }
    if (err instanceof jwt.JsonWebTokenError) {
      res.status(401).json({ message: 'Invalid token' })

      return
    }
    res
      .status(500)
      .json({ message: 'Internal server error during authentication' })
  }
}

/**
 * Optional authentication — attaches user to req if token is present and valid,
 * but does not block requests without a token.
 */
export const optionalAuthenticate = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const authHeader = req.headers.authorization

  if (!authHeader || !authHeader.startsWith('Bearer ')) {
    return next()
  }

  const token = authHeader.split(' ')[1]

  try {
    const decoded = verifyAccessToken(token) as unknown as JwtPayload
    req.user = decoded
  } catch {
    /** */
  }

  next()
}

/**
 * Account-status gate — must be used after `authenticate`.
 * JWTs are stateless, so tokens issued before deactivation or a deletion
 * request stay verifiable until expiry; this middleware checks the current
 * account status in the database and only lets ACTIVE accounts through.
 */
export const requireActiveAccount = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' })

    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { status: true },
    })

    if (!user || user.status === 'DELETED') {
      res.status(401).json({ message: 'Account not found' })

      return
    }

    if (user.status === 'DEACTIVATED') {
      res.status(403).json({
        message: 'Account is deactivated',
        code: 'ACCOUNT_DEACTIVATED',
      })

      return
    }

    if (user.status === 'PENDING_DELETION') {
      res.status(403).json({
        message: 'Account is scheduled for deletion',
        code: 'ACCOUNT_PENDING_DELETION',
      })

      return
    }

    next()
  } catch {
    res
      .status(500)
      .json({ message: 'Internal server error during account status check' })
  }
}

/**
 * Verified-email gate — must be used after `authenticate`.
 * Blocks operations that the platform's verification policy (see
 * docs/AUTH_POLICY.md) requires a confirmed email address for.
 */
export const requireVerifiedEmail = async (
  req: Request,
  res: Response,
  next: NextFunction,
): Promise<void> => {
  if (!req.user) {
    res.status(401).json({ message: 'Authentication required' })

    return
  }

  try {
    const user = await prisma.user.findUnique({
      where: { id: req.user.id },
      select: { isVerified: true },
    })

    if (!user) {
      res.status(401).json({ message: 'Account not found' })

      return
    }

    if (!user.isVerified) {
      res.status(403).json({
        message: 'This action requires a verified email address',
        code: 'EMAIL_NOT_VERIFIED',
      })

      return
    }

    next()
  } catch {
    res
      .status(500)
      .json({ message: 'Internal server error during verification check' })
  }
}

/**
 * Role-based authorization — must be used after `authenticate`.
 * Re-reads the user's role and status from the database rather than
 * trusting the JWT claim: a role change or account status change must
 * take effect immediately, not only once the old token expires.
 */
export const authorize = (...roles: UserRole[]) => {
  return async (
    req: Request,
    res: Response,
    next: NextFunction,
  ): Promise<void> => {
    if (!req.user) {
      res.status(401).json({ message: 'Authentication required' })

      return
    }

    try {
      const current = await prisma.user.findUnique({
        where: { id: req.user.id },
        select: { role: true, status: true },
      })

      if (!current || current.status === 'DELETED') {
        res.status(401).json({ message: 'Account not found' })

        return
      }

      if (current.status === 'DEACTIVATED') {
        res.status(403).json({
          message: 'Account is deactivated',
          code: 'ACCOUNT_DEACTIVATED',
        })

        return
      }

      if (current.status === 'PENDING_DELETION') {
        res.status(403).json({
          message: 'Account is scheduled for deletion',
          code: 'ACCOUNT_PENDING_DELETION',
        })

        return
      }

      const persistedRole = current.role as UserRole

      if (!roles.includes(persistedRole)) {
        res.status(403).json({
          message: `Access denied. Requires one of the following roles: ${roles.join(', ')}`,
        })

        return
      }

      // Keep the persisted role in sync for downstream handlers,
      // in case it drifted from the (now-stale) JWT claim.
      req.user.role = persistedRole
      next()
    } catch {
      res
        .status(500)
        .json({ message: 'Internal server error during authorization' })
    }
  }
}
