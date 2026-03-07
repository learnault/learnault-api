import { StellarService } from "./stellar.service";

// ─── Types ────────────────────────────────────────────────────────────────────

export type ModuleDifficulty =
  | "beginner"
  | "intermediate"
  | "advanced"
  | "expert";

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
  moduleId: string;
  amount: number;
  type: "module_reward" | "streak_bonus" | "referral_reward";
  stellarTxHash: string;
  createdAt: Date;
}

// ─── Constants ────────────────────────────────────────────────────────────────

export const DIFFICULTY_MULTIPLIERS: Record<ModuleDifficulty, number> = {
  beginner: 1.0,
  intermediate: 1.5,
  advanced: 2.0,
  expert: 3.0,
};

export const BASE_REWARD_XLM = 5;
export const STREAK_BONUS_RATE = 0.1; // 10% bonus per streak day
export const MAX_STREAK_BONUS = 1.0; // cap at 100% of base
export const REFERRAL_BONUS_XLM = 2; // flat XLM bonus per referral

// ─── In-memory stores (replace with Prisma in production) ────────────────────

const claimedRewards = new Map<string, Set<string>>();
const transactions: Transaction[] = [];
const referralCodes = new Map<string, string>(); // code -> referrerId

// ─── RewardService ────────────────────────────────────────────────────────────

export class RewardService {
  private stellarService: StellarService;

  constructor(stellarService?: StellarService) {
    this.stellarService = stellarService ?? new StellarService();
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
    const baseAmount = this.calculateBaseReward(module);
    const streakBonus = this.calculateStreakBonus(baseAmount, streakDays);
    const referralBonus = hasReferral ? REFERRAL_BONUS_XLM : 0;
    const totalAmount = baseAmount + streakBonus + referralBonus;

    return { baseAmount, streakBonus, referralBonus, totalAmount };
  }

  /**
   * Claim a reward for completing a module. Validates, calculates, pays out via
   * Stellar and records the transaction.
   */
  async claimReward(claim: RewardClaim, module: Module): Promise<RewardResult> {
    // 1. Validate: prevent double-claiming
    this.assertNotAlreadyClaimed(claim.userId, claim.moduleId);

    // 2. Resolve referral code to referrer id
    const referrerId = claim.referralCode
      ? this.resolveReferralCode(claim.referralCode)
      : undefined;

    // 3. Calculate amounts
    const { baseAmount, streakBonus, referralBonus, totalAmount } =
      this.calculateReward(module, claim.streakDays ?? 0, !!referrerId);

    // 4. Payout via Stellar
    const stellarTxHash = await this.stellarService.sendPayment(
      claim.walletAddress,
      totalAmount,
      `Learnault reward: module ${claim.moduleId}`,
    );

    // 5. Mark claimed to prevent duplicates
    this.markAsClaimed(claim.userId, claim.moduleId);

    // 6. Record transaction
    const transactionId = this.recordTransaction({
      userId: claim.userId,
      moduleId: claim.moduleId,
      amount: totalAmount,
      type: "module_reward",
      stellarTxHash,
    });

    // 7. Pay referral bonus if applicable (non-blocking)
    if (referrerId && referralBonus > 0) {
      await this.payReferralBonus(referrerId, claim.moduleId, stellarTxHash);
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
    };
  }

  /**
   * Register a referral code mapped to a user.
   */
  registerReferralCode(code: string, userId: string): void {
    if (referralCodes.has(code)) {
      throw new Error(`Referral code "${code}" is already in use`);
    }
    referralCodes.set(code, userId);
  }

  /**
   * Check whether a user has already claimed the reward for a module.
   */
  hasAlreadyClaimed(userId: string, moduleId: string): boolean {
    return claimedRewards.get(userId)?.has(moduleId) ?? false;
  }

  /**
   * Return all recorded transactions.
   */
  getTransactions(): Transaction[] {
    return [...transactions];
  }

  /**
   * Return all recorded transactions for a specific user.
   */
  getUserTransactions(userId: string): Transaction[] {
    return transactions.filter((t) => t.userId === userId);
  }

  // ── Private helpers ─────────────────────────────────────────────────────────

  private calculateBaseReward(module: Module): number {
    const multiplier = DIFFICULTY_MULTIPLIERS[module.difficulty] ?? 1.0;
    return +(BASE_REWARD_XLM * multiplier).toFixed(7);
  }

  private calculateStreakBonus(baseAmount: number, streakDays: number): number {
    if (streakDays <= 0) return 0;
    const bonusRate = Math.min(
      streakDays * STREAK_BONUS_RATE,
      MAX_STREAK_BONUS,
    );
    return +(baseAmount * bonusRate).toFixed(7);
  }

  private resolveReferralCode(code: string): string | undefined {
    return referralCodes.get(code);
  }

  private assertNotAlreadyClaimed(userId: string, moduleId: string): void {
    if (this.hasAlreadyClaimed(userId, moduleId)) {
      throw new Error(
        `User "${userId}" has already claimed the reward for module "${moduleId}"`,
      );
    }
  }

  private markAsClaimed(userId: string, moduleId: string): void {
    if (!claimedRewards.has(userId)) {
      claimedRewards.set(userId, new Set());
    }
    claimedRewards.get(userId)!.add(moduleId);
  }

  private recordTransaction(
    data: Omit<Transaction, "id" | "createdAt">,
  ): string {
    const id = `txn_${Date.now()}_${Math.random().toString(36).slice(2, 9)}`;
    transactions.push({ id, ...data, createdAt: new Date() });
    return id;
  }

  private async payReferralBonus(
    referrerId: string,
    moduleId: string,
    _originalTxHash: string,
  ): Promise<void> {
    try {
      const referrerWallet =
        await this.stellarService.getWalletAddress(referrerId);
      if (!referrerWallet) return;

      const txHash = await this.stellarService.sendPayment(
        referrerWallet,
        REFERRAL_BONUS_XLM,
        `Learnault referral bonus: module ${moduleId}`,
      );

      this.recordTransaction({
        userId: referrerId,
        moduleId,
        amount: REFERRAL_BONUS_XLM,
        type: "referral_reward",
        stellarTxHash: txHash,
      });
    } catch (err) {
      // Referral bonus failure must NOT roll back the learner's main reward
      console.error(`Failed to pay referral bonus to user ${referrerId}:`, err);
    }
  }

  /** @internal – resets in-memory state between unit tests */
  _resetState(): void {
    claimedRewards.clear();
    transactions.length = 0;
    referralCodes.clear();
  }
}
