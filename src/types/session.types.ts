// ── Session domain types ───────────────────────────────────────────────────

/**
 * A single redacted session as returned by the API.
 * Raw tokens and full IP addresses are never included.
 */
export interface SessionView {
  /** Session ID (UUID). */
  id: string
  /** Device display name, e.g. "iPhone 14" or "Unknown Device". */
  deviceName: string | null
  /** Browser label, e.g. "Chrome 124" or null. */
  browser: string | null
  /** Operating system label, e.g. "macOS 14.4" or null. */
  os: string | null
  /** Approximate country from IP geo-lookup, e.g. "NG". */
  country: string | null
  /** Approximate city from IP geo-lookup, e.g. "Lagos". */
  city: string | null
  /** ISO timestamp when the session was created (first login). */
  createdAt: string
  /** ISO timestamp when the session last consumed a refresh token, or null. */
  lastUsedAt: string | null
  /** ISO timestamp when the session expires. */
  expiresAt: string
  /** Whether this session belongs to the current request's access token. */
  isCurrent: boolean
}

/**
 * Paginated response for GET /v1/sessions.
 */
export interface SessionListResponse {
  sessions: SessionView[]
  pagination: {
    page: number
    limit: number
    total: number
    totalPages: number
    hasNext: boolean
    hasPrev: boolean
  }
}

/**
 * Result returned from session revocation operations.
 */
export type RevokeOneResult =
  | { kind: 'ok' }
  | { kind: 'not_found' }
  | { kind: 'cross_user' }
  | { kind: 'current_session' }

export type RevokeAllResult = {
  kind: 'ok'
  revokedCount: number
}

// ── Audit action constants ────────────────────────────────────────────────

export const SessionAuditAction = {
  SESSION_REVOKED: 'SESSION_REVOKED',
  SESSION_ALL_REVOKED: 'SESSION_ALL_REVOKED',
  SESSION_LOGGED_OUT: 'SESSION_LOGGED_OUT',
  SESSION_ALL_LOGGED_OUT: 'SESSION_ALL_LOGGED_OUT',
  REFRESH_REUSE_DETECTED: 'REFRESH_REUSE_DETECTED',
} as const

export type SessionAuditActionValue =
  (typeof SessionAuditAction)[keyof typeof SessionAuditAction]
