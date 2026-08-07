import { z, ZodRawShape } from 'zod'
import {
  SortOrder,
  PaginationMeta,
  CursorPaginationMeta,
  ApiResponse,
  PaginatedResponse,
  CursorPaginatedResponse,
  RequestMetadata,
} from '../types/api.types'

// ── Reusable Field Schemas ──────────────────────────────────────

export const uuidSchema = z.string().uuid('Invalid UUID format')

export const isoDateSchema = z
  .string()
  .datetime('Invalid ISO 8601 UTC date string format')

export const sortOrderSchema = z
  .nativeEnum(SortOrder)
  .default(SortOrder.DESC)

export const assetAmountSchema = z.object({
  amount: z
    .string()
    .regex(/^\d+(\.\d+)?$/, 'Amount must be a numeric decimal or integer string'),
  assetCode: z.string().min(1, 'Asset code is required'),
  issuer: z.string().nullable().optional(),
})

// ── Pagination Schemas ──────────────────────────────────────────

export const pagePaginationSchema = z.object({
  page: z.coerce.number().int().min(1, 'Page must be at least 1').default(1),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  sortBy: z.string().optional(),
  sortOrder: sortOrderSchema,
})

export const cursorPaginationSchema = z.object({
  cursor: z.string().optional(),
  limit: z.coerce
    .number()
    .int()
    .min(1, 'Limit must be at least 1')
    .max(100, 'Limit cannot exceed 100')
    .default(20),
  sortBy: z.string().optional(),
  sortOrder: sortOrderSchema,
})

// ── Schema Builders ─────────────────────────────────────────────

export const createPaginatedQuerySchema = (customFields?: ZodRawShape) => {
  return pagePaginationSchema.extend(customFields || {})
}

export const createCursorPaginatedQuerySchema = (customFields?: ZodRawShape) => {
  return cursorPaginationSchema.extend(customFields || {})
}

export const createStrictSchema = (shape: ZodRawShape) => {
  return z.object(shape).strict()
}

// ── Envelope Constructor Helpers ────────────────────────────────

export const createPaginationMeta = ({
  page,
  limit,
  total,
  requestId,
  timestamp,
  version = 'v1',
}: {
  page: number
  limit: number
  total: number
  requestId?: string
  timestamp?: string
  version?: string
}): PaginationMeta => {
  const totalPages = Math.ceil(total / limit) || 0
  
return {
    page,
    limit,
    total,
    totalPages,
    hasNextPage: page < totalPages,
    hasPrevPage: page > 1,
    requestId,
    timestamp: timestamp || new Date().toISOString(),
    version,
  }
}

export const createCursorPaginationMeta = ({
  cursor,
  nextCursor,
  hasMore,
  limit,
  requestId,
  timestamp,
  version = 'v1',
}: {
  cursor?: string
  nextCursor: string | null
  hasMore: boolean
  limit: number
  requestId?: string
  timestamp?: string
  version?: string
}): CursorPaginationMeta => {
  return {
    cursor,
    nextCursor,
    hasMore,
    limit,
    requestId,
    timestamp: timestamp || new Date().toISOString(),
    version,
  }
}

export const createSuccessEnvelope = <T>(
  data: T,
  message?: string,
  meta?: Partial<RequestMetadata>
): ApiResponse<T> => {
  const now = new Date().toISOString()
  
return {
    success: true,
    data,
    message,
    meta: {
      requestId: meta?.requestId || 'unknown',
      timestamp: meta?.timestamp || now,
      version: meta?.version || 'v1',
    },
    timestamp: meta?.timestamp || now,
  }
}

export const createPaginatedEnvelope = <T>(
  data: T[],
  meta: PaginationMeta,
  message?: string
): PaginatedResponse<T> => {
  return {
    success: true,
    data,
    meta,
    message,
    timestamp: meta.timestamp || new Date().toISOString(),
  }
}

export const createCursorPaginatedEnvelope = <T>(
  data: T[],
  meta: CursorPaginationMeta,
  message?: string
): CursorPaginatedResponse<T> => {
  return {
    success: true,
    data,
    meta,
    message,
    timestamp: meta.timestamp || new Date().toISOString(),
  }
}
