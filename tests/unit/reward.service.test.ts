import { describe, it, expect, vi, beforeEach } from 'vitest'
import {
  RewardService,
  DIFFICULTY_MULTIPLIERS,
  BASE_REWARD_STROOPS,
  REFERRAL_BONUS_STROOPS,
  STREAK_BONUS_RATE,
  MAX_STREAK_BONUS,
  Module,
  RewardClaim,
} from '../../src/services/reward.service'
import { StellarService } from '../../src/services/stellar.service'
import { stroopsToXlmString } from '../../src/utils/money'

// ─── Helpers ──────────────────────────────────────────────────────────────────

const makeModule = (overrides: Partial<Module> = {}): Module => ({
  id: 'mod-001',
  title: 'Intro to Stellar',
  difficulty: 'beginner',
  baseRewardStroops: BASE_REWARD_STROOPS, // 5 XLM = 50_000_000 stroops
  ...overrides,
})

const makeClaim = (overrides: Partial<RewardClaim> = {}): RewardClaim => ({
  userId: 'user-abc',
  moduleId: 'mod-001',
  walletAddress: 'GABC1234567890123456789012345678901234567890123456789',
  streakDays: 0,
  ...overrides,
})

const MOCK_TX_HASH = 'abc123stellar'

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('RewardService', () => {
  let stellarMock: StellarService
  let service: RewardService

  beforeEach(() => {
    stellarMock = {
      sendPayment: vi.fn().mockResolvedValue({
        hash: MOCK_TX_HASH,
        ledger: 123,
        successful: true,
      }),
      verifyTransaction: vi.fn().mockResolvedValue(true),
    } as unknown as StellarService

    service = new RewardService(stellarMock)
    service._resetState()
  })

  // ── calculateReward – base amounts by difficulty ───────────────────────────

  describe('calculateReward – base amounts by difficulty', () => {
    it.each([
      ['beginner', 50_000_000n], // 5 XLM
      ['intermediate', 75_000_000n], // 7.5 XLM
      ['advanced', 100_000_000n], // 10 XLM
      ['expert', 150_000_000n], // 15 XLM
    ] as const)(
      '%s difficulty yields correct stroops',
      (difficulty, expected) => {
        const { baseAmountStroops } = service.calculateReward(
          makeModule({ difficulty }),
        )
        expect(baseAmountStroops).toBe(expected)
      },
    )

    it('applies the correct multiplier from DIFFICULTY_MULTIPLIERS', () => {
      for (const [diff, [num, den]] of Object.entries(DIFFICULTY_MULTIPLIERS)) {
        const mod = makeModule({ difficulty: diff as Module['difficulty'] })
        const { baseAmountStroops } = service.calculateReward(mod)
        const expected = (BASE_REWARD_STROOPS * num) / den
        expect(baseAmountStroops).toBe(expected)
      }
    })
  })

  // ── calculateReward – streak bonus ─────────────────────────────────────────

  describe('calculateReward – streak bonus', () => {
    it('returns 0 streak bonus with 0 streak days', () => {
      const { streakBonusStroops } = service.calculateReward(makeModule(), 0)
      expect(streakBonusStroops).toBe(0n)
    })

    it('applies 10% bonus per streak day', () => {
      // beginner base = 50_000_000 stroops (5 XLM)
      // 3 days × 10% × 5 XLM = 1.5 XLM = 15_000_000 stroops
      const { streakBonusStroops } = service.calculateReward(makeModule(), 3)
      expect(streakBonusStroops).toBe(15_000_000n)
    })

    it('caps streak bonus at 100% of base', () => {
      // 20 days would be 200% without cap
      const { streakBonusStroops, baseAmountStroops } = service.calculateReward(
        makeModule(),
        20,
      )
      expect(streakBonusStroops).toBe(baseAmountStroops) // capped at 100%
    })

    it('streak bonus is included in totalAmountStroops', () => {
      const { baseAmountStroops, streakBonusStroops, totalAmountStroops } =
        service.calculateReward(makeModule(), 5)
      expect(totalAmountStroops).toBe(baseAmountStroops + streakBonusStroops)
    })

    it('streak bonus for 5-day streak at beginner is 2.5 XLM (25_000_000 stroops)', () => {
      const { streakBonusStroops } = service.calculateReward(makeModule(), 5)
      expect(streakBonusStroops).toBe(25_000_000n)
    })
  })

  // ── calculateReward – referral bonus ───────────────────────────────────────

  describe('calculateReward – referral bonus', () => {
    it('adds REFERRAL_BONUS_STROOPS when hasReferral is true', () => {
      const { referralBonusStroops } = service.calculateReward(
        makeModule(),
        0,
        true,
      )
      expect(referralBonusStroops).toBe(REFERRAL_BONUS_STROOPS) // 20_000_000n (2 XLM)
    })

    it('adds no referral bonus when hasReferral is false', () => {
      const { referralBonusStroops } = service.calculateReward(
        makeModule(),
        0,
        false,
      )
      expect(referralBonusStroops).toBe(0n)
    })

    it('totalAmountStroops includes base + streak + referral', () => {
      const {
        baseAmountStroops,
        streakBonusStroops,
        referralBonusStroops,
        totalAmountStroops,
      } = service.calculateReward(makeModule(), 3, true)
      expect(totalAmountStroops).toBe(
        baseAmountStroops + streakBonusStroops + referralBonusStroops,
      )
    })
  })

  // ── claimReward – happy path ────────────────────────────────────────────────

  describe('claimReward – happy path', () => {
    it('returns a result with correct shape', async () => {
      const module = makeModule()
      const claim = makeClaim()
      const result = await service.claimReward(claim, module)

      expect(result).toMatchObject({
        userId: claim.userId,
        moduleId: claim.moduleId,
        stellarTxHash: MOCK_TX_HASH,
      })
      expect(result.transactionId).toMatch(/^txn_/)
      expect(result.claimedAt).toBeInstanceOf(Date)
      // All amounts are BigInt
      expect(typeof result.baseAmountStroops).toBe('bigint')
      expect(typeof result.totalAmountStroops).toBe('bigint')
    })

    it('calls Stellar sendPayment with 7-decimal XLM string (not a number)', async () => {
      const module = makeModule({ difficulty: 'advanced' })
      const claim = makeClaim({ streakDays: 2 })
      await service.claimReward(claim, module)

      const { totalAmountStroops } = service.calculateReward(module, 2, false)
      expect(stellarMock.sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          destinationPublicKey: claim.walletAddress,
          // Amount must be a 7-decimal XLM string — never a number
          amount: stroopsToXlmString(totalAmountStroops),
          memo: expect.stringContaining(claim.moduleId),
        }),
      )
    })

    it('the amount passed to sendPayment is a string', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const call = (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mock
        .calls[0][0]
      expect(typeof call.amount).toBe('string')
    })

    it('records a transaction after successful claim', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const txns = service.getUserTransactions('user-abc')
      expect(txns).toHaveLength(1)
      expect(txns[0].type).toBe('module_reward')
    })

    it('recorded transaction amount is a bigint', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const [txn] = service.getUserTransactions('user-abc')
      expect(typeof txn.amountStroops).toBe('bigint')
    })
  })

  // ── claimReward – double-claim prevention ──────────────────────────────────

  describe('claimReward – double-claim prevention', () => {
    it('throws when the same user claims the same module twice', async () => {
      const module = makeModule()
      const claim = makeClaim()

      await service.claimReward(claim, module)

      await expect(service.claimReward(claim, module)).rejects.toThrow(
        /already claimed/i,
      )
    })

    it('allows the same user to claim a different module', async () => {
      await service.claimReward(
        makeClaim({ moduleId: 'mod-001' }),
        makeModule({ id: 'mod-001' }),
      )
      const result = await service.claimReward(
        makeClaim({ moduleId: 'mod-002' }),
        makeModule({ id: 'mod-002' }),
      )
      expect(result.moduleId).toBe('mod-002')
    })

    it('hasAlreadyClaimed returns true after claiming', async () => {
      await service.claimReward(makeClaim(), makeModule())
      expect(service.hasAlreadyClaimed('user-abc', 'mod-001')).toBe(true)
    })

    it('hasAlreadyClaimed returns false before claiming', () => {
      expect(service.hasAlreadyClaimed('user-abc', 'mod-001')).toBe(false)
    })
  })

  // ── Streak bonus in claim ──────────────────────────────────────────────────

  describe('claimReward – streak bonus integration', () => {
    it('includes streak bonus in the result', async () => {
      const module = makeModule()
      const claim = makeClaim({ streakDays: 5 })
      const result = await service.claimReward(claim, module)
      expect(result.streakBonusStroops).toBeGreaterThan(0n)
    })

    it('passes correct totalAmountStroops (with streak) to Stellar as XLM string', async () => {
      const module = makeModule()
      const claim = makeClaim({ streakDays: 5 })
      await service.claimReward(claim, module)

      const { totalAmountStroops } = service.calculateReward(module, 5, false)
      expect(stellarMock.sendPayment).toHaveBeenCalledWith(
        expect.objectContaining({
          amount: stroopsToXlmString(totalAmountStroops),
        }),
      )
    })
  })

  // ── Referral rewards ───────────────────────────────────────────────────────

  describe('claimReward – referral rewards', () => {
    const REFERRAL_CODE = 'REF-XYZ'
    const REFERRER_ID = 'user-referrer'

    beforeEach(() => {
      service.registerReferralCode(REFERRAL_CODE, REFERRER_ID)
    })

    it('pays the learner a reward when a valid referral code is used', async () => {
      const claim = makeClaim({ referralCode: REFERRAL_CODE })
      await service.claimReward(claim, makeModule())

      // Currently only learner payment is made (referral bonus skipped — no wallet storage yet)
      expect(stellarMock.sendPayment).toHaveBeenCalledTimes(1)
    })

    it('records a module_reward transaction for the learner', async () => {
      const claim = makeClaim({ referralCode: REFERRAL_CODE })
      await service.claimReward(claim, makeModule())

      const txns = service.getUserTransactions(claim.userId)
      expect(txns).toHaveLength(1)
      expect(txns[0].type).toBe('module_reward')
    })

    it('does not pay referral bonus for an unknown referral code', async () => {
      const claim = makeClaim({ referralCode: 'UNKNOWN' })
      await service.claimReward(claim, makeModule())

      expect(stellarMock.sendPayment).toHaveBeenCalledTimes(1)
    })

    it('still completes learner reward even if referral is skipped', async () => {
      const claim = makeClaim({ referralCode: REFERRAL_CODE })
      const result = await service.claimReward(claim, makeModule())

      expect(result.stellarTxHash).toBe(MOCK_TX_HASH)
    })
  })

  // ── registerReferralCode ───────────────────────────────────────────────────

  describe('registerReferralCode', () => {
    it('registers a new code without throwing', () => {
      expect(() =>
        service.registerReferralCode('NEW-CODE', 'user-1'),
      ).not.toThrow()
    })

    it('throws when a code is already registered', () => {
      service.registerReferralCode('DUP-CODE', 'user-1')
      expect(() => service.registerReferralCode('DUP-CODE', 'user-2')).toThrow(
        /already in use/i,
      )
    })
  })

  // ── Transaction records ────────────────────────────────────────────────────

  describe('transaction records', () => {
    it('getTransactions returns all transactions', async () => {
      await service.claimReward(
        makeClaim({ moduleId: 'mod-001' }),
        makeModule({ id: 'mod-001' }),
      )
      await service.claimReward(
        makeClaim({ userId: 'user-xyz', moduleId: 'mod-002' }),
        makeModule({ id: 'mod-002' }),
      )
      expect(service.getTransactions()).toHaveLength(2)
    })

    it('getUserTransactions filters by userId', async () => {
      await service.claimReward(
        makeClaim({ userId: 'user-a', moduleId: 'mod-001' }),
        makeModule({ id: 'mod-001' }),
      )
      await service.claimReward(
        makeClaim({ userId: 'user-b', moduleId: 'mod-002' }),
        makeModule({ id: 'mod-002' }),
      )

      const txns = service.getUserTransactions('user-a')
      expect(txns).toHaveLength(1)
      expect(txns[0].userId).toBe('user-a')
    })

    it('each transaction has a unique id', async () => {
      await service.claimReward(
        makeClaim({ userId: 'u1', moduleId: 'mod-001' }),
        makeModule({ id: 'mod-001' }),
      )
      await service.claimReward(
        makeClaim({ userId: 'u2', moduleId: 'mod-002' }),
        makeModule({ id: 'mod-002' }),
      )

      const ids = service.getTransactions().map((t) => t.id)
      expect(new Set(ids).size).toBe(ids.length)
    })

    it('transaction includes the Stellar tx hash', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const [txn] = service.getTransactions()
      expect(txn.stellarTxHash).toBe(MOCK_TX_HASH)
    })
  })

  // ── getBalance ────────────────────────────────────────────────────────────

  describe('getBalance', () => {
    it('returns zero balances for a user with no transactions', () => {
      const balance = service.getBalance('user-new')
      expect(balance.availableStroops).toBe(0n)
      expect(balance.pendingStroops).toBe(0n)
      expect(balance.lifetimeStroops).toBe(0n)
    })

    it('lifetimeStroops increases after a reward claim', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')
      expect(balance.lifetimeStroops).toBeGreaterThan(0n)
    })

    it('all balance amounts are BigInt', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')
      expect(typeof balance.availableStroops).toBe('bigint')
      expect(typeof balance.pendingStroops).toBe('bigint')
      expect(typeof balance.lifetimeStroops).toBe('bigint')
    })

    it('available equals lifetime when no withdrawals', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')
      expect(balance.availableStroops).toBe(balance.lifetimeStroops)
    })
  })

  // ── hasSufficientBalance ──────────────────────────────────────────────────

  describe('hasSufficientBalance', () => {
    it('returns false for a user with no balance', () => {
      expect(service.hasSufficientBalance('user-empty', 10_000_000n)).toBe(
        false,
      )
    })

    it('returns true after earning a reward and requesting ≤ available', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')
      expect(
        service.hasSufficientBalance('user-abc', balance.availableStroops),
      ).toBe(true)
    })

    it('returns false when requesting more than available', async () => {
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')
      expect(
        service.hasSufficientBalance('user-abc', balance.availableStroops + 1n),
      ).toBe(false)
    })
  })

  // ── processWithdrawal ─────────────────────────────────────────────────────

  describe('processWithdrawal', () => {
    const WALLET = 'GABC1234567890123456789012345678901234567890123456789'

    it('throws when amount is 0', async () => {
      await expect(
        service.processWithdrawal({
          userId: 'user-abc',
          walletAddress: WALLET,
          amountStroops: 0n,
        }),
      ).rejects.toThrow(/greater than 0/)
    })

    it('throws when user has insufficient balance', async () => {
      await expect(
        service.processWithdrawal({
          userId: 'user-abc',
          walletAddress: WALLET,
          amountStroops: 10_000_000n, // 1 XLM — no balance
        }),
      ).rejects.toThrow(/insufficient balance/i)
    })

    it('sends XLM string (not a number) to Stellar for withdrawal', async () => {
      // Fund the account first
      await service.claimReward(makeClaim(), makeModule())
      const balance = service.getBalance('user-abc')

      await service.processWithdrawal({
        userId: 'user-abc',
        walletAddress: WALLET,
        amountStroops: balance.availableStroops,
      })

      // The second call is the withdrawal
      const calls = (stellarMock.sendPayment as ReturnType<typeof vi.fn>).mock
        .calls
      const withdrawalCall = calls[calls.length - 1][0]
      expect(typeof withdrawalCall.amount).toBe('string')
      expect(withdrawalCall.amount).toBe(
        stroopsToXlmString(balance.availableStroops),
      )
    })
  })
})

// ─── Numeric constants (kept for display / backward-compat) ──────────────────

describe('numeric display constants', () => {
  it('BASE_REWARD_XLM is 5 (numeric display value)', async () => {
    const { BASE_REWARD_XLM } =
      await import('../../src/services/reward.service')
    expect(BASE_REWARD_XLM).toBe(5)
  })

  it('REFERRAL_BONUS_XLM is 2 (numeric display value)', async () => {
    const { REFERRAL_BONUS_XLM } =
      await import('../../src/services/reward.service')
    expect(REFERRAL_BONUS_XLM).toBe(2)
  })

  it('STREAK_BONUS_RATE is 0.1 (numeric display value)', () => {
    expect(STREAK_BONUS_RATE).toBe(0.1)
  })

  it('MAX_STREAK_BONUS is 1.0 (numeric display value)', () => {
    expect(MAX_STREAK_BONUS).toBe(1.0)
  })
})
