import { Request, Response } from 'express'
import { RewardService } from '../services/reward.service'
import { asyncHandler } from '../middleware/error.middleware'
import { BadRequestError } from '../utils/errors'
import { stroopsToXlmString, xlmStringToStroops } from '../utils/money'

export class RewardController {
  private rewardService: RewardService

  constructor() {
    this.rewardService = new RewardService()
  }

  /**
   * @openapi
   * /rewards/balance:
   *   get:
   *     operationId: rewardsGetBalance
   *     summary: Get the authenticated user's reward balance
   *     tags: [Rewards]
   *     security:
   *       - bearerAuth: []
   *     responses:
   *       200:
   *         description: Reward balance retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/RewardBalance'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  getBalance = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const balance = this.rewardService.getBalance(userId)

      res.json({
        success: true,
        data: {
          balance: {
            // Serialize BigInt stroops → 7-decimal XLM strings at the API boundary.
            // Never return raw BigInt or JavaScript number for monetary values.
            available: stroopsToXlmString(balance.availableStroops),
            pending: stroopsToXlmString(balance.pendingStroops),
            lifetime: stroopsToXlmString(balance.lifetimeStroops),
          },
          updatedAt: balance.updatedAt.toISOString(),
        },
      })
    },
  )

  /**
   * @openapi
   * /rewards/history:
   *   get:
   *     operationId: rewardsGetHistory
   *     summary: Get the authenticated user's transaction history
   *     tags: [Rewards]
   *     security:
   *       - bearerAuth: []
   *     parameters:
   *       - in: query
   *         name: type
   *         schema:
   *           type: string
   *           enum: [module_reward, streak_bonus, referral_reward, withdrawal]
   *       - in: query
   *         name: status
   *         schema:
   *           type: string
   *           enum: [pending, completed, failed]
   *       - in: query
   *         name: fromDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: toDate
   *         schema:
   *           type: string
   *           format: date-time
   *       - in: query
   *         name: limit
   *         schema:
   *           type: integer
   *           default: 20
   *           maximum: 100
   *       - in: query
   *         name: offset
   *         schema:
   *           type: integer
   *           default: 0
   *           minimum: 0
   *     responses:
   *       200:
   *         description: Transaction history retrieved successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/TransactionHistory'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  getHistory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const filters: any = {}

      if (req.query.type) {
        const validTypes = [
          'module_reward',
          'streak_bonus',
          'referral_reward',
          'withdrawal',
        ]
        if (!validTypes.includes(req.query.type as string)) {
          throw new BadRequestError('Invalid transaction type')
        }
        filters.type = req.query.type
      }

      if (req.query.status) {
        const validStatuses = ['pending', 'completed', 'failed']
        if (!validStatuses.includes(req.query.status as string)) {
          throw new BadRequestError('Invalid transaction status')
        }
        filters.status = req.query.status
      }

      if (req.query.fromDate) {
        const date = new Date(req.query.fromDate as string)
        if (isNaN(date.getTime())) {
          throw new BadRequestError(
            'Invalid fromDate format. Use ISO 8601 format',
          )
        }
        filters.fromDate = date
      }

      if (req.query.toDate) {
        const date = new Date(req.query.toDate as string)
        if (isNaN(date.getTime())) {
          throw new BadRequestError(
            'Invalid toDate format. Use ISO 8601 format',
          )
        }
        filters.toDate = date
      }

      if (req.query.limit) {
        const limit = parseInt(req.query.limit as string, 10)
        if (isNaN(limit) || limit < 1 || limit > 100) {
          throw new BadRequestError('Limit must be between 1 and 100')
        }
        filters.limit = limit
      }

      if (req.query.offset) {
        const offset = parseInt(req.query.offset as string, 10)
        if (isNaN(offset) || offset < 0) {
          throw new BadRequestError('Offset must be a non-negative number')
        }
        filters.offset = offset
      }

      const history = this.rewardService.getTransactionHistory(userId, filters)

      res.json({
        success: true,
        data: {
          transactions: history.transactions.map((t) => ({
            id: t.id,
            type: t.type,
            status: t.status,
            // Serialize BigInt stroops → XLM string at the API boundary
            amount: stroopsToXlmString(t.amountStroops),
            moduleId: t.moduleId,
            stellarTxHash: t.stellarTxHash,
            createdAt: t.createdAt.toISOString(),
            completedAt: t.completedAt?.toISOString(),
          })),
          pagination: {
            total: history.total,
            limit: filters.limit ?? 20,
            offset: filters.offset ?? 0,
            hasMore: history.hasMore,
          },
        },
      })
    },
  )

  /**
   * @openapi
   * /rewards/withdraw:
   *   post:
   *     operationId: rewardsWithdraw
   *     summary: Submit a withdrawal request
   *     description: >
   *       Validates the Stellar wallet address (pattern `^G[A-Z0-9]{50,55}$`),
   *       parses `amount` as a 7-decimal XLM string, converts to exact stroops,
   *       and verifies sufficient balance before processing.
   *     tags: [Rewards]
   *     security:
   *       - bearerAuth: []
   *     requestBody:
   *       required: true
   *       content:
   *         application/json:
   *           schema:
   *             $ref: '#/components/schemas/WithdrawalInput'
   *     responses:
   *       201:
   *         description: Withdrawal processed successfully
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/WithdrawalResponse'
   *       400:
   *         description: Invalid input or insufficient balance
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   *       401:
   *         description: Unauthorized
   *         content:
   *           application/json:
   *             schema:
   *               $ref: '#/components/schemas/ErrorResponse'
   */
  withdraw = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user?.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const { walletAddress, amount, memo } = req.body

      if (!walletAddress) {
        throw new BadRequestError('Wallet address is required')
      }

      if (amount === undefined || amount === null) {
        throw new BadRequestError('Amount is required')
      }

      // Amount must be a string to avoid floating-point coercion.
      // Accept both string and number literals from JSON bodies (client sends "5.5" or 5.5).
      const amountString =
        typeof amount === 'string'
          ? amount
          : typeof amount === 'number'
            ? amount.toFixed(7)
            : null

      if (!amountString) {
        throw new BadRequestError('Amount must be a numeric string (e.g. "5.0000000")')
      }

      // Parse the XLM string into exact stroops — throws MoneyError on bad format
      let amountStroops: bigint
      try {
        amountStroops = xlmStringToStroops(amountString)
      } catch {
        throw new BadRequestError(
          'Invalid amount: must be a decimal with at most 7 fractional digits (e.g. "5.0000000")',
        )
      }

      if (amountStroops <= 0n) {
        throw new BadRequestError('Amount must be greater than 0')
      }

      if (!this.isValidStellarAddress(walletAddress)) {
        throw new BadRequestError('Invalid Stellar wallet address format')
      }

      if (!this.rewardService.hasSufficientBalance(userId, amountStroops)) {
        const balance = this.rewardService.getBalance(userId)
        throw new BadRequestError(
          `Insufficient balance. Available: ${stroopsToXlmString(balance.availableStroops)} XLM, ` +
            `Requested: ${stroopsToXlmString(amountStroops)} XLM`,
        )
      }

      const result = await this.rewardService.processWithdrawal({
        userId,
        walletAddress,
        amountStroops,
        memo,
      })

      res.status(201).json({
        success: true,
        message: 'Withdrawal processed successfully',
        data: {
          transactionId: result.transactionId,
          // Serialize BigInt stroops → XLM string at the API boundary
          amount: stroopsToXlmString(result.amountStroops),
          stellarTxHash: result.stellarTxHash,
          status: result.status,
          requestedAt: result.requestedAt.toISOString(),
          completedAt: result.completedAt?.toISOString(),
        },
      })
    },
  )

  private isValidStellarAddress(address: string): boolean {
    return /^G[A-Z0-9]{50,55}$/.test(address)
  }
}

// Custom error for unauthorized access
class UnauthorizedError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'UnauthorizedError'
  }
}
