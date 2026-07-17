import express, { Router } from 'express'
import { WalletController } from '../../controllers/wallet.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router: express.Router = Router()
const walletController = new WalletController()

router.get('/status', authenticate, walletController.getWalletStatus.bind(walletController))
router.get('/balances', authenticate, walletController.getWalletBalances.bind(walletController))
router.get('/history', authenticate, walletController.getWalletHistory.bind(walletController))

export default router
