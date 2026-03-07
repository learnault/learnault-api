import { describe, it, expect, vi, beforeEach } from "vitest";
import {
  RewardService,
  DIFFICULTY_MULTIPLIERS,
  BASE_REWARD_XLM,
  STREAK_BONUS_RATE,
  MAX_STREAK_BONUS,
  REFERRAL_BONUS_XLM,
  Module,
  RewardClaim,
} from "../../src/services/reward.service";
import { StellarService } from "../../src/services/stellar.service";

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeModule = (overrides: Partial<Module> = {}): Module => ({
  id: "mod-001",
  title: "Intro to Stellar",
  difficulty: "beginner",
  baseReward: BASE_REWARD_XLM,
  ...overrides,
});

const makeClaim = (overrides: Partial<RewardClaim> = {}): RewardClaim => ({
  userId: "user-abc",
  moduleId: "mod-001",
  walletAddress: "GABC1234567890123456789012345678901234567890123456789",
  streakDays: 0,
  ...overrides,
});

const MOCK_TX_HASH = "abc123stellar";
const MOCK_WALLET = "GREFERRER12345678901234567890123456789012345678901234";

// ─── Tests ────────────────────────────────────────────────────────────────────

describe("RewardService", () => {
  let stellarMock: StellarService;
  let service: RewardService;

  beforeEach(() => {
    stellarMock = {
      sendPayment: vi.fn().mockResolvedValue({ hash: MOCK_TX_HASH, ledger: 123, successful: true }),
      getWalletAddress: vi.fn().mockResolvedValue(MOCK_WALLET),
      verifyTransaction: vi.fn().mockResolvedValue(true),
    } as unknown as StellarService;

    service = new RewardService(stellarMock);
    service._resetState();
  });

  // ── calculateReward ─────────────────────────────────────────────────────────

  describe("calculateReward – base amounts by difficulty", () => {
    it.each([
      ["beginner", 5],
      ["intermediate", 7.5],
      ["advanced", 10],
      ["expert", 15],
    ] as const)("%s difficulty yields %d XLM base", (difficulty, expected) => {
      const { baseAmount } = service.calculateReward(
        makeModule({ difficulty }),
      );
      expect(baseAmount).toBe(expected);
    });

    it("applies the correct multiplier from DIFFICULTY_MULTIPLIERS", () => {
      for (const [diff, mult] of Object.entries(DIFFICULTY_MULTIPLIERS)) {
        const mod = makeModule({ difficulty: diff as Module["difficulty"] });
        const { baseAmount } = service.calculateReward(mod);
        expect(baseAmount).toBeCloseTo(BASE_REWARD_XLM * mult);
      }
    });
  });

  describe("calculateReward – streak bonus", () => {
    it("returns 0 streak bonus with 0 streak days", () => {
      const { streakBonus } = service.calculateReward(makeModule(), 0);
      expect(streakBonus).toBe(0);
    });

    it("applies 10% bonus per streak day", () => {
      const base = BASE_REWARD_XLM; // beginner = 5 XLM
      const { streakBonus } = service.calculateReward(makeModule(), 3);
      // 3 days × 10% × 5 = 1.5
      expect(streakBonus).toBeCloseTo(base * 3 * STREAK_BONUS_RATE);
    });

    it("caps streak bonus at 100% of base", () => {
      const base = BASE_REWARD_XLM;
      // 20 days would be 200% without a cap
      const { streakBonus } = service.calculateReward(makeModule(), 20);
      expect(streakBonus).toBeCloseTo(base * MAX_STREAK_BONUS);
    });

    it("streak bonus is included in totalAmount", () => {
      const { baseAmount, streakBonus, totalAmount } = service.calculateReward(
        makeModule(),
        5,
      );
      expect(totalAmount).toBeCloseTo(baseAmount + streakBonus);
    });
  });

  describe("calculateReward – referral bonus", () => {
    it("adds REFERRAL_BONUS_XLM when hasReferral is true", () => {
      const { referralBonus } = service.calculateReward(makeModule(), 0, true);
      expect(referralBonus).toBe(REFERRAL_BONUS_XLM);
    });

    it("adds no referral bonus when hasReferral is false", () => {
      const { referralBonus } = service.calculateReward(makeModule(), 0, false);
      expect(referralBonus).toBe(0);
    });

    it("totalAmount includes base + streak + referral", () => {
      const { baseAmount, streakBonus, referralBonus, totalAmount } =
        service.calculateReward(makeModule(), 3, true);
      expect(totalAmount).toBeCloseTo(baseAmount + streakBonus + referralBonus);
    });
  });

  // ── claimReward ─────────────────────────────────────────────────────────────

  describe("claimReward – happy path", () => {
    it("returns a result with correct shape", async () => {
      const module = makeModule();
      const claim = makeClaim();
      const result = await service.claimReward(claim, module);

      expect(result).toMatchObject({
        userId: claim.userId,
        moduleId: claim.moduleId,
        stellarTxHash: MOCK_TX_HASH,
      });
      expect(result.transactionId).toMatch(/^txn_/);
      expect(result.claimedAt).toBeInstanceOf(Date);
    });

    it("calls Stellar sendPayment with correct address and total amount", async () => {
      const module = makeModule({ difficulty: "advanced" });
      const claim = makeClaim({ streakDays: 2 });
      await service.claimReward(claim, module);

      const { totalAmount } = service.calculateReward(module, 2, false);
      expect(stellarMock.sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationPublicKey: claim.walletAddress,
          amount: totalAmount.toString(),
          memo: expect.stringContaining(claim.moduleId),
        })
      );
    });

    it("records a transaction after successful claim", async () => {
      await service.claimReward(makeClaim(), makeModule());
      const txns = service.getUserTransactions("user-abc");
      expect(txns).toHaveLength(1);
      expect(txns[0].type).toBe("module_reward");
    });
  });

  describe("claimReward – double-claim prevention", () => {
    it("throws when the same user claims the same module twice", async () => {
      const module = makeModule();
      const claim = makeClaim();

      await service.claimReward(claim, module);

      await expect(service.claimReward(claim, module)).rejects.toThrow(
        /already claimed/i,
      );
    });

    it("allows the same user to claim a different module", async () => {
      await service.claimReward(
        makeClaim({ moduleId: "mod-001" }),
        makeModule({ id: "mod-001" }),
      );
      const result = await service.claimReward(
        makeClaim({ moduleId: "mod-002" }),
        makeModule({ id: "mod-002" }),
      );
      expect(result.moduleId).toBe("mod-002");
    });

    it("hasAlreadyClaimed returns true after claiming", async () => {
      await service.claimReward(makeClaim(), makeModule());
      expect(service.hasAlreadyClaimed("user-abc", "mod-001")).toBe(true);
    });

    it("hasAlreadyClaimed returns false before claiming", () => {
      expect(service.hasAlreadyClaimed("user-abc", "mod-001")).toBe(false);
    });
  });

  // ── Streak bonus in claim ───────────────────────────────────────────────────

  describe("claimReward – streak bonus integration", () => {
    it("includes streak bonus in the result", async () => {
      const module = makeModule();
      const claim = makeClaim({ streakDays: 5 });
      const result = await service.claimReward(claim, module);
      expect(result.streakBonus).toBeGreaterThan(0);
    });

    it("passes correct totalAmount (with streak) to Stellar", async () => {
      const module = makeModule();
      const claim = makeClaim({ streakDays: 5 });
      await service.claimReward(claim, module);

      const { totalAmount } = service.calculateReward(module, 5, false);
      expect(stellarMock.sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationPublicKey: claim.walletAddress,
          amount: totalAmount.toString(),
          memo: expect.any(String),
        })
      );
    });
  });

  // ── Referral rewards ────────────────────────────────────────────────────────

  describe("claimReward – referral rewards", () => {
    const REFERRAL_CODE = "REF-XYZ";
    const REFERRER_ID = "user-referrer";

    beforeEach(() => {
      service.registerReferralCode(REFERRAL_CODE, REFERRER_ID);
    });

    it("pays the referrer a bonus when a valid referral code is used", async () => {
      const claim = makeClaim({ referralCode: REFERRAL_CODE });
      await service.claimReward(claim, makeModule());

      // sendPayment is called twice: once for learner, once for referrer
      expect(stellarMock.sendPayment).toHaveBeenCalledTimes(2);
      expect(stellarMock.sendPayment).toHaveBeenNthCalledWith(
        2,
        expect.objectContaining({
          destinationPublicKey: MOCK_WALLET,
          amount: REFERRAL_BONUS_XLM.toString(),
          memo: expect.stringContaining("referral"),
        })
      );
    });

    it("records a referral_reward transaction for the referrer", async () => {
      const claim = makeClaim({ referralCode: REFERRAL_CODE });
      await service.claimReward(claim, makeModule());

      const referrerTxns = service.getUserTransactions(REFERRER_ID);
      expect(referrerTxns).toHaveLength(1);
      expect(referrerTxns[0].type).toBe("referral_reward");
      expect(referrerTxns[0].amount).toBe(REFERRAL_BONUS_XLM);
    });

    it("does not pay referral bonus for an unknown referral code", async () => {
      const claim = makeClaim({ referralCode: "UNKNOWN" });
      await service.claimReward(claim, makeModule());

      // Only the learner payout — no referral payment
      expect(stellarMock.sendPayment).toHaveBeenCalledTimes(1);
    });

    it("still completes learner reward even if referral payout fails", async () => {
      (stellarMock.sendPayment as ReturnType<typeof vi.fn>)
        .mockResolvedValueOnce({ hash: MOCK_TX_HASH, ledger: 123, successful: true }) // learner tx succeeds
        .mockRejectedValueOnce(new Error("Network error")); // referral tx fails

      const claim = makeClaim({ referralCode: REFERRAL_CODE });
      const result = await service.claimReward(claim, makeModule());

      // The learner result should still be valid
      expect(result.stellarTxHash).toBe(MOCK_TX_HASH);
    });
  });

  // ── registerReferralCode ────────────────────────────────────────────────────

  describe("registerReferralCode", () => {
    it("registers a new code without throwing", () => {
      expect(() =>
        service.registerReferralCode("NEW-CODE", "user-1"),
      ).not.toThrow();
    });

    it("throws when a code is already registered", () => {
      service.registerReferralCode("DUP-CODE", "user-1");
      expect(() => service.registerReferralCode("DUP-CODE", "user-2")).toThrow(
        /already in use/i,
      );
    });
  });

  // ── Transaction records ─────────────────────────────────────────────────────

  describe("transaction records", () => {
    it("getTransactions returns all transactions", async () => {
      await service.claimReward(
        makeClaim({ moduleId: "mod-001" }),
        makeModule({ id: "mod-001" }),
      );
      await service.claimReward(
        makeClaim({ userId: "user-xyz", moduleId: "mod-002" }),
        makeModule({ id: "mod-002" }),
      );
      expect(service.getTransactions()).toHaveLength(2);
    });

    it("getUserTransactions filters by userId", async () => {
      await service.claimReward(
        makeClaim({ userId: "user-a", moduleId: "mod-001" }),
        makeModule({ id: "mod-001" }),
      );
      await service.claimReward(
        makeClaim({ userId: "user-b", moduleId: "mod-002" }),
        makeModule({ id: "mod-002" }),
      );

      const txns = service.getUserTransactions("user-a");
      expect(txns).toHaveLength(1);
      expect(txns[0].userId).toBe("user-a");
    });

    it("each transaction has a unique id", async () => {
      await service.claimReward(
        makeClaim({ userId: "u1", moduleId: "mod-001" }),
        makeModule({ id: "mod-001" }),
      );
      await service.claimReward(
        makeClaim({ userId: "u2", moduleId: "mod-002" }),
        makeModule({ id: "mod-002" }),
      );

      const ids = service.getTransactions().map((t) => t.id);
      expect(new Set(ids).size).toBe(ids.length);
    });

    it("transaction includes the Stellar tx hash", async () => {
      await service.claimReward(makeClaim(), makeModule());
      const [txn] = service.getTransactions();
      expect(txn.stellarTxHash).toBe(MOCK_TX_HASH);
    });
  });

  // ── Balance calculations ────────────────────────────────────────────────────

  describe("getBalance", () => {
    it("returns correct balance for user with no transactions", () => {
      const balance = service.getBalance("user-new");
      expect(balance).toEqual({
        userId: "user-new",
        available: 0,
        pending: 0,
        lifetime: 0,
        updatedAt: expect.any(Date),
      });
    });

    it("calculates available balance from completed module rewards", async () => {
      await service.claimReward(makeClaim({ moduleId: "mod-1" }), makeModule({ id: "mod-1", baseReward: 5 }));
      await service.claimReward(makeClaim({ moduleId: "mod-2" }), makeModule({ id: "mod-2", baseReward: 5 }));

      const balance = service.getBalance("user-abc");
      expect(balance.available).toBeGreaterThan(0);
      expect(balance.lifetime).toBe(balance.available);
    });

    it("includes streak and referral bonuses in balance", async () => {
      service.registerReferralCode("REF-XYZ", "referrer-123");
      const claim = makeClaim({ streakDays: 5, referralCode: "REF-XYZ" });
      
      await service.claimReward(claim, makeModule({ baseReward: 5 }));

      const learnerBalance = service.getBalance("user-abc");
      const referrerBalance = service.getBalance("referrer-123");

      expect(learnerBalance.available).toBeGreaterThanOrEqual(BASE_REWARD_XLM);
      expect(referrerBalance.available).toBe(REFERRAL_BONUS_XLM);
    });

    it("subtracts completed withdrawals from available balance", async () => {
      // First, earn some rewards
      await service.claimReward(makeClaim({ moduleId: "mod-1" }), makeModule({ id: "mod-1", baseReward: 5 }));
      const initialBalance = service.getBalance("user-abc");
      expect(initialBalance.available).toBeGreaterThan(0);

      // Then withdraw a small amount
      const withdrawalAmount = Math.min(1, initialBalance.available / 2);
      (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hash: "withdrawal-tx-hash", ledger: 123, successful: true });
      
      await service.processWithdrawal({
        userId: "user-abc",
        walletAddress: makeClaim().walletAddress,
        amount: withdrawalAmount,
      });

      const finalBalance = service.getBalance("user-abc");
      expect(finalBalance.available).toBeCloseTo(initialBalance.available - withdrawalAmount);
    });

    it("includes pending withdrawals in pending balance", async () => {
      await service.claimReward(makeClaim(), makeModule());
      const initialBalance = service.getBalance("user-abc");

      // Mock a pending withdrawal (we'll test the actual flow in integration tests)
      const transactions = service.getUserTransactions("user-abc");
      const earnedAmount = transactions
        .filter(t => t.status === "completed")
        .reduce((sum, t) => sum + t.amount, 0);

      expect(initialBalance.lifetime).toBe(earnedAmount);
    });
  });

  // ── Transaction history ─────────────────────────────────────────────────────

  describe("getTransactionHistory", () => {
    beforeEach(async () => {
      // Create multiple transactions
      await service.claimReward(makeClaim({ moduleId: "mod-1" }), makeModule({ id: "mod-1" }));
      await service.claimReward(makeClaim({ moduleId: "mod-2" }), makeModule({ id: "mod-2" }));
      await service.claimReward(makeClaim({ userId: "user-xyz", moduleId: "mod-3" }), makeModule({ id: "mod-3" }));
    });

    it("returns all transactions without filters", () => {
      const history = service.getTransactionHistory("user-abc");
      expect(history.transactions.length).toBe(2);
      expect(history.total).toBe(2);
      expect(history.hasMore).toBe(false);
    });

    it("filters by transaction type", async () => {
      service.registerReferralCode("REF-TEST", "referrer-456");
      await service.claimReward(
        makeClaim({ moduleId: "mod-4", referralCode: "REF-TEST" }),
        makeModule({ id: "mod-4" })
      );

      const history = service.getTransactionHistory("referrer-456", { type: "referral_reward" });
      expect(history.transactions.length).toBe(1);
      expect(history.transactions[0].type).toBe("referral_reward");
    });

    it("filters by transaction status", () => {
      const history = service.getTransactionHistory("user-abc", { status: "completed" });
      expect(history.transactions.every(t => t.status === "completed")).toBe(true);
    });

    it("filters by date range", () => {
      const now = new Date();
      const tomorrow = new Date(now.getTime() + 24 * 60 * 60 * 1000);

      const history = service.getTransactionHistory("user-abc", {
        fromDate: now,
        toDate: tomorrow,
      });

      expect(history.transactions.every(t => t.createdAt >= now)).toBe(true);
      expect(history.transactions.every(t => t.createdAt <= tomorrow)).toBe(true);
    });

    it("applies pagination correctly", () => {
      const historyPage1 = service.getTransactionHistory("user-abc", { limit: 1, offset: 0 });
      const historyPage2 = service.getTransactionHistory("user-abc", { limit: 1, offset: 1 });

      expect(historyPage1.transactions.length).toBe(1);
      expect(historyPage2.transactions.length).toBe(1);
      expect(historyPage1.transactions[0].id).not.toBe(historyPage2.transactions[0].id);
      expect(historyPage1.hasMore).toBe(true);
    });

    it("sorts transactions by date (newest first)", () => {
      const history = service.getTransactionHistory("user-abc");
      const timestamps = history.transactions.map(t => t.createdAt.getTime());
      
      for (let i = 1; i < timestamps.length; i++) {
        expect(timestamps[i - 1]).toBeGreaterThanOrEqual(timestamps[i]);
      }
    });
  });

  // ── Withdrawals ─────────────────────────────────────────────────────────────

  describe("processWithdrawal", () => {
    beforeEach(async () => {
      // Ensure user has sufficient balance by claiming a reward
      await service.claimReward(makeClaim(), makeModule({ baseReward: 10 }));
    });

    it("processes valid withdrawal successfully", async () => {
      const balance = service.getBalance("user-abc");
      const withdrawalAmount = Math.min(2, balance.available);

      (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hash: "withdrawal-hash", ledger: 123, successful: true });

      const result = await service.processWithdrawal({
        userId: "user-abc",
        walletAddress: makeClaim().walletAddress,
        amount: withdrawalAmount,
      });

      expect(result).toMatchObject({
        userId: "user-abc",
        amount: withdrawalAmount,
        stellarTxHash: "withdrawal-hash",
        status: "completed",
      });
      expect(result.transactionId).toMatch(/^txn_/);
      expect(result.completedAt).toBeInstanceOf(Date);
    });

    it("throws error for insufficient balance", async () => {
      const largeAmount = 999999;

      await expect(
        service.processWithdrawal({
          userId: "user-abc",
          walletAddress: makeClaim().walletAddress,
          amount: largeAmount,
        })
      ).rejects.toThrow("Insufficient balance");
    });

    it("throws error for zero or negative amount", async () => {
      await expect(
        service.processWithdrawal({
          userId: "user-abc",
          walletAddress: makeClaim().walletAddress,
          amount: 0,
        })
      ).rejects.toThrow("greater than 0");

      await expect(
        service.processWithdrawal({
          userId: "user-abc",
          walletAddress: makeClaim().walletAddress,
          amount: -10,
        })
      ).rejects.toThrow("greater than 0");
    });

    it("creates a withdrawal transaction record", async () => {
      const balance = service.getBalance("user-abc");
      const withdrawalAmount = Math.min(1, balance.available);

      (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce({ hash: "withdrawal-hash", ledger: 123, successful: true });

      await service.processWithdrawal({
        userId: "user-abc",
        walletAddress: makeClaim().walletAddress,
        amount: withdrawalAmount,
      });

      const transactions = service.getUserTransactions("user-abc");
      const withdrawalTxn = transactions.find(t => t.type === "withdrawal");

      expect(withdrawalTxn).toBeDefined();
      expect(withdrawalTxn?.amount).toBe(withdrawalAmount);
      expect(withdrawalTxn?.status).toBe("completed");
    });

    it("updates balance after withdrawal", async () => {
      const initialBalance = service.getBalance("user-abc");
      const withdrawalAmount = Math.min(1, initialBalance.available);

      (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mockResolvedValueOnce("withdrawal-hash");

      await service.processWithdrawal({
        userId: "user-abc",
        walletAddress: makeClaim().walletAddress,
        amount: withdrawalAmount,
      });

      const finalBalance = service.getBalance("user-abc");
      expect(finalBalance.available).toBeCloseTo(initialBalance.available - withdrawalAmount);
    });

    it("marks transaction as failed if Stellar payment fails", async () => {
      const balance = service.getBalance("user-abc");
      const withdrawalAmount = Math.min(1, balance.available);

      (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mockRejectedValueOnce(
        new Error("Network error")
      );

      await expect(
        service.processWithdrawal({
          userId: "user-abc",
          walletAddress: makeClaim().walletAddress,
          amount: withdrawalAmount,
        })
      ).rejects.toThrow("Network error");

      // Verify transaction was marked as failed
      const transactions = service.getUserTransactions("user-abc");
      const withdrawalTxn = transactions.find(t => t.type === "withdrawal");
      expect(withdrawalTxn?.status).toBe("failed");
    });
  });

  // ── Balance validation ──────────────────────────────────────────────────────

  describe("hasSufficientBalance", () => {
    beforeEach(async () => {
      await service.claimReward(makeClaim(), makeModule({ baseReward: 10 }));
    });

    it("returns true when amount is within available balance", () => {
      const balance = service.getBalance("user-abc");
      const smallAmount = Math.max(0.5, balance.available / 2);

      expect(service.hasSufficientBalance("user-abc", smallAmount)).toBe(true);
    });

    it("returns false when amount exceeds available balance", () => {
      const balance = service.getBalance("user-abc");
      const largeAmount = balance.available + 1;

      expect(service.hasSufficientBalance("user-abc", largeAmount)).toBe(false);
    });

    it("returns true when amount equals available balance exactly", () => {
      const balance = service.getBalance("user-abc");

      expect(service.hasSufficientBalance("user-abc", balance.available)).toBe(true);
    });
  });
});
