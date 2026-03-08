import { Request, Response } from 'express'
import { RewardService } from '../services/reward.service'
import { asyncHandler } from '../middleware/error.middleware'
import { BadRequestError } from '../utils/errors'

export class RewardController {
  private rewardService: RewardService

  constructor() {
    this.rewardService = new RewardService()
  }

  /**
   * GET /rewards/balance
   * Retrieve the current user's reward balance
   */
  getBalance = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const balance = this.rewardService.getBalance(userId)

      res.json({
        success: true,
        data: {
          balance: {
            available: balance.available,
            pending: balance.pending,
            lifetime: balance.lifetime,
          },
          updatedAt: balance.updatedAt.toISOString(),
        },
      })
    },
  )

  /**
   * GET /rewards/history
   * Retrieve transaction history with optional filtering and pagination
   * Query params: type, status, fromDate, toDate, limit, offset
   */
  getHistory = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      // Parse query parameters
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
            amount: t.amount,
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
   * POST /rewards/withdraw
   * Process a withdrawal request
   * Body: walletAddress, amount, memo (optional)
   */
  withdraw = asyncHandler(
    async (req: Request, res: Response): Promise<void> => {
      const userId = (req as any).user.id

      if (!userId) {
        throw new UnauthorizedError('User ID not found')
      }

      const { walletAddress, amount, memo } = req.body

      // Validate required fields
      if (!walletAddress) {
        throw new BadRequestError('Wallet address is required')
      }

      if (amount === undefined || amount === null) {
        throw new BadRequestError('Amount is required')
      }

      // Validate amount
      if (typeof amount !== 'number' || isNaN(amount)) {
        throw new BadRequestError('Amount must be a valid number')
      }

      if (amount <= 0) {
        throw new BadRequestError('Amount must be greater than 0')
      }

      // Validate Stellar wallet address format
      if (!this.isValidStellarAddress(walletAddress)) {
        throw new BadRequestError('Invalid Stellar wallet address format')
      }

      // Check if user has sufficient balance
      if (!this.rewardService.hasSufficientBalance(userId, amount)) {
        const balance = this.rewardService.getBalance(userId)
        throw new BadRequestError(
          `Insufficient balance. Available: ${balance.available} XLM, Requested: ${amount} XLM`,
        )
      }

      // Process withdrawal
      const result = await this.rewardService.processWithdrawal({
        userId,
        walletAddress,
        amount,
        memo,
      })

      res.status(201).json({
        success: true,
        message: 'Withdrawal processed successfully',
        data: {
          transactionId: result.transactionId,
          amount: result.amount,
          stellarTxHash: result.stellarTxHash,
          status: result.status,
          requestedAt: result.requestedAt.toISOString(),
          completedAt: result.completedAt?.toISOString(),
        },
      })
    },
  )

  /**
   * Validate Stellar wallet address format
   */
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
