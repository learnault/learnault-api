import { Router } from 'express';
import { RewardController } from '../../controllers/reward.controller';
import { authenticate } from '../../middleware/auth.middleware';

const router = Router();
const rewardController = new RewardController();

/**
 * @openapi
 * tags:
 *   name: Rewards
 *   description: Learning rewards and token balance
 */

/**
 * @openapi
 * /v1/rewards/balance:
 *   get:
 *     summary: Get current user balance
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: Reward balance
 *         content:
 *           application/json:
 *             schema:
 *               $ref: '#/components/schemas/Balance'
 */
router.get('/balance', authenticate, rewardController.getBalance.bind(rewardController));

/**
 * @openapi
 * /v1/rewards/transactions:
 *   get:
 *     summary: Get reward transaction history
 *     tags: [Rewards]
 *     security:
 *       - bearerAuth: []
 *     responses:
 *       200:
 *         description: List of transactions
 *         content:
 *           application/json:
 *             schema:
 *               type: array
 *               items:
 *                 $ref: '#/components/schemas/Transaction'
 */
router.get('/transactions', authenticate, rewardController.getTransactions.bind(rewardController));

export default router;
