export enum TransactionType {
  EARNED = "earned",
  SPENT = "spent",
  TRANSFERRED = "transferred",
  REFUNDED = "refunded",
  BONUS = "bonus",
}

export enum TransactionStatus {
  PENDING = "pending",
  COMPLETED = "completed",
  FAILED = "failed",
  REVERSED = "reversed",
}

export enum TransactionReason {
  MODULE_COMPLETION = "module_completion",
  CREDENTIAL_ISSUED = "credential_issued",
  REFERRAL_BONUS = "referral_bonus",
  STREAK_BONUS = "streak_bonus",
  REWARD_REDEMPTION = "reward_redemption",
  ADMIN_ADJUSTMENT = "admin_adjustment",
}

export interface Transaction {
  id: string;
  userId: string;
  type: TransactionType;
  status: TransactionStatus;
  reason: TransactionReason;
  amount: number;
  balanceBefore: number;
  balanceAfter: number;
  referenceId?: string;
  referenceType?: string;
  note?: string;
  createdAt: string;
  completedAt?: string;
}

export interface Balance {
  userId: string;
  available: number;
  pending: number;
  lifetime: number;
  updatedAt: string;
}

export interface RewardSummary {
  balance: Balance;
  recentTransactions: Transaction[];
  earnedThisMonth: number;
  spentThisMonth: number;
}

// Request types
export interface CreateTransactionRequest {
  userId: string;
  type: TransactionType;
  reason: TransactionReason;
  amount: number;
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
  minAmount?: number;
  maxAmount?: number;
}
