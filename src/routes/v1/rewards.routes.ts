import { Router } from 'express'
import { RewardController } from '../../controllers/reward.controller'
import { authenticate } from '../../middleware/auth.middleware'

const router = Router()
const rewardController = new RewardController()

/**
 * @route   GET /api/v1/rewards/balance
 * @desc    Get current user's reward balance
 * @access  Private (requires authentication)
 */
router.get(
  '/balance',
  authenticate,
  rewardController.getBalance.bind(rewardController),
)

/**
 * @route   GET /api/v1/rewards/history
 * @desc    Get transaction history with filtering and pagination
 * @query   type - Filter by transaction type (module_reward, streak_bonus, referral_reward, withdrawal)
 * @query   status - Filter by transaction status (pending, completed, failed)
 * @query   fromDate - Filter transactions from this date (ISO 8601)
 * @query   toDate - Filter transactions to this date (ISO 8601)
 * @query   limit - Number of results per page (default: 20, max: 100)
 * @query   offset - Pagination offset (default: 0)
 * @access  Private (requires authentication)
 */
router.get(
  '/history',
  authenticate,
  rewardController.getHistory.bind(rewardController),
)

/**
 * @route   POST /api/v1/rewards/withdraw
 * @desc    Process a withdrawal request
 * @body    walletAddress - Stellar wallet address (required)
 * @body    amount - Amount to withdraw in XLM (required)
 * @body    memo - Optional memo for the transaction
 * @access  Private (requires authentication)
 */
router.post(
  '/withdraw',
  authenticate,
  rewardController.withdraw.bind(rewardController),
)

export default router
