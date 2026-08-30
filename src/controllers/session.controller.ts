import { Request, Response } from 'express'
import { sessionService } from '../services/session.service'
import {
  sessionListQuerySchema,
  sessionIdParamSchema,
} from '../schemas/session.schema'
import logger from '../utils/logger'

// ── Helpers ───────────────────────────────────────────────────────────────

/**
 * Derive the current session ID from the Authorization header.
 *
 * The access-token JWT does not carry a session ID, so we look up the session
 * by matching the raw Bearer token against `sessions.token`. This is a
 * best-effort lookup — if no matching row is found (e.g. stateless tokens) the
 * function returns null and the isCurrent marker is simply omitted for all rows.
 */
async function resolveCurrentSessionId(req: Request): Promise<string | null> {
  const authHeader = req.headers.authorization
  if (!authHeader || !authHeader.startsWith('Bearer ')) return null

  const rawToken = authHeader.slice(7)

  try {
    const { default: prisma } = await import('../config/database')
    const session = await prisma.session.findUnique({
      where: { token: rawToken },
      select: { id: true, userId: true, isRevoked: true },
    })

    if (!session || session.isRevoked || session.userId !== req.user?.id)
      return null

    return session.id
  } catch {
    return null
  }
}

function context(req: Request) {
  return {
    ipAddress: req.ip,
    userAgent: req.headers['user-agent'],
  }
}

// ── Controller ────────────────────────────────────────────────────────────

export class SessionController {
  /**
   * @openapi
   * /v1/sessions:
   *   get:
   *     operationId: listSessions
   *     summary: List active sessions
   *     description: >
   *       Returns a paginated list of the authenticated user's active
   *       (non-revoked, non-expired) sessions. The current session is always
   *       included and flagged with `isCurrent: true`. Tokens and raw IP
   *       addresses are never returned.
   *     tags: [Sessions]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: page
   *         schema:
   *           type: integer
   *           minimum: 1
   *           default: 1
   *         description: Page number (1-based).
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           minimum: 1
   *           maximum: 100
   *           default: 20
   *         description: Number of sessions per page.
   *     responses:
   *       200:
   *         description: Paginated session list.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/SessionListResponse'
   *       400:
   *         description: Invalid query parameters.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Authentication required.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       403:
   *         description: Account is not active.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async listSessions(req: Request, res: Response): Promise<void> {
    try {
      const queryValidation = sessionListQuerySchema.safeParse(req.query)
      if (!queryValidation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: queryValidation.error.format(),
        })

        return
      }

      const { page, limit } = queryValidation.data
      const userId = req.user!.id
      const currentSessionId = await resolveCurrentSessionId(req)

      const { sessions, total } = await sessionService.list(
        userId,
        currentSessionId,
        page,
        limit,
      )

      const totalPages = Math.ceil(total / limit)

      res.status(200).json({
        sessions,
        pagination: {
          page,
          limit,
          total,
          totalPages,
          hasNext: page < totalPages,
          hasPrev: page > 1,
        },
      })
    } catch (error) {
      logger.error('[SessionController] listSessions error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /v1/sessions/{sessionId}:
   *   delete:
   *     operationId: revokeSession
   *     summary: Revoke a specific session
   *     description: >
   *       Immediately revokes the specified session so its refresh token can no
   *       longer be used. The caller cannot revoke their own current session
   *       (use POST /v1/auth/logout for that). Cross-user access is silently
   *       treated as not-found to avoid leaking session existence.
   *     tags: [Sessions]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: path
   *         name: sessionId
   *         required: true
   *         schema:
   *           type: string
   *           format: uuid
   *         description: ID of the session to revoke.
   *     responses:
   *       200:
   *         description: Session revoked successfully.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RevokeSessionResponse'
   *       400:
   *         description: Invalid sessionId format, or attempt to revoke the current session.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Authentication required.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       403:
   *         description: Account is not active.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       404:
   *         description: Session not found or already revoked.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async revokeSession(req: Request, res: Response): Promise<void> {
    try {
      const paramsValidation = sessionIdParamSchema.safeParse(req.params)
      if (!paramsValidation.success) {
        res.status(400).json({
          error: 'Validation failed',
          details: paramsValidation.error.format(),
        })

        return
      }

      const { sessionId } = paramsValidation.data
      const userId = req.user!.id
      const currentSessionId = await resolveCurrentSessionId(req)

      const result = await sessionService.revokeOne(
        userId,
        sessionId,
        currentSessionId,
        context(req),
      )

      switch (result.kind) {
        case 'ok':
          res.status(200).json({ message: 'Session revoked successfully' })

          return

        case 'current_session':
          res.status(400).json({
            error:
              'Cannot revoke your current session. Use POST /v1/auth/logout instead.',
            code: 'CURRENT_SESSION',
          })

          return

        // Cross-user is silently 404 — do not leak session existence
        case 'cross_user':
        case 'not_found':
          res.status(404).json({ error: 'Session not found' })

          return
      }
    } catch (error) {
      logger.error('[SessionController] revokeSession error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }

  /**
   * @openapi
   * /v1/sessions:
   *   delete:
   *     operationId: revokeAllOtherSessions
   *     summary: Revoke all other sessions
   *     description: >
   *       Revokes every active session for the authenticated user except the
   *       current one. This is equivalent to "log out all other devices".
   *       The current session remains valid.
   *     tags: [Sessions]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: All other sessions revoked.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RevokeAllSessionsResponse'
   *       401:
   *         description: Authentication required.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       403:
   *         description: Account is not active.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       500:
   *         description: Internal server error.
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  async revokeAllOtherSessions(req: Request, res: Response): Promise<void> {
    try {
      const userId = req.user!.id
      const currentSessionId = await resolveCurrentSessionId(req)

      const result = await sessionService.revokeAll(
        userId,
        currentSessionId,
        context(req),
      )

      res.status(200).json({
        message:
          result.revokedCount === 0
            ? 'No other active sessions to revoke'
            : `${result.revokedCount} session${result.revokedCount === 1 ? '' : 's'} revoked successfully`,
        revokedCount: result.revokedCount,
      })
    } catch (error) {
      logger.error('[SessionController] revokeAllOtherSessions error:', error)
      res.status(500).json({ error: 'Internal server error' })
    }
  }
}
