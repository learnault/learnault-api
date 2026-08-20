import { z } from 'zod'

// ── Query parameter schemas ───────────────────────────────────────────────

/**
 * Pagination query parameters for GET /v1/sessions.
 */
export const sessionListQuerySchema = z.object({
  page: z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : 1))
    .pipe(z.number().int().min(1, 'page must be >= 1')),
  limit: z
    .string()
    .optional()
    .transform(v => (v ? parseInt(v, 10) : 20))
    .pipe(z.number().int().min(1).max(100, 'limit must be <= 100')),
})

export type SessionListQuery = z.infer<typeof sessionListQuerySchema>

// ── Path parameter schemas ────────────────────────────────────────────────

/**
 * Path parameter for session-specific operations (:sessionId).
 */
export const sessionIdParamSchema = z.object({
  sessionId: z.string().uuid('sessionId must be a valid UUID'),
})

export type SessionIdParam = z.infer<typeof sessionIdParamSchema>
