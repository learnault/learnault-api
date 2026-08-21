import { StellarService } from './stellar.service'
import { NotificationService } from './notification.service'
import {
  xlmToStroops,
  stroopsToXlmString,
  addStroops,
  multiplyStroops,
  clampStroops,
  STROOPS_PER_XLM,
} from '../utils/money'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleDifficulty =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert'

export interface Module {
  id: string
  difficulty: ModuleDifficulty
  /** Base reward for this module expressed in whole-integer stroops. */
  baseRewardStroops: bigint
  title: string
}

export interface RewardClaim {
  userId: string
  moduleId: string
  walletAddress: string
  streakDays?: number
  referralCode?: string
}

export interface RewardResult {
  transactionId: string
  userId: string
  moduleId: string
  /** All monetary amounts are in stroops (BigInt). */
  baseAmountStroops: bigint
  streakBonusStroops: bigint
  referralBonusStroops: bigint
  totalAmountStroops: bigint
  stellarTxHash: string
  claimedAt: Date
}

export interface Transaction {
  id: string
  userId: string
  moduleId?: string
  /** Amount in stroops (BigInt). */
  amountStroops: bigint
  type: 'module_reward' | 'streak_bonus' | 'referral_reward' | 'withdrawal'
  status: 'pending' | 'completed' | 'failed'
  stellarTxHash?: string
  createdAt: Date
  completedAt?: Date
}

// ─── Constants ────────────────────────────────────────────────────────────────

/**
 * Rational multipliers for each difficulty tier, expressed as [numerator, denominator]
 * so that all arithmetic stays in BigInt with no floating-point conversion.
 *
 *   beginner    → 1/1  = 1.0×
 *   intermediate → 3/2 = 1.5×
 *   advanced    → 2/1  = 2.0×
 *   expert      → 3/1  = 3.0×
 */
export const DIFFICULTY_MULTIPLIERS: Record<
  ModuleDifficulty,
  [bigint, bigint]
> = {
  beginner: [1n, 1n],
  intermediate: [3n, 2n],
  advanced: [2n, 1n],
  expert: [3n, 1n],
}

/** Default base reward for modules that don't specify one: 5 XLM. */
export const BASE_REWARD_STROOPS: bigint = xlmToStroops(5n)

/**
 * Streak bonus rate: 10% of base per streak day.
 * Represented as the rational 1/10.
 */
export const STREAK_BONUS_RATE_NUM = 1n
export const STREAK_BONUS_RATE_DEN = 10n

/** Maximum streak bonus: 100% of base (cap at 10 streak days). */
export const MAX_STREAK_BONUS_NUM = 1n
export const MAX_STREAK_BONUS_DEN = 1n

/** Flat referral bonus: 2 XLM. */
export const REFERRAL_BONUS_STROOPS: bigint = xlmToStroops(2n)

export interface WithdrawalRequest {
  userId: string
  walletAddress: string
  /** Amount to withdraw, in stroops. */
  amountStroops: bigint
  memo?: string
}

export interface WithdrawalResult {
  transactionId: string
  userId: string
  /** Amount withdrawn, in stroops. */
  amountStroops: bigint
  stellarTxHash: string
  status: 'pending' | 'completed' | 'failed'
  requestedAt: Date
  completedAt?: Date
}

export interface Balance {
  userId: string
  /** All amounts in stroops (BigInt). */
  availableStroops: bigint
  pendingStroops: bigint
  lifetimeStroops: bigint
  updatedAt: Date
}

export interface TransactionFilter {
  type?: Transaction['type']
  status?: Transaction['status']
  fromDate?: Date
  toDate?: Date
  limit?: number
  offset?: number
}

// ─── In-memory stores (replace with Prisma in production) ────────────────────

const claimedRewards = new Map<string, Set<string>>()
const transactions: Transaction[] = []
const referralCodes = new Map<string, string>() // code -> referrerId
const pendingWithdrawals = new Map<string, WithdrawalRequest>()

// ─── RewardService ────────────────────────────────────────────────────────────

export class RewardService {
  private stellarService: StellarService
  private notificationService: NotificationService

  constructor(stellarService?: StellarService) {
    this.stellarService = stellarService ?? new StellarService()
    this.notificationService = new NotificationService()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Calculate the reward breakdown for a module completion without paying out.
   * All returned values are in stroops (BigInt).
   */
  calculateReward(
    module: Module,
    streakDays = 0,
    hasReferral = false,
  ): {
    baseAmountStroops: bigint
    streakBonusStroops: bigint
    referralBonusStroops: bigint
    totalAmountStroops: bigint
  } {
    const baseAmountStroops = this.calculateBaseReward(module)
    const streakBonusStroops = this.calculateStreakBonus(
      baseAmountStroops,
      streakDays,
    )
    const referralBonusStroops = hasReferral ? REFERRAL_BONUS_STROOPS : 0n
    const totalAmountStroops = addStroops(
      addStroops(baseAmountStroops, streakBonusStroops),
      referralBonusStroops,
    )

    return {
      baseAmountStroops,
      streakBonusStroops,
      referralBonusStroops,
      totalAmountStroops,
    }
  }

  /**
   * Claim a reward for completing a module. Validates, calculates, pays out via
   * Stellar and records the transaction.
   */
  async claimReward(claim: RewardClaim, module: Module): Promise<RewardResult> {
    // 1. Validate: prevent double-claiming
    this.assertNotAlreadyClaimed(claim.userId, claim.moduleId)

    // 2. Resolve referral code to referrer id
    const referrerId = claim.referralCode
      ? this.resolveReferralCode(claim.referralCode)
      : undefined

    // 3. Calculate amounts (all in stroops)
    const {
      baseAmountStroops,
      streakBonusStroops,
      referralBonusStroops,
      totalAmountStroops,
    } = this.calculateReward(module, claim.streakDays ?? 0, !!referrerId)

    // 4. Payout via Stellar — SDK expects 7-decimal XLM string
    const paymentResult = await this.stellarService.sendPayment({
      sourceSecret: process.env.STELLAR_SOURCE_SECRET!,
      destinationPublicKey: claim.walletAddress,
      amount: stroopsToXlmString(totalAmountStroops),
      memo: `Learnault reward: module ${claim.moduleId}`,
    })
    const stellarTxHash = paymentResult.hash

    // 5. Mark claimed to prevent duplicates
    this.markAsClaimed(claim.userId, claim.moduleId)

    // 6. Record transaction
    const transactionId = this.recordTransaction({
      userId: claim.userId,
      moduleId: claim.moduleId,
      amountStroops: totalAmountStroops,
      type: 'module_reward',
      status: 'completed',
      stellarTxHash,
    })

    // 7. Pay referral bonus if applicable (non-blocking)
    if (referrerId && referralBonusStroops > 0n) {
      await this.payReferralBonus(referrerId, claim.moduleId, stellarTxHash)
    }

    // 8. Send push notification for reward receipt (non-blocking)
    this.notificationService
      .queueNotification(
        claim.userId,
        'rewardReceipt',
        'Reward Received!',
        `You earned ${stroopsToXlmString(totalAmountStroops)} XLM for completing module ${module.title}.`,
      )
      .catch((err) =>
        console.error('[Notifications] Reward notification error:', err),
      )

    return {
      transactionId,
      userId: claim.userId,
      moduleId: claim.moduleId,
      baseAmountStroops,
      streakBonusStroops,
      referralBonusStroops,
      totalAmountStroops,
      stellarTxHash,
      claimedAt: new Date(),
    }
  }

  /**
   * Register a referral code mapped to a user.
   */
  registerReferralCode(code: string, userId: string): void {
    if (referralCodes.has(code)) {
      throw new Error(`Referral code "${code}" is already in use`)
    }
    referralCodes.set(code, userId)
  }

  /**
   * Check whether a user has already claimed the reward for a module.
   */
  hasAlreadyClaimed(userId: string, moduleId: string): boolean {
    return claimedRewards.get(userId)?.has(moduleId) ?? false
  }

  /**
   * Return all recorded transactions.
   */
  getTransactions(): Transaction[] {
    return [...transactions]
  }

  /**
   * Return all recorded transactions for a specific user.
   */
  getUserTransactions(userId: string): Transaction[] {
    return transactions.filter((t) => t.userId === userId)
  }

  /**
   * Calculate user's current balance based on completed rewards and withdrawals.
   * All amounts are in stroops (BigInt).
   */
  getBalance(userId: string): Balance {
    const userTransactions = this.getUserTransactions(userId)

    const earnedStroops = userTransactions
      .filter(
        (t) =>
          t.status === 'completed' &&
          ['module_reward', 'streak_bonus', 'referral_reward'].includes(t.type),
      )
      .reduce((sum, t) => sum + t.amountStroops, 0n)

    const withdrawnStroops = userTransactions
      .filter((t) => t.status === 'completed' && t.type === 'withdrawal')
      .reduce((sum, t) => sum + t.amountStroops, 0n)

    const pendingStroops = userTransactions
      .filter((t) => t.status === 'pending' && t.type === 'withdrawal')
      .reduce((sum, t) => sum + t.amountStroops, 0n)

    const availableStroops =
      earnedStroops >= withdrawnStroops + pendingStroops
        ? earnedStroops - withdrawnStroops - pendingStroops
        : 0n

    return {
      userId,
      availableStroops,
      pendingStroops,
      lifetimeStroops: earnedStroops,
      updatedAt: new Date(),
    }
  }

  /**
   * Get transaction history with filtering and pagination.
   */
  getTransactionHistory(
    userId: string,
    filters: TransactionFilter = {},
  ): {
    transactions: Transaction[]
    total: number
    hasMore: boolean
  } {
    let userTransactions = this.getUserTransactions(userId)

    if (filters.type) {
      userTransactions = userTransactions.filter((t) => t.type === filters.type)
    }

    if (filters.status) {
      userTransactions = userTransactions.filter(
        (t) => t.status === filters.status,
      )
    }

    if (filters.fromDate) {
      userTransactions = userTransactions.filter(
        (t) => t.createdAt >= filters.fromDate!,
      )
    }

    if (filters.toDate) {
      userTransactions = userTransactions.filter(
        (t) => t.createdAt <= filters.toDate!,
      )
    }

    userTransactions.sort(
      (a, b) => b.createdAt.getTime() - a.createdAt.getTime(),
    )

    const total = userTransactions.length
    const limit = filters.limit ?? 20
    const offset = filters.offset ?? 0

    return {
      transactions: userTransactions.slice(offset, offset + limit),
      total,
      hasMore: offset + limit < total,
    }
  }

  /**
   * Process a withdrawal request.
   */
  async processWithdrawal(
    request: WithdrawalRequest,
  ): Promise<WithdrawalResult> {
    const balance = this.getBalance(request.userId)

    if (request.amountStroops > balance.availableStroops) {
      throw new Error(
        `Insufficient balance. Available: ${stroopsToXlmString(balance.availableStroops)} XLM, ` +
          `Requested: ${stroopsToXlmString(request.amountStroops)} XLM`,
      )
    }

    if (request.amountStroops <= 0n) {
      throw new Error('Withdrawal amount must be greater than 0')
    }

    const transactionId = this.recordTransaction({
      userId: request.userId,
      amountStroops: request.amountStroops,
      type: 'withdrawal',
      status: 'pending',
      stellarTxHash: undefined,
    })

    pendingWithdrawals.set(transactionId, request)

    try {
      const paymentResult = await this.stellarService.sendPayment({
        sourceSecret: process.env.STELLAR_SOURCE_SECRET!,
        destinationPublicKey: request.walletAddress,
        amount: stroopsToXlmString(request.amountStroops),
        memo: request.memo ?? `Learnault withdrawal: ${transactionId}`,
      })
      const stellarTxHash = paymentResult.hash

      this.updateTransactionStatus(transactionId, 'completed', stellarTxHash)

      return {
        transactionId,
        userId: request.userId,
        amountStroops: request.amountStroops,
        stellarTxHash,
        status: 'completed',
        requestedAt: new Date(),
        completedAt: new Date(),
      }
    } catch (error) {
      this.updateTransactionStatus(transactionId, 'failed')
      pendingWithdrawals.delete(transactionId)
      throw error
    }
  }

  /**
   * Check if user has sufficient balance for a withdrawal.
   */
  hasSufficientBalance(userId: string, amountStroops: bigint): boolean {
    const balance = this.getBalance(userId)

    return amountStroops <= balance.availableStroops
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private calculateBaseReward(module: Module): bigint {
    const [num, den] = DIFFICULTY_MULTIPLIERS[module.difficulty] ?? [1n, 1n]

    return multiplyStroops(module.baseRewardStroops, num, den)
  }

  private calculateStreakBonus(
    baseAmountStroops: bigint,
    streakDays: number,
  ): bigint {
    if (streakDays <= 0) return 0n

    // bonus = base × streakDays × (1/10), capped at base × (1/1)
    const uncappedBonus = multiplyStroops(
      baseAmountStroops,
      BigInt(streakDays) * STREAK_BONUS_RATE_NUM,
      STREAK_BONUS_RATE_DEN,
    )
    const maxBonus = multiplyStroops(
      baseAmountStroops,
      MAX_STREAK_BONUS_NUM,
      MAX_STREAK_BONUS_DEN,
    )

    return clampStroops(uncappedBonus, maxBonus)
  }

  private resolveReferralCode(code: string): string | undefined {
    return referralCodes.get(code)
  }

  private assertNotAlreadyClaimed(userId: string, moduleId: string): void {
    if (this.hasAlreadyClaimed(userId, moduleId)) {
      throw new Error(
        `User "${userId}" has already claimed the reward for module "${moduleId}"`,
      )
    }
  }

  private markAsClaimed(userId: string, moduleId: string): void {
    if (!claimedRewards.has(userId)) {
      claimedRewards.set(userId, new Set())
    }
    claimedRewards.get(userId)!.add(moduleId)
  }

  private recordTransaction(
    data: Omit<Transaction, 'id' | 'createdAt'>,
  ): string {
    const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`
    transactions.push({ id, ...data, createdAt: new Date() })

    return id
  }

  private updateTransactionStatus(
    transactionId: string,
    status: Transaction['status'],
    stellarTxHash?: string,
  ): void {
    const transaction = transactions.find((t) => t.id === transactionId)
    if (transaction) {
      transaction.status = status
      if (stellarTxHash) {
        transaction.stellarTxHash = stellarTxHash
      }
      if (status === 'completed') {
        transaction.completedAt = new Date()
      }
    }
  }

  private async payReferralBonus(
    referrerId: string,
    _moduleId: string,
    _originalTxHash: string,
  ): Promise<void> {
    try {
      // TODO: Implement user wallet storage and retrieval
      // For now, skip referral bonus if wallet address cannot be retrieved
      console.warn(
        `Referral bonus skipped: No wallet address storage implemented for user ${referrerId}`,
      )
    } catch (err) {
      // Referral bonus failure must NOT roll back the learner's main reward
      console.error(`Failed to pay referral bonus to user ${referrerId}:`, err)
    }
  }

  /** @internal – resets in-memory state between unit tests */
  _resetState(): void {
    claimedRewards.clear()
    transactions.length = 0
    referralCodes.clear()
    pendingWithdrawals.clear()
  }
}

// ─── Re-export constants for backward-compat & convenience ───────────────────

/**
 * Numeric convenience values kept for display/documentation purposes only.
 * Use the BigInt stroop equivalents for all arithmetic.
 */
export const BASE_REWARD_XLM = Number(BASE_REWARD_STROOPS / STROOPS_PER_XLM)
export const REFERRAL_BONUS_XLM = Number(
  REFERRAL_BONUS_STROOPS / STROOPS_PER_XLM,
)
export const STREAK_BONUS_RATE = 0.1
export const MAX_STREAK_BONUS = 1.0
