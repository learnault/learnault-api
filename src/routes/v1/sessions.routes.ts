import { Router } from 'express'
import { SessionController } from '../../controllers/session.controller'
import { authenticate, requireActiveAccount } from '../../middleware/auth.middleware'

const router: Router = Router()
const sessionController = new SessionController()

// All session endpoints require a valid, active-account JWT.
router.use(authenticate, requireActiveAccount)

/**
 * @route GET /api/v1/sessions
 * @desc List the authenticated user's active sessions (paginated)
 * @access Private (active accounts only)
 */
router.get(
  '/',
  sessionController.listSessions.bind(sessionController)
)

/**
 * @route DELETE /api/v1/sessions
 * @desc Revoke all other active sessions (keep current session)
 * @access Private (active accounts only)
 */
router.delete(
  '/',
  sessionController.revokeAllOtherSessions.bind(sessionController)
)

/**
 * @route DELETE /api/v1/sessions/:sessionId
 * @desc Revoke a specific session by ID
 * @access Private (active accounts only)
 */
router.delete(
  '/:sessionId',
  sessionController.revokeSession.bind(sessionController)
)

export default router
