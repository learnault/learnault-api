/**
 * reward.types.ts
 *
 * API-layer types for the rewards domain.  All monetary amounts that cross the
 * network boundary are represented as 7-decimal XLM strings (e.g. "5.0000000")
 * so that JSON serialisation never silently introduces floating-point error.
 *
 * Internal service types use BigInt stroops — see reward.service.ts.
 */

export enum TransactionType {
  EARNED = 'earned',
  SPENT = 'spent',
  TRANSFERRED = 'transferred',
  REFUNDED = 'refunded',
  BONUS = 'bonus',
}

export enum TransactionStatus {
  PENDING = 'pending',
  COMPLETED = 'completed',
  FAILED = 'failed',
  REVERSED = 'reversed',
}

export enum TransactionReason {
  MODULE_COMPLETION = 'module_completion',
  CREDENTIAL_ISSUED = 'credential_issued',
  REFERRAL_BONUS = 'referral_bonus',
  STREAK_BONUS = 'streak_bonus',
  REWARD_REDEMPTION = 'reward_redemption',
  ADMIN_ADJUSTMENT = 'admin_adjustment',
}

/** API-layer transaction shape.  `amount` is a 7-decimal XLM string. */
export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  reason: TransactionReason;
  /** 7-decimal XLM string, e.g. "5.0000000". Never a JavaScript number. */
  amount: string;
  /** 7-decimal XLM string. */
  balanceBefore: string;
  /** 7-decimal XLM string. */
  balanceAfter: string;
  referenceId?: string;
  referenceType?: string;
  note?: string;
  createdAt: string;
  completedAt?: string;
}

/** API-layer balance shape.  All amounts are 7-decimal XLM strings. */
export interface Balance {
  userId: string;
  /** 7-decimal XLM string. */
  available: string;
  /** 7-decimal XLM string. */
  pending: string;
  /** 7-decimal XLM string. */
  lifetime: string;
  updatedAt: string;
}

export interface RewardSummary {
  balance: Balance;
  recentTransactions: Transaction[];
  /** 7-decimal XLM string. */
  earnedThisMonth: string;
  /** 7-decimal XLM string. */
  spentThisMonth: string;
}

// Request types
export interface CreateTransactionRequest {
  userId: string;
  type: TransactionType;
  reason: TransactionReason;
  /** 7-decimal XLM string submitted by the caller. */
  amount: string;
  referenceId?: string;
  referenceType?: string;
  note?: string;
}

export interface TransactionFilterParams {
  type?: TransactionType;
  status?: TransactionStatus;
  reason?: TransactionReason;
  fromDate?: string;
  toDate?: string;
  /** 7-decimal XLM string (lower bound). */
  minAmount?: string;
  /** 7-decimal XLM string (upper bound). */
  maxAmount?: string;
}
