import { Router } from 'express'
import { WalletStatusController } from '../../controllers/wallet-status.controller'
import { WalletStatusService } from '../../services/wallet-status.service'
import { PrismaWalletProvisioningRepository } from '../../services/wallet-provisioning.repository'
import { stellarService } from '../../services/stellar.service'
import {
  authenticate,
  requireActiveAccount,
} from '../../middleware/auth.middleware'
import prisma from '../../config/database'

const repository = new PrismaWalletProvisioningRepository(prisma)
const service = new WalletStatusService(repository, stellarService)
const controller = new WalletStatusController(service)

const router: Router = Router()

router.use(authenticate, requireActiveAccount)

/**
 * @route GET /api/v1/wallet/status
 * @desc Get the current user's wallet provisioning status, network, custody, and public address
 * @access Private (active accounts only)
 */
router.get('/status', controller.getStatus)

/**
 * @route GET /api/v1/wallet/balances
 * @desc Get the current user's exact on-chain balances (asset, issuer, amount, source time)
 * @access Private (active accounts only)
 */
router.get('/balances', controller.getBalances)

/**
 * @route GET /api/v1/wallet/history
 * @desc Get a stable, cursor-paginated payment history for the current user's wallet
 * @access Private (active accounts only)
 */
router.get('/history', controller.getHistory)

export default router
