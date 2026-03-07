import { StellarService } from './stellar.service'

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleDifficulty =
  | 'beginner'
  | 'intermediate'
  | 'advanced'
  | 'expert';

export interface Module {
  id: string;
  difficulty: ModuleDifficulty;
  baseReward: number;
  title: string;
}

export interface RewardClaim {
  userId: string;
  moduleId: string;
  walletAddress: string;
  streakDays?: number;
  referralCode?: string;
}

export interface RewardResult {
  transactionId: string;
  userId: string;
  moduleId: string;
  baseAmount: number;
  streakBonus: number;
  referralBonus: number;
  totalAmount: number;
  stellarTxHash: string;
  claimedAt: Date;
}

export interface Transaction {
  id: string;
  userId: string;
  moduleId?: string;
  amount: number;
  type: "module_reward" | "streak_bonus" | "referral_reward" | "withdrawal";
  status: "pending" | "completed" | "failed";
  stellarTxHash?: string;
  createdAt: Date;
  completedAt?: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DIFFICULTY_MULTIPLIERS: Record<ModuleDifficulty, number> = {
  beginner: 1.0,
  intermediate: 1.5,
  advanced: 2.0,
  expert: 3.0,
}

export const BASE_REWARD_XLM = 5
export const STREAK_BONUS_RATE = 0.1 // 10% bonus per streak day
export const MAX_STREAK_BONUS = 1.0 // cap at 100% of base
export const REFERRAL_BONUS_XLM = 2 // flat XLM bonus per referral

export interface WithdrawalRequest {
  userId: string;
  walletAddress: string;
  amount: number;
  memo?: string;
}

export interface WithdrawalResult {
  transactionId: string;
  userId: string;
  amount: number;
  stellarTxHash: string;
  status: "pending" | "completed" | "failed";
  requestedAt: Date;
  completedAt?: Date;
}

export interface Balance {
  userId: string;
  available: number;
  pending: number;
  lifetime: number;
  updatedAt: Date;
}

export interface TransactionFilter {
  type?: Transaction["type"];
  status?: Transaction["status"];
  fromDate?: Date;
  toDate?: Date;
  limit?: number;
  offset?: number;
}

// ─── In-memory stores (replace with Prisma in production) ────────────────────

const claimedRewards = new Map<string, Set<string>>();
const transactions: Transaction[] = [];
const referralCodes = new Map<string, string>(); // code -> referrerId
const pendingWithdrawals = new Map<string, WithdrawalRequest>();

// ─── RewardService ────────────────────────────────────────────────────────────

export class RewardService {
  private stellarService: StellarService

  constructor(stellarService?: StellarService) {
    this.stellarService = stellarService ?? new StellarService()
  }

  // ── Public API ──────────────────────────────────────────────────────────────

  /**
   * Calculate the reward breakdown for a module completion without paying out.
   */
  calculateReward(
    module: Module,
    streakDays = 0,
    hasReferral = false,
  ): {
    baseAmount: number;
    streakBonus: number;
    referralBonus: number;
    totalAmount: number;
  } {
    const baseAmount = this.calculateBaseReward(module)
    const streakBonus = this.calculateStreakBonus(baseAmount, streakDays)
    const referralBonus = hasReferral ? REFERRAL_BONUS_XLM : 0
    const totalAmount = baseAmount + streakBonus + referralBonus

    return { baseAmount, streakBonus, referralBonus, totalAmount }
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

    // 3. Calculate amounts
    const { baseAmount, streakBonus, referralBonus, totalAmount } =
      this.calculateReward(module, claim.streakDays ?? 0, !!referrerId)

    // 4. Payout via Stellar
    const paymentResult = await this.stellarService.sendPayment({
      sourceSecret: process.env.STELLAR_SOURCE_SECRET!,
      destinationPublicKey: claim.walletAddress,
      amount: totalAmount.toString(),
      memo: `Learnault reward: module ${claim.moduleId}`,
    });
    const stellarTxHash = paymentResult.hash;

    // 5. Mark claimed to prevent duplicates
    this.markAsClaimed(claim.userId, claim.moduleId)

    // 6. Record transaction
    const transactionId = this.recordTransaction({
      userId: claim.userId,
      moduleId: claim.moduleId,
      amount: totalAmount,
      type: "module_reward",
      status: "completed",
      stellarTxHash,
    })

    // 7. Pay referral bonus if applicable (non-blocking)
    if (referrerId && referralBonus > 0) {
      await this.payReferralBonus(referrerId, claim.moduleId, stellarTxHash)
    }

    return {
      transactionId,
      userId: claim.userId,
      moduleId: claim.moduleId,
      baseAmount,
      streakBonus,
      referralBonus,
      totalAmount,
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
    return transactions.filter((t) => t.userId === userId);
  }

  /**
   * Calculate user's current balance based on completed rewards and withdrawals.
   */
  getBalance(userId: string): Balance {
    const userTransactions = this.getUserTransactions(userId);
    
    // Calculate totals from completed transactions only
    const earned = userTransactions
      .filter(t => t.status === "completed" && ["module_reward", "streak_bonus", "referral_reward"].includes(t.type))
      .reduce((sum, t) => sum + t.amount, 0);
    
    const withdrawn = userTransactions
      .filter(t => t.status === "completed" && t.type === "withdrawal")
      .reduce((sum, t) => sum + t.amount, 0);
    
    const pending = userTransactions
      .filter(t => t.status === "pending" && t.type === "withdrawal")
      .reduce((sum, t) => sum + t.amount, 0);
    
    const available = earned - withdrawn - pending;
    
    return {
      userId,
      available: Math.max(0, +(available).toFixed(7)),
      pending: +(pending).toFixed(7),
      lifetime: +(earned).toFixed(7),
      updatedAt: new Date(),
    };
  }

  /**
   * Get transaction history with filtering and pagination.
   */
  getTransactionHistory(userId: string, filters: TransactionFilter = {}): {
    transactions: Transaction[];
    total: number;
    hasMore: boolean;
  } {
    let userTransactions = this.getUserTransactions(userId);
    
    // Apply filters
    if (filters.type) {
      userTransactions = userTransactions.filter(t => t.type === filters.type);
    }
    
    if (filters.status) {
      userTransactions = userTransactions.filter(t => t.status === filters.status);
    }
    
    if (filters.fromDate) {
      userTransactions = userTransactions.filter(t => t.createdAt >= filters.fromDate!);
    }
    
    if (filters.toDate) {
      userTransactions = userTransactions.filter(t => t.createdAt <= filters.toDate!);
    }
    
    // Sort by creation date (newest first)
    userTransactions.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    
    const total = userTransactions.length;
    const limit = filters.limit ?? 20;
    const offset = filters.offset ?? 0;
    
    const paginatedTransactions = userTransactions.slice(offset, offset + limit);
    
    return {
      transactions: paginatedTransactions,
      total,
      hasMore: offset + limit < total,
    };
  }

  /**
   * Process a withdrawal request.
   */
  async processWithdrawal(request: WithdrawalRequest): Promise<WithdrawalResult> {
    // Validate sufficient balance
    const balance = this.getBalance(request.userId);
    
    if (request.amount > balance.available) {
      throw new Error(
        `Insufficient balance. Available: ${balance.available} XLM, Requested: ${request.amount} XLM`
      );
    }
    
    if (request.amount <= 0) {
      throw new Error("Withdrawal amount must be greater than 0");
    }
    
    // Create pending withdrawal transaction
    const transactionId = this.recordTransaction({
      userId: request.userId,
      amount: request.amount,
      type: "withdrawal",
      status: "pending",
      stellarTxHash: undefined,
    });
    
    // Store pending withdrawal
    pendingWithdrawals.set(transactionId, request);
    
    // Process the withdrawal via Stellar
    try {
      const paymentResult = await this.stellarService.sendPayment({
        sourceSecret: process.env.STELLAR_SOURCE_SECRET!,
        destinationPublicKey: request.walletAddress,
        amount: request.amount.toString(),
        memo: request.memo ?? `Learnault withdrawal: ${transactionId}`,
      });
      const stellarTxHash = paymentResult.hash;
      
      // Update transaction status to completed
      this.updateTransactionStatus(transactionId, "completed", stellarTxHash);
      
      return {
        transactionId,
        userId: request.userId,
        amount: request.amount,
        stellarTxHash,
        status: "completed",
        requestedAt: new Date(),
        completedAt: new Date(),
      };
    } catch (error) {
      // Mark transaction as failed
      this.updateTransactionStatus(transactionId, "failed");
      pendingWithdrawals.delete(transactionId);
      throw error;
    }
  }

  /**
   * Check if user has sufficient balance for withdrawal.
   */
  hasSufficientBalance(userId: string, amount: number): boolean {
    const balance = this.getBalance(userId);
    return amount <= balance.available;
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private calculateBaseReward(module: Module): number {
    const multiplier = DIFFICULTY_MULTIPLIERS[module.difficulty] ?? 1.0
    
return +(BASE_REWARD_XLM * multiplier).toFixed(7)
  }

  private calculateStreakBonus(baseAmount: number, streakDays: number): number {
    if (streakDays <= 0) return 0
    const bonusRate = Math.min(
      streakDays * STREAK_BONUS_RATE,
      MAX_STREAK_BONUS,
    )
    
return +(baseAmount * bonusRate).toFixed(7)
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
    const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    transactions.push({ id, ...data, createdAt: new Date() });
    return id;
  }

  private updateTransactionStatus(
    transactionId: string,
    status: Transaction["status"],
    stellarTxHash?: string,
  ): void {
    const transaction = transactions.find(t => t.id === transactionId);
    if (transaction) {
      transaction.status = status;
      if (stellarTxHash) {
        transaction.stellarTxHash = stellarTxHash;
      }
      if (status === "completed") {
        transaction.completedAt = new Date();
      }
    }
  }

  private async payReferralBonus(
    referrerId: string,
    moduleId: string,
    _originalTxHash: string,
  ): Promise<void> {
    try {
      const referrerWallet =
        await this.stellarService.getWalletAddress(referrerId)
      if (!referrerWallet) return

      const paymentResult = await this.stellarService.sendPayment({
        sourceSecret: process.env.STELLAR_SOURCE_SECRET!,
        destinationPublicKey: referrerWallet,
        amount: REFERRAL_BONUS_XLM.toString(),
        memo: `Learnault referral bonus: module ${moduleId}`,
      });
      const txHash = paymentResult.hash;

      this.recordTransaction({
        userId: referrerId,
        moduleId,
        amount: REFERRAL_BONUS_XLM,
        type: "referral_reward",
        status: "completed",
        stellarTxHash: txHash,
      })
    } catch (err) {
      // Referral bonus failure must NOT roll back the learner's main reward
      console.error(`Failed to pay referral bonus to user ${referrerId}:`, err)
    }
  }

  /** @internal – resets in-memory state between unit tests */
  _resetState(): void {
    claimedRewards.clear();
    transactions.length = 0;
    referralCodes.clear();
    pendingWithdrawals.clear();
  }
}
