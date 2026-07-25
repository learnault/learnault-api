import { describe, it, expect, vi, beforeEach } from 'vitest'
import { Request, Response, NextFunction } from 'express'
import {
  ErrorCode,
  SortOrder,
} from '../../src/types/api.types'
import {
  pagePaginationSchema,
  cursorPaginationSchema,
  uuidSchema,
  isoDateSchema,
  assetAmountSchema,
  createPaginationMeta,
  createCursorPaginationMeta,
  createSuccessEnvelope,
  createPaginatedEnvelope,
  createCursorPaginatedEnvelope,
  createStrictSchema,
} from '../../src/schemas/api.schema'
import {
  BadRequestError,
  NotFoundError,
  ValidationError,
} from '../../src/utils/errors'
import { errorHandler } from '../../src/middleware/error.middleware'
import { validate } from '../../src/middleware/validation.middleware'
import {
  apiVersionHeader,
  deprecatedEndpoint,
  setDeprecationHeaders,
} from '../../src/middleware/versioning.middleware'

// Mock logger & env config
vi.mock('../../src/config/logger', () => ({
  default: {
    error: vi.fn(),
    warn: vi.fn(),
    info: vi.fn(),
  },
}))

vi.mock('../../src/config/env', () => ({
  env: {
    NODE_ENV: 'production',
    PORT: 5000,
  },
}))

describe('API Conventions & Contract Standard Suite', () => {
  let mockRequest: Partial<Request>
  let mockResponse: Partial<Response>
  let mockNext: NextFunction
  let jsonMock: ReturnType<typeof vi.fn>
  let statusMock: ReturnType<typeof vi.fn>
  let setHeaderMock: ReturnType<typeof vi.fn>

  beforeEach(() => {
    vi.clearAllMocks()
    jsonMock = vi.fn().mockReturnValue({})
    statusMock = vi.fn().mockReturnValue({ json: jsonMock })
    setHeaderMock = vi.fn()

    mockRequest = {
      path: '/api/v1/test',
      method: 'GET',
      headers: {},
      requestId: 'test-request-id-12345',
    }

    mockResponse = {
      status: statusMock as unknown as Response['status'],
      json: jsonMock as unknown as Response['json'],
      setHeader: setHeaderMock as unknown as Response['setHeader'],
    }

    mockNext = vi.fn() as unknown as NextFunction
  })

  describe('1. Success & Paginated DTO Envelopes', () => {
    it('creates a standard success envelope with metadata', () => {
      const data = { id: '123', name: 'Learnault' }
      const response = createSuccessEnvelope(data, 'Action succeeded', {
        requestId: 'req-999',
        version: 'v1',
      })

      expect(response).toEqual({
        success: true,
        data: { id: '123', name: 'Learnault' },
        message: 'Action succeeded',
        meta: {
          requestId: 'req-999',
          timestamp: expect.any(String),
          version: 'v1',
        },
        timestamp: expect.any(String),
      })
    })

    it('creates page-based pagination metadata and envelope', () => {
      const meta = createPaginationMeta({
        page: 2,
        limit: 10,
        total: 25,
        requestId: 'req-page-1',
      })

      expect(meta).toEqual({
        page: 2,
        limit: 10,
        total: 25,
        totalPages: 3,
        hasNextPage: true,
        hasPrevPage: true,
        requestId: 'req-page-1',
        timestamp: expect.any(String),
        version: 'v1',
      })

      const paginatedEnvelope = createPaginatedEnvelope([{ item: 1 }], meta)
      expect(paginatedEnvelope.success).toBe(true)
      expect(paginatedEnvelope.data).toHaveLength(1)
      expect(paginatedEnvelope.meta.totalPages).toBe(3)
    })

    it('creates cursor-based pagination metadata and envelope', () => {
      const cursorMeta = createCursorPaginationMeta({
        cursor: 'encoded-cursor-abc',
        nextCursor: 'encoded-cursor-def',
        hasMore: true,
        limit: 20,
        requestId: 'req-cursor-1',
      })

      expect(cursorMeta).toEqual({
        cursor: 'encoded-cursor-abc',
        nextCursor: 'encoded-cursor-def',
        hasMore: true,
        limit: 20,
        requestId: 'req-cursor-1',
        timestamp: expect.any(String),
        version: 'v1',
      })

      const cursorEnvelope = createCursorPaginatedEnvelope(
        [{ logId: 'log-1' }],
        cursorMeta
      )
      expect(cursorEnvelope.success).toBe(true)
      expect(cursorEnvelope.meta.hasMore).toBe(true)
    })
  })

  describe('2. Deterministic Pagination Rules & Schema Validation', () => {
    it('applies default page pagination bounds', () => {
      const parsed = pagePaginationSchema.parse({})
      expect(parsed.page).toBe(1)
      expect(parsed.limit).toBe(20)
      expect(parsed.sortOrder).toBe(SortOrder.DESC)
    })

    it('rejects invalid limit exceeding maximum 100', () => {
      const result = pagePaginationSchema.safeParse({ limit: 500 })
      expect(result.success).toBe(false)
    })

    it('parses valid cursor pagination query parameters', () => {
      const parsed = cursorPaginationSchema.parse({
        cursor: 'xyz-123',
        limit: 50,
        sortOrder: 'asc',
      })

      expect(parsed.cursor).toBe('xyz-123')
      expect(parsed.limit).toBe(50)
      expect(parsed.sortOrder).toBe(SortOrder.ASC)
    })
  })

  describe('3. Serialization Rules (ISO Dates, Asset Amounts, UUIDs)', () => {
    it('validates ISO 8601 UTC date strings', () => {
      expect(isoDateSchema.safeParse('2026-07-25T14:00:00.000Z').success).toBe(
        true
      )
      expect(isoDateSchema.safeParse('2026-07-25 14:00:00').success).toBe(
        false
      )
    })

    it('validates exact financial and token asset amounts', () => {
      const validAsset = assetAmountSchema.parse({
        amount: '1000.5000000',
        assetCode: 'XLM',
        issuer: null,
      })

      expect(validAsset.amount).toBe('1000.5000000')
      expect(validAsset.assetCode).toBe('XLM')

      const invalidAsset = assetAmountSchema.safeParse({
        amount: 'not-a-number',
        assetCode: 'XLM',
      })
      expect(invalidAsset.success).toBe(false)
    })

    it('validates lowercase UUID v4 primary keys', () => {
      const validUuid = '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d'
      expect(uuidSchema.safeParse(validUuid).success).toBe(true)
      expect(uuidSchema.safeParse('invalid-uuid').success).toBe(false)
    })
  })

  describe('4. Error Envelopes & Stable Code Guarantees', () => {
    it('formats BadRequestError with stable code BAD_REQUEST without stack leakage in production', () => {
      const error = new BadRequestError('Invalid token parameter')
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(statusMock).toHaveBeenCalledWith(400)
      const body = jsonMock.mock.calls[0][0]
      expect(body).toEqual({
        success: false,
        error: {
          code: ErrorCode.BAD_REQUEST,
          message: 'Invalid token parameter',
        },
        requestId: 'test-request-id-12345',
        timestamp: expect.any(String),
      })
      expect(body.error.stack).toBeUndefined()
    })

    it('formats NotFoundError with stable code RESOURCE_NOT_FOUND', () => {
      const error = new NotFoundError('User not found')
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(statusMock).toHaveBeenCalledWith(404)
      const body = jsonMock.mock.calls[0][0]
      expect(body.error.code).toBe(ErrorCode.RESOURCE_NOT_FOUND)
    })

    it('formats ValidationError with stable code VALIDATION_ERROR and details map', () => {
      const error = new ValidationError('Invalid request body', {
        email: ['Invalid email format'],
      })
      errorHandler(
        error,
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(statusMock).toHaveBeenCalledWith(422)
      const body = jsonMock.mock.calls[0][0]
      expect(body.error.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(body.error.details).toEqual({ email: ['Invalid email format'] })
    })
  })

  describe('5. Unknown Field Behavior & Strict Middleware Validation', () => {
    it('strips unknown fields by default in body schema parsing', () => {
      const schema = createStrictSchema({
        name: uuidSchema,
      })

      const result = schema.safeParse({
        name: '9b1deb4d-3b7d-4bad-9bdd-2b0d7b3dcb6d',
        unknownField: 'should cause failure in strict mode',
      })

      expect(result.success).toBe(false)
    })

    it('middleware returns 400 validation error envelope when validation fails', () => {
      const middleware = validate({
        body: createStrictSchema({ email: isoDateSchema }),
      })

      mockRequest.body = { email: 'invalid-date' }

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(statusMock).toHaveBeenCalledWith(400)
      const res = jsonMock.mock.calls[0][0]
      expect(res.success).toBe(false)
      expect(res.error.code).toBe(ErrorCode.VALIDATION_ERROR)
      expect(res.error.details).toHaveProperty('body')
    })
  })

  describe('6. Versioning Middleware & Deprecation Policies', () => {
    it('sets X-API-Version header to v1', () => {
      apiVersionHeader(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(setHeaderMock).toHaveBeenCalledWith('X-API-Version', 'v1')
      expect(mockNext).toHaveBeenCalled()
    })

    it('sets RFC 8594 deprecation and sunset headers', () => {
      setDeprecationHeaders(mockResponse as Response, {
        sunsetDate: 'Sun, 31 Dec 2026 23:59:59 GMT',
        docUrl: 'https://api.learnault.com/docs/deprecations#v1-feature',
      })

      expect(setHeaderMock).toHaveBeenCalledWith('Deprecation', 'true')
      expect(setHeaderMock).toHaveBeenCalledWith(
        'Sunset',
        'Sun, 31 Dec 2026 23:59:59 GMT'
      )
      expect(setHeaderMock).toHaveBeenCalledWith(
        'Link',
        '<https://api.learnault.com/docs/deprecations#v1-feature>; rel="sunset"'
      )
    })

    it('deprecatedEndpoint middleware applies headers and proceeds to next', () => {
      const middleware = deprecatedEndpoint({
        sunsetDate: 'Sun, 31 Dec 2026 23:59:59 GMT',
      })

      middleware(
        mockRequest as Request,
        mockResponse as Response,
        mockNext
      )

      expect(setHeaderMock).toHaveBeenCalledWith('Deprecation', 'true')
      expect(setHeaderMock).toHaveBeenCalledWith(
        'Sunset',
        'Sun, 31 Dec 2026 23:59:59 GMT'
      )
      expect(mockNext).toHaveBeenCalled()
    })
  })
})
