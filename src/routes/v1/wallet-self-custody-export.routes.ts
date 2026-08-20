import { Router } from 'express'
import type { WalletSelfCustodyExportController } from '../../controllers/wallet-self-custody-export.controller'
import {
  authenticate,
  requireActiveAccount,
} from '../../middleware/auth.middleware'
import { authLimiter } from '../../middleware/rate-limit.middleware'

/**
 * Route factory kept unmounted until #130 and #135 provide production session,
 * persistence, and KMS adapters. Mount at /api/v1/wallet after those land.
 */
export function createWalletSelfCustodyExportRoutes(
  controller: WalletSelfCustodyExportController,
): Router {
  const router = Router()
  router.post(
    '/self-custody/authorize',
    authenticate,
    requireActiveAccount,
    authLimiter,
    controller.authorize,
  )
  router.post(
    '/self-custody/export',
    authenticate,
    requireActiveAccount,
    authLimiter,
    controller.exportOnce,
  )

  return router
}
