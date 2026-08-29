import { Request } from 'express'
import { actorFromRequest, AuditContext } from '../audit'

/**
 * Build an {@link AuditContext} from an authenticated Express request.
 *
 * `actorFromRequest` reads `req.actor`, which the request-context middleware
 * populates — but that middleware runs before authentication (src/app.ts), so on
 * an authenticated route `req.actor` is still unset while `req.user` is not.
 * Falling back to `req.user` here is what keeps the actor attributable; without
 * it every user-initiated audit event would be recorded as ANONYMOUS, and
 * `auditedMutation` rejects a USER/ADMIN actor with no id.
 */
export function requestAuditContext(req: Request): AuditContext {
  return actorFromRequest({
    actor:
      req.actor ??
      (req.user ? { id: req.user.id, role: req.user.role } : undefined),
    requestId: req.requestId,
    ip: req.ip,
    headers: req.headers as unknown as Record<string, unknown>,
  })
}
