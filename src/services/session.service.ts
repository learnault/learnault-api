import prisma from '../config/database'
import { auditService } from './audit.service'
import {
  SessionAuditAction,
  SessionView,
  RevokeOneResult,
  RevokeAllResult,
} from '../types/session.types'
import type { AuditEntry } from '../types/account.types'

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Redact a raw IP address to its network prefix so it cannot be used to
 * individually identify the learner's home address.
 *
 *  • IPv4: keep first three octets → "1.2.3.*"
 *  • IPv6: keep first four groups  → "2001:db8:85a3:0:*"
 *  • Falls back to null for unparseable values.
 */
export function redactIp(raw: string | null | undefined): string | null {
  if (!raw) return null

  // IPv4
  const v4 = raw.match(/^(\d{1,3}\.\d{1,3}\.\d{1,3})\.\d{1,3}$/)
  if (v4) return `${v4[1]}.*`

  // IPv6 (simplified: split on ':')
  const v6Parts = raw.split(':')
  if (v6Parts.length >= 4) {
    return `${v6Parts.slice(0, 4).join(':')}:*`
  }

  return null
}

/**
 * Truncate a fingerprint to its first 8 hex characters so it can be used
 * as a device-change signal without leaking the full device fingerprint.
 */
export function redactFingerprint(
  raw: string | null | undefined,
): string | null {
  if (!raw) return null

  return raw.slice(0, 8)
}

/**
 * Map a raw Prisma Session row to the public SessionView DTO.
 * Tokens and raw IPs are never included in the output.
 */
export function toSessionView(
  session: {
    id: string
    deviceName: string | null
    browser: string | null
    os: string | null
    country: string | null
    city: string | null
    createdAt: Date
    lastUsedAt: Date | null
    expiresAt: Date
  },
  currentSessionId: string | null,
): SessionView {
  return {
    id: session.id,
    deviceName: session.deviceName,
    browser: session.browser,
    os: session.os,
    country: session.country,
    city: session.city,
    createdAt: session.createdAt.toISOString(),
    lastUsedAt: session.lastUsedAt ? session.lastUsedAt.toISOString() : null,
    expiresAt: session.expiresAt.toISOString(),
    isCurrent: session.id === currentSessionId,
  }
}

// ── SessionService ────────────────────────────────────────────────────────

export class SessionService {
  /**
   * Return a paginated list of active (non-revoked, non-expired) sessions for
   * the given user. The current session is identified by `currentSessionId` and
   * flagged in the response — it is always included regardless of page position.
   *
   * Sessions are ordered: current first, then most-recently-used descending.
   */
  async list(
    userId: string,
    currentSessionId: string | null,
    page: number,
    limit: number,
  ): Promise<{ sessions: SessionView[]; total: number }> {
    const now = new Date()
    const skip = (page - 1) * limit

    const [rows, total] = (await prisma.$transaction([
      prisma.session.findMany({
        where: { userId, isRevoked: false, expiresAt: { gt: now } },
        orderBy: [
          // current session always sorts first
          { id: currentSessionId ? 'asc' : 'asc' },
          { lastUsedAt: 'desc' },
          { createdAt: 'desc' },
        ],
        skip,
        take: limit,
        select: {
          id: true,
          deviceName: true,
          browser: true,
          os: true,
          country: true,
          city: true,
          createdAt: true,
          lastUsedAt: true,
          expiresAt: true,
        },
      }),
      prisma.session.count({
        where: { userId, isRevoked: false, expiresAt: { gt: now } },
      }),
    ])) as [
      Array<{
        id: string
        deviceName: string | null
        browser: string | null
        os: string | null
        country: string | null
        city: string | null
        createdAt: Date
        lastUsedAt: Date | null
        expiresAt: Date
      }>,
      number,
    ]

    // Sort so current session bubbles to the top within the page result set
    const sorted = currentSessionId
      ? [
          ...rows.filter((s) => s.id === currentSessionId),
          ...rows.filter((s) => s.id !== currentSessionId),
        ]
      : rows

    return {
      sessions: sorted.map((s) => toSessionView(s, currentSessionId)),
      total,
    }
  }

  /**
   * Look up a single session by ID without any userId scoping.
   * Used internally — callers must verify ownership.
   */
  async getById(sessionId: string) {
    return prisma.session.findUnique({
      where: { id: sessionId },
      select: {
        id: true,
        userId: true,
        isRevoked: true,
        expiresAt: true,
      },
    })
  }

  /**
   * Revoke a single session owned by `userId`.
   *
   * Rules:
   *  • Returns `cross_user`    if the session belongs to another user.
   *  • Returns `not_found`     if the session doesn't exist or is already revoked/expired.
   *  • Returns `current_session` if the caller tries to revoke their own current session.
   *  • Returns `ok`            on success.
   */
  async revokeOne(
    userId: string,
    sessionId: string,
    currentSessionId: string | null,
    auditContext: Pick<AuditEntry, 'ipAddress' | 'userAgent'>,
  ): Promise<RevokeOneResult> {
    const session = await prisma.session.findUnique({
      where: { id: sessionId },
      select: { id: true, userId: true, isRevoked: true, expiresAt: true },
    })

    if (!session || session.isRevoked || session.expiresAt <= new Date()) {
      return { kind: 'not_found' }
    }

    if (session.userId !== userId) {
      return { kind: 'cross_user' }
    }

    if (session.id === currentSessionId) {
      return { kind: 'current_session' }
    }

    await prisma.$transaction([
      prisma.session.update({
        where: { id: sessionId },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
      auditService.op({
        userId,
        action: SessionAuditAction.SESSION_REVOKED,
        metadata: { revokedSessionId: sessionId },
        ...auditContext,
      }),
    ])

    return { kind: 'ok' }
  }

  /**
   * Revoke all active sessions for `userId` except the current one.
   * Returns the count of sessions that were revoked.
   */
  async revokeAll(
    userId: string,
    currentSessionId: string | null,
    auditContext: Pick<AuditEntry, 'ipAddress' | 'userAgent'>,
  ): Promise<RevokeAllResult> {
    const now = new Date()

    // Build exclusion list — always exclude the current session
    const excludeIds: string[] = currentSessionId ? [currentSessionId] : []

    const { count } = await prisma.session.updateMany({
      where: {
        userId,
        isRevoked: false,
        expiresAt: { gt: now },
        NOT: excludeIds.length ? { id: { in: excludeIds } } : undefined,
      },
      data: { isRevoked: true, revokedAt: now },
    })

    if (count > 0) {
      await auditService.record({
        userId,
        action: SessionAuditAction.SESSION_ALL_REVOKED,
        metadata: {
          revokedCount: count,
          keptCurrentSession: !!currentSessionId,
        },
        ...auditContext,
      })
    }

    return { kind: 'ok', revokedCount: count }
  }
}

export const sessionService = new SessionService()
