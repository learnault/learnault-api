import { AppError, InternalServerError, NotFoundError } from '../utils/errors'
import { NextFunction, Request, Response } from 'express'
import { ErrorCode } from '../types/api.types'
import { env } from '../config/env'
import logger from '../config/logger'

/**
 * Helper to map HTTP status code to standard ErrorCode
 */
export const mapStatusCodeToErrorCode = (statusCode: number): ErrorCode => {
  switch (statusCode) {
    case 400:
      return ErrorCode.BAD_REQUEST
    case 401:
      return ErrorCode.UNAUTHORIZED
    case 403:
      return ErrorCode.FORBIDDEN
    case 404:
      return ErrorCode.RESOURCE_NOT_FOUND
    case 409:
      return ErrorCode.CONFLICT
    case 422:
      return ErrorCode.VALIDATION_ERROR
    case 429:
      return ErrorCode.RATE_LIMIT_EXCEEDED
    case 503:
      return ErrorCode.SERVICE_UNAVAILABLE
    default:
      return ErrorCode.INTERNAL_SERVER_ERROR
  }
}

/**
 * Global error handler middleware
 * Must be registered as the last middleware in the application
 * Catches all errors and returns consistent JSON responses
 */
export const errorHandler = (
  err: Error | AppError,
  req: Request,
  res: Response,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  next?: NextFunction,
): void => {
  let error = err

  // Get request ID for correlation
  const requestId = req.requestId || 'unknown'

  logger.error({
    message: err.message,
    stack: err.stack,
    path: req.path,
    method: req.method,
    requestId,
    actor: req.actor ? `${req.actor.role}:${req.actor.id}` : 'anonymous',
    timestamp: new Date().toISOString(),
  })

  if (!(error instanceof AppError)) {
    const message =
      err instanceof Error ? err.message : 'An unexpected error occurred'
    error = new InternalServerError(message)
  }

  const statusCode = (error as AppError).statusCode || 500
  const code = (error as AppError).code || mapStatusCodeToErrorCode(statusCode)
  const isDevelopment = env.NODE_ENV === 'development'

  const errorResponse: any = {
    success: false,
    error: {
      message: (error as AppError).message,
      code,
    },
    requestId,
    timestamp: new Date().toISOString(),
  }

  if (isDevelopment && err.stack) {
    errorResponse.error.stack = err.stack.split('\n')
  }

  if ('errors' in error && (error as any).errors) {
    errorResponse.error.details = (error as any).errors
  }

  if (isDevelopment) {
    errorResponse.error.request = {
      method: req.method,
      path: req.path,
      headers: req.headers,
    }
  }

  res.status(statusCode).json(errorResponse)
}

/**
 * 404 Not Found handler
 * Must be registered AFTER all routes
 */
export const notFoundHandler = (
  req: Request,
  res: Response,
  next: NextFunction,
): void => {
  const notFound = new NotFoundError(`Cannot ${req.method} ${req.path}`)
  const requestId = req.requestId || 'unknown'

  logger.warn({
    message: 'Not Found',
    path: req.path,
    method: req.method,
    requestId,
    timestamp: new Date().toISOString(),
  })

  next(notFound)
}

/**
 * Async error wrapper for route handlers
 * Prevents unhandled promise rejections
 */
export const asyncHandler = (
  fn: (req: Request, res: Response, next: NextFunction) => Promise<any>,
) => {
  return (req: Request, res: Response, next: NextFunction) => {
    Promise.resolve(fn(req, res, next)).catch((error) => {
      const requestId = req.requestId || 'unknown'

      logger.error({
        message: 'Async error caught',
        error: error.message,
        stack: error.stack,
        path: req.path,
        method: req.method,
        requestId,
        timestamp: new Date().toISOString(),
      })

      next(error)
    })
  }
}
