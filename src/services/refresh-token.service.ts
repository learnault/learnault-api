import crypto from 'crypto'
import prisma from '../config/database'
import { accessTokenTtlSeconds, issueAccessToken } from '../config/jwt'
import { env } from '../config/env'
import { auditService } from './audit.service'
import { SessionAuditAction } from '../types/session.types'

// ── Token helpers ─────────────────────────────────────────────────────────

const REFRESH_TOKEN_BYTES = 48 // → 64 base64url characters

/** Generate an opaque, unguessable refresh token (never persisted raw). */
export function generateOpaqueToken(): string {
  return crypto.randomBytes(REFRESH_TOKEN_BYTES).toString('base64url')
}

/** SHA-256 hash of a raw opaque token — the only form ever stored. */
export function hashToken(token: string): string {
  return crypto.createHash('sha256').update(token).digest('hex')
}

// ── Result types ──────────────────────────────────────────────────────────

export interface IssueSessionResult {
  sessionId: string
  accessToken: string
  refreshToken: string
  expiresIn: number
}

export type RotateResult =
  | { kind: 'ok'; accessToken: string; refreshToken: string; expiresIn: number }
  /** Unknown token — cannot be mapped to any session. */
  | { kind: 'invalid' }
  /** A previously-rotated token was presented again: the family was revoked. */
  | { kind: 'reuse' }
  /** Token or session was already revoked (or the session was logged out). */
  | { kind: 'revoked' }
  /** Token or session has passed its absolute expiry. */
  | { kind: 'expired' }

export interface RevokeResult {
  revokedCount: number
}

interface RefreshContext {
  ipAddress?: string
  userAgent?: string
}

interface RefreshTokenRow {
  id: string
  sessionId: string
  familyId: string
  status: string
  expiresAt: Date
  session: {
    id: string
    userId: string
    isRevoked: boolean
    expiresAt: Date
    user: { id: string; role: string }
  }
}

// ── Service ───────────────────────────────────────────────────────────────

export class RefreshTokenService {
  private readonly ttlMs = env.REFRESH_TOKEN_TTL_SECONDS * 1000

  /**
   * Create a new session and its first refresh token (a new rotation family).
   * Used by login/register/OTP-login. The access token is short-lived; the
   * opaque refresh token is returned exactly once and only its hash is stored.
   */
  async issueSession(params: {
    userId: string
    role: string
    userAgent?: string
    ipAddress?: string
  }): Promise<IssueSessionResult> {
    const accessToken = issueAccessToken({ id: params.userId, role: params.role })
    const refreshToken = generateOpaqueToken()
    const tokenHash = hashToken(refreshToken)
    const now = new Date()
    const expiresAt = new Date(now.getTime() + this.ttlMs)

    // Explicit ids let the session + token creation commit in a single
    // transaction array without an interactive-transaction round trip.
    const sessionId = crypto.randomUUID()
    const refreshTokenId = crypto.randomUUID()
    const familyId = crypto.randomUUID()

    await prisma.$transaction([
      prisma.session.create({
        data: {
          id: sessionId,
          userId: params.userId,
          token: accessToken,
          userAgent: params.userAgent ?? null,
          ipAddress: params.ipAddress ?? null,
          expiresAt,
        },
      }),
      prisma.refreshToken.create({
        data: {
          id: refreshTokenId,
          sessionId,
          familyId,
          tokenHash,
          status: 'ACTIVE',
          expiresAt,
        },
      }),
    ])

    return {
      sessionId,
      accessToken,
      refreshToken,
      expiresIn: accessTokenTtlSeconds,
    }
  }

  /**
   * Consume a refresh token and atomically rotate it.
   *
   * Rotation semantics:
   *  • ACTIVE + unexpired + live session  → consumed (ACTIVE→ROTATED) and a new
   *    ACTIVE token is minted in the same family; a fresh access token is issued.
   *  • ROTATED (already used once)         → reuse/theft: the whole family and
   *    its parent session are revoked.
   *  • REVOKED                             → family/session already revoked.
   *  • expired                             → no rotation; the token is dead.
   *
   * The ACTIVE→ROTATED transition uses a conditional `updateMany` so that
   * concurrent refreshes of the same token cannot both win — the loser is
   * treated exactly like a replay.
   */
  async rotate(rawToken: string, ctx: RefreshContext = {}): Promise<RotateResult> {
    const tokenHash = hashToken(rawToken)
    const found = (await prisma.refreshToken.findUnique({
      where: { tokenHash },
      include: {
        session: {
          select: {
            id: true,
            userId: true,
            isRevoked: true,
            expiresAt: true,
            user: { select: { id: true, role: true } },
          },
        },
      },
    })) as RefreshTokenRow | null

    if (!found) {
      return { kind: 'invalid' }
    }

    const now = new Date()

    // Replay signal: this token was already consumed by a previous rotation.
    if (found.status === 'ROTATED') {
      await this.revokeFamily(found.familyId, found.sessionId, found.session.userId, ctx)

      return { kind: 'reuse' }
    }

    if (found.status === 'REVOKED') {
      return { kind: 'revoked' }
    }

    if (found.expiresAt <= now) {
      return { kind: 'expired' }
    }

    if (found.session.isRevoked) {
      return { kind: 'revoked' }
    }

    if (found.session.expiresAt <= now) {
      return { kind: 'expired' }
    }

    // Atomic claim — only one concurrent refresh of this token wins.
    const claimed = await prisma.refreshToken.updateMany({
      where: { id: found.id, status: 'ACTIVE' },
      data: { status: 'ROTATED' },
    })

    if (claimed.count === 0) {
      // We lost the race: someone else rotated this token first → replay.
      await this.revokeFamily(found.familyId, found.sessionId, found.session.userId, ctx)

      return { kind: 'reuse' }
    }

    const accessToken = issueAccessToken({ id: found.session.userId, role: found.session.user.role })
    const refreshToken = generateOpaqueToken()
    const newTokenHash = hashToken(refreshToken)
    const newRefreshTokenId = crypto.randomUUID()
    const newExpiresAt = new Date(now.getTime() + this.ttlMs)

    await prisma.$transaction([
      prisma.refreshToken.create({
        data: {
          id: newRefreshTokenId,
          sessionId: found.sessionId,
          familyId: found.familyId,
          tokenHash: newTokenHash,
          status: 'ACTIVE',
          expiresAt: newExpiresAt,
        },
      }),
      prisma.session.update({
        where: { id: found.sessionId },
        data: { token: accessToken, lastUsedAt: now },
      }),
    ])

    return {
      kind: 'ok',
      accessToken,
      refreshToken,
      expiresIn: accessTokenTtlSeconds,
    }
  }

  /**
   * Revoke the single session identified by the given refresh token
   * (logout-current). Idempotent: unknown or already-revoked tokens are a
   * no-op rather than an error, so the endpoint does not leak token validity.
   */
  async revokeByRefreshToken(rawToken: string, ctx: RefreshContext = {}): Promise<RevokeResult> {
    const tokenHash = hashToken(rawToken)
    const found = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: {
        sessionId: true,
        familyId: true,
        session: { select: { userId: true } },
      },
    })

    if (!found) {
      return { revokedCount: 0 }
    }

    await this.revokeFamily(found.familyId, found.sessionId, found.session.userId, ctx, SessionAuditAction.SESSION_LOGGED_OUT)

    return { revokedCount: 1 }
  }

  /**
   * Revoke every session belonging to the user identified by the given
   * refresh token (logout-all). Idempotent and neutral on unknown tokens.
   */
  async revokeAllByRefreshToken(rawToken: string, ctx: RefreshContext = {}): Promise<RevokeResult> {
    const tokenHash = hashToken(rawToken)
    const found = await prisma.refreshToken.findUnique({
      where: { tokenHash },
      select: { session: { select: { userId: true } } },
    })

    if (!found) {
      return { revokedCount: 0 }
    }

    return this.revokeAllForUser(found.session.userId, ctx)
  }

  /** Revoke all sessions (and their refresh-token families) for a user. */
  async revokeAllForUser(userId: string, ctx: RefreshContext = {}): Promise<RevokeResult> {
    const now = new Date()

    const sessions = await prisma.session.findMany({
      where: { userId, isRevoked: false },
      select: { id: true },
    })
    const sessionIds = sessions.map(s => s.id)

    if (sessionIds.length === 0) {
      return { revokedCount: 0 }
    }

    await prisma.$transaction([
      prisma.session.updateMany({
        where: { id: { in: sessionIds }, isRevoked: false },
        data: { isRevoked: true, revokedAt: now },
      }),
      prisma.refreshToken.updateMany({
        where: { sessionId: { in: sessionIds }, status: { not: 'REVOKED' } },
        data: { status: 'REVOKED' },
      }),
      auditService.op({
        userId,
        action: SessionAuditAction.SESSION_ALL_LOGGED_OUT,
        metadata: { revokedCount: sessionIds.length },
        ...ctx,
      }),
    ])

    return { revokedCount: sessionIds.length }
  }

  /**
   * Revoke an entire rotation family and its parent session. This is the
   * single enforcement point for both reuse detection and logout-current.
   */
  private async revokeFamily(
    familyId: string,
    sessionId: string,
    userId: string,
    ctx: RefreshContext,
    action: string = SessionAuditAction.REFRESH_REUSE_DETECTED
  ): Promise<void> {
    await prisma.$transaction([
      prisma.refreshToken.updateMany({
        where: { familyId, status: { not: 'REVOKED' } },
        data: { status: 'REVOKED' },
      }),
      prisma.session.updateMany({
        where: { id: sessionId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
      auditService.op({
        userId,
        action,
        metadata: { familyId, sessionId },
        ...ctx,
      }),
    ])
  }
}

export const refreshTokenService = new RefreshTokenService()
