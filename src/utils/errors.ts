import { ErrorCode } from '../types/api.types'

/**
 * Custom AppError class for application-level errors
 * Extends the native Error class with HTTP status codes, stable error codes, and operational context
 */
export class AppError extends Error {
  public readonly statusCode: number
  public readonly code: ErrorCode | string
  public readonly isOperational: boolean

  constructor(
    message: string,
    statusCode: number = 500,
    code: ErrorCode | string = ErrorCode.INTERNAL_SERVER_ERROR,
    isOperational: boolean = true,
  ) {
    super(message)
    this.statusCode = statusCode
    this.code = code
    this.isOperational = isOperational

    // Maintains proper stack trace for where our error was thrown (only available on V8)
    if (Error.captureStackTrace) {
      Error.captureStackTrace(this, this.constructor)
    }

    this.name = this.constructor.name
  }
}

/**
 * BadRequest (400) error
 */
export class BadRequestError extends AppError {
  constructor(message: string = 'Bad Request') {
    super(message, 400, ErrorCode.BAD_REQUEST)
  }
}

/**
 * Unauthorized (401) error
 */
export class UnauthorizedError extends AppError {
  constructor(message: string = 'Unauthorized') {
    super(message, 401, ErrorCode.UNAUTHORIZED)
  }
}

/**
 * Forbidden (403) error
 */
export class ForbiddenError extends AppError {
  constructor(message: string = 'Forbidden') {
    super(message, 403, ErrorCode.FORBIDDEN)
  }
}

/**
 * Not Found (404) error
 */
export class NotFoundError extends AppError {
  constructor(message: string = 'Resource not found') {
    super(message, 404, ErrorCode.RESOURCE_NOT_FOUND)
  }
}

/**
 * Conflict (409) error
 */
export class ConflictError extends AppError {
  constructor(message: string = 'Conflict') {
    super(message, 409, ErrorCode.CONFLICT)
  }
}

/**
 * Validation error (422) for input validation
 */
export class ValidationError extends AppError {
  public readonly errors?: Record<string, string[]>

  constructor(
    message: string = 'Validation failed',
    errors?: Record<string, string[]>,
  ) {
    super(message, 422, ErrorCode.VALIDATION_ERROR)
    this.errors = errors
  }
}

/**
 * Internal Server Error (500) for unexpected errors
 */
export class InternalServerError extends AppError {
  constructor(message: string = 'Internal Server Error') {
    super(message, 500, ErrorCode.INTERNAL_SERVER_ERROR, false)
  }
}
