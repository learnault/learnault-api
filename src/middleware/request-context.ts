import { NextFunction, Request, Response } from 'express'
import { randomUUID } from 'crypto'
import logger from '../utils/logger'

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      requestId?: string
      actor?: {
        id: string
        role: string
        email?: string
      }
      startTime?: number
    }
  }
}

/**
 * Request context middleware that:
 * - Generates or validates request IDs
 * - Attaches authenticated actor context (without logging secrets)
 * - Tracks request start time for duration logging
 * - Returns request ID in response headers
 */
export const requestContext = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  // Generate or use existing request ID
  const requestId = (req.headers['x-request-id'] as string) || randomUUID()
  req.requestId = requestId

  // Track start time for duration calculation
  req.startTime = Date.now()

  // Set request ID in response headers
  res.setHeader('x-request-id', requestId)

  // Attach actor context if user is authenticated
  // This happens after auth middleware runs, so we check for req.user
  if (req.user) {
    req.actor = {
      id: req.user.id,
      role: req.user.role,
      email: req.user.email,
    }
  }

  // Log request completion with correlation data
  res.on('finish', () => {
    const duration = req.startTime ? Date.now() - req.startTime : 0
    const logData = {
      requestId,
      method: req.method,
      path: req.path,
      statusCode: res.statusCode,
      duration: `${duration}ms`,
      actor: req.actor ? `${req.actor.role}:${req.actor.id}` : 'anonymous',
      ip: req.ip,
      userAgent: req.headers['user-agent'],
    }

    // Log at appropriate level based on status code
    if (res.statusCode >= 500) {
      logger.error('Request completed with error', logData)
    } else if (res.statusCode >= 400) {
      logger.warn('Request completed with client error', logData)
    } else {
      logger.info('Request completed', logData)
    }
  })

  next()
}

/**
 * Helper function to get the current request ID from the request object.
 * Useful for logging within route handlers and services.
 */
export const getRequestId = (req: Request): string | undefined => {
  return req.requestId
}

/**
 * Helper function to get the current actor context from the request object.
 * Returns undefined if no authenticated user.
 */
export const getActor = (req: Request): Request['actor'] => {
  return req.actor
}
