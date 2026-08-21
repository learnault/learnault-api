/**
 * tests/unit/money.test.ts
 *
 * Comprehensive tests for src/utils/money.ts covering:
 *   - Conversion helpers (xlmToStroops, stroopsToXlmString, xlmStringToStroops)
 *   - Legacy float conversion (legacyFloatXlmToStroops)
 *   - Arithmetic helpers (addStroops, subtractStroops, multiplyStroops, clampStroops)
 *   - Boundary and overflow cases
 *   - Rounding correctness
 *   - Error cases
 */

import { describe, it, expect } from 'vitest'
import {
  STROOPS_PER_XLM,
  MAX_STROOPS,
  xlmToStroops,
  stroopsToXlmString,
  xlmStringToStroops,
  legacyFloatXlmToStroops,
  addStroops,
  subtractStroops,
  multiplyStroops,
  clampStroops,
  formatStroops,
  assertInRange,
  isValidStroopAmount,
  MoneyError,
} from '../../src/utils/money'

// ─── Constants ────────────────────────────────────────────────────────────────

describe('Constants', () => {
  it('STROOPS_PER_XLM is 10_000_000', () => {
    expect(STROOPS_PER_XLM).toBe(10_000_000n)
  })

  it('MAX_STROOPS is 10^18', () => {
    expect(MAX_STROOPS).toBe(1_000_000_000_000_000_000n)
  })
})

// ─── xlmToStroops ─────────────────────────────────────────────────────────────

describe('xlmToStroops', () => {
  it('converts 1 XLM to 10_000_000 stroops', () => {
    expect(xlmToStroops(1n)).toBe(10_000_000n)
  })

  it('converts 5 XLM to 50_000_000 stroops', () => {
    expect(xlmToStroops(5n)).toBe(50_000_000n)
  })

  it('converts 0 XLM to 0 stroops', () => {
    expect(xlmToStroops(0n)).toBe(0n)
  })

  it('converts large whole amounts correctly', () => {
    expect(xlmToStroops(100_000_000n)).toBe(100_000_000n * 10_000_000n)
  })

  it('throws MoneyError for negative XLM', () => {
    expect(() => xlmToStroops(-1n)).toThrow(MoneyError)
  })

  it('throws MoneyError when result exceeds MAX_STROOPS', () => {
    // 10^12 XLM → 10^19 stroops > MAX_STROOPS
    expect(() => xlmToStroops(1_000_000_000_000n)).toThrow(MoneyError)
  })
})

// ─── stroopsToXlmString ───────────────────────────────────────────────────────

describe('stroopsToXlmString', () => {
  it('formats 0 stroops as "0.0000000"', () => {
    expect(stroopsToXlmString(0n)).toBe('0.0000000')
  })

  it('formats 1 stroop as "0.0000001"', () => {
    expect(stroopsToXlmString(1n)).toBe('0.0000001')
  })

  it('formats 10_000_000 stroops as "1.0000000"', () => {
    expect(stroopsToXlmString(10_000_000n)).toBe('1.0000000')
  })

  it('formats 50_000_000 stroops as "5.0000000"', () => {
    expect(stroopsToXlmString(50_000_000n)).toBe('5.0000000')
  })

  it('formats 15_000_000 stroops as "1.5000000"', () => {
    expect(stroopsToXlmString(15_000_000n)).toBe('1.5000000')
  })

  it('formats 1 stroop with leading zeros in fraction', () => {
    expect(stroopsToXlmString(100n)).toBe('0.0000100')
  })

  it('formats large amounts correctly', () => {
    // 100_000_000 XLM = 1_000_000_000_000_000 stroops
    expect(stroopsToXlmString(1_000_000_000_000_000n)).toBe(
      '100000000.0000000',
    )
  })

  it('throws MoneyError for negative stroops', () => {
    expect(() => stroopsToXlmString(-1n)).toThrow(MoneyError)
  })

  it('throws MoneyError when exceeding MAX_STROOPS', () => {
    expect(() => stroopsToXlmString(MAX_STROOPS + 1n)).toThrow(MoneyError)
  })
})

// ─── xlmStringToStroops ───────────────────────────────────────────────────────

describe('xlmStringToStroops', () => {
  it('parses "1.0000000" as 10_000_000 stroops', () => {
    expect(xlmStringToStroops('1.0000000')).toBe(10_000_000n)
  })

  it('parses "5.0000000" as 50_000_000 stroops', () => {
    expect(xlmStringToStroops('5.0000000')).toBe(50_000_000n)
  })

  it('parses "0.0000001" as 1 stroop', () => {
    expect(xlmStringToStroops('0.0000001')).toBe(1n)
  })

  it('parses "1.5" as 15_000_000 stroops (pads to 7 decimals)', () => {
    expect(xlmStringToStroops('1.5')).toBe(15_000_000n)
  })

  it('parses "0" as 0 stroops', () => {
    expect(xlmStringToStroops('0')).toBe(0n)
  })

  it('parses "100" (no decimal) as 1_000_000_000 stroops', () => {
    expect(xlmStringToStroops('100')).toBe(1_000_000_000n)
  })

  it('round-trips with stroopsToXlmString', () => {
    const stroops = 75_500_000n // 7.55 XLM
    expect(xlmStringToStroops(stroopsToXlmString(stroops))).toBe(stroops)
  })

  it('throws MoneyError for more than 7 decimal places', () => {
    expect(() => xlmStringToStroops('1.00000001')).toThrow(MoneyError)
  })

  it('throws MoneyError for non-numeric strings', () => {
    expect(() => xlmStringToStroops('abc')).toThrow(MoneyError)
  })

  it('throws MoneyError for empty string', () => {
    expect(() => xlmStringToStroops('')).toThrow(MoneyError)
  })

  it('throws MoneyError for scientific notation', () => {
    expect(() => xlmStringToStroops('1e7')).toThrow(MoneyError)
  })

  it('throws MoneyError for negative value', () => {
    // Note: negative stroops would fail the assertInRange check
    expect(() => xlmStringToStroops('-1.0000000')).toThrow(MoneyError)
  })
})

// ─── legacyFloatXlmToStroops ──────────────────────────────────────────────────

describe('legacyFloatXlmToStroops', () => {
  it('converts 5.0 to 50_000_000 stroops', () => {
    expect(legacyFloatXlmToStroops(5.0)).toBe(50_000_000n)
  })

  it('converts 1.5 to 15_000_000 stroops', () => {
    expect(legacyFloatXlmToStroops(1.5)).toBe(15_000_000n)
  })

  it('converts 7.5 to 75_000_000 stroops', () => {
    expect(legacyFloatXlmToStroops(7.5)).toBe(75_000_000n)
  })

  it('converts 0.0 to 0 stroops', () => {
    expect(legacyFloatXlmToStroops(0.0)).toBe(0n)
  })

  it('rounds 0.00000001 (below 1 stroop) to 0 stroops', () => {
    // 0.00000001 × 10^7 = 0.1 → rounds to 0
    expect(legacyFloatXlmToStroops(0.00000001)).toBe(0n)
  })

  it('rounds 0.00000005 to 1 stroop (round-half-up)', () => {
    // 0.00000005 × 10^7 = 0.5 → rounds to 1 (Math.round)
    expect(legacyFloatXlmToStroops(0.00000005)).toBe(1n)
  })

  it('converts 10.0 correctly', () => {
    expect(legacyFloatXlmToStroops(10.0)).toBe(100_000_000n)
  })

  it('throws MoneyError for NaN', () => {
    expect(() => legacyFloatXlmToStroops(NaN)).toThrow(MoneyError)
  })

  it('throws MoneyError for Infinity', () => {
    expect(() => legacyFloatXlmToStroops(Infinity)).toThrow(MoneyError)
  })

  it('throws MoneyError for -Infinity', () => {
    expect(() => legacyFloatXlmToStroops(-Infinity)).toThrow(MoneyError)
  })

  it('throws MoneyError for negative float', () => {
    expect(() => legacyFloatXlmToStroops(-1.0)).toThrow(MoneyError)
  })

  it('converts legacy difficulty multiplier amounts (7.5 XLM for intermediate)', () => {
    // beginner 5 × 1.5 = 7.5 XLM
    expect(legacyFloatXlmToStroops(7.5)).toBe(75_000_000n)
  })
})

// ─── addStroops ───────────────────────────────────────────────────────────────

describe('addStroops', () => {
  it('adds two stroop values', () => {
    expect(addStroops(10_000_000n, 5_000_000n)).toBe(15_000_000n)
  })

  it('adds zero correctly', () => {
    expect(addStroops(50_000_000n, 0n)).toBe(50_000_000n)
  })

  it('throws MoneyError when sum exceeds MAX_STROOPS', () => {
    const nearMax = MAX_STROOPS - 1n
    expect(() => addStroops(nearMax, 2n)).toThrow(MoneyError)
  })
})

// ─── subtractStroops ──────────────────────────────────────────────────────────

describe('subtractStroops', () => {
  it('subtracts two stroop values', () => {
    expect(subtractStroops(50_000_000n, 10_000_000n)).toBe(40_000_000n)
  })

  it('subtracts to zero', () => {
    expect(subtractStroops(10_000_000n, 10_000_000n)).toBe(0n)
  })

  it('throws MoneyError on underflow (result would be negative)', () => {
    expect(() => subtractStroops(5_000_000n, 10_000_000n)).toThrow(MoneyError)
  })
})

// ─── multiplyStroops ─────────────────────────────────────────────────────────

describe('multiplyStroops', () => {
  it('multiplies by 1/1 (identity)', () => {
    expect(multiplyStroops(50_000_000n, 1n, 1n)).toBe(50_000_000n)
  })

  it('multiplies by 3/2 (1.5× — intermediate tier)', () => {
    expect(multiplyStroops(50_000_000n, 3n, 2n)).toBe(75_000_000n)
  })

  it('multiplies by 2/1 (2× — advanced tier)', () => {
    expect(multiplyStroops(50_000_000n, 2n, 1n)).toBe(100_000_000n)
  })

  it('multiplies by 3/1 (3× — expert tier)', () => {
    expect(multiplyStroops(50_000_000n, 3n, 1n)).toBe(150_000_000n)
  })

  it('uses floor division (no floating-point rounding)', () => {
    // 10_000_001 × 1/3 = 3_333_333.666… → floor → 3_333_333
    expect(multiplyStroops(10_000_001n, 1n, 3n)).toBe(3_333_333n)
  })

  it('multiplies by 1/10 (streak bonus rate)', () => {
    expect(multiplyStroops(50_000_000n, 1n, 10n)).toBe(5_000_000n)
  })

  it('throws MoneyError on divide by zero', () => {
    expect(() => multiplyStroops(50_000_000n, 1n, 0n)).toThrow(MoneyError)
  })

  it('throws MoneyError when result exceeds MAX_STROOPS', () => {
    expect(() => multiplyStroops(MAX_STROOPS, 2n, 1n)).toThrow(MoneyError)
  })
})

// ─── clampStroops ─────────────────────────────────────────────────────────────

describe('clampStroops', () => {
  it('returns value unchanged when below max', () => {
    expect(clampStroops(10_000_000n, 50_000_000n)).toBe(10_000_000n)
  })

  it('returns max when value exceeds max', () => {
    expect(clampStroops(100_000_000n, 50_000_000n)).toBe(50_000_000n)
  })

  it('returns max when value equals max', () => {
    expect(clampStroops(50_000_000n, 50_000_000n)).toBe(50_000_000n)
  })

  it('clamps negative input to 0', () => {
    expect(clampStroops(-1n, 50_000_000n)).toBe(0n)
  })

  it('caps streak bonus at 100% of base (10+ streak days)', () => {
    const base = 50_000_000n // 5 XLM
    // 20 days × 10% = 200% uncapped
    const uncapped = multiplyStroops(base, 20n, 10n)
    const max = base
    expect(clampStroops(uncapped, max)).toBe(base)
  })
})

// ─── formatStroops ────────────────────────────────────────────────────────────

describe('formatStroops', () => {
  it('formats with default "XLM" label', () => {
    expect(formatStroops(50_000_000n)).toBe('5.0000000 XLM')
  })

  it('formats with a custom asset code', () => {
    expect(formatStroops(10_000_000n, 'USDC')).toBe('1.0000000 USDC')
  })

  it('formats 0 stroops', () => {
    expect(formatStroops(0n)).toBe('0.0000000 XLM')
  })
})

// ─── assertInRange ────────────────────────────────────────────────────────────

describe('assertInRange', () => {
  it('does not throw for 0', () => {
    expect(() => assertInRange(0n)).not.toThrow()
  })

  it('does not throw for MAX_STROOPS', () => {
    expect(() => assertInRange(MAX_STROOPS)).not.toThrow()
  })

  it('throws MoneyError for a negative value', () => {
    expect(() => assertInRange(-1n)).toThrow(MoneyError)
  })

  it('throws MoneyError for MAX_STROOPS + 1', () => {
    expect(() => assertInRange(MAX_STROOPS + 1n)).toThrow(MoneyError)
  })
})

// ─── isValidStroopAmount ──────────────────────────────────────────────────────

describe('isValidStroopAmount', () => {
  it('returns true for 0n', () => {
    expect(isValidStroopAmount(0n)).toBe(true)
  })

  it('returns true for a positive bigint', () => {
    expect(isValidStroopAmount(50_000_000n)).toBe(true)
  })

  it('returns true for MAX_STROOPS', () => {
    expect(isValidStroopAmount(MAX_STROOPS)).toBe(true)
  })

  it('returns false for a negative bigint', () => {
    expect(isValidStroopAmount(-1n)).toBe(false)
  })

  it('returns false for MAX_STROOPS + 1', () => {
    expect(isValidStroopAmount(MAX_STROOPS + 1n)).toBe(false)
  })

  it('returns false for a plain number', () => {
    expect(isValidStroopAmount(5)).toBe(false)
  })

  it('returns false for a string', () => {
    expect(isValidStroopAmount('5')).toBe(false)
  })

  it('returns false for null', () => {
    expect(isValidStroopAmount(null)).toBe(false)
  })

  it('returns false for undefined', () => {
    expect(isValidStroopAmount(undefined)).toBe(false)
  })
})

// ─── Integration: reward amounts by difficulty ────────────────────────────────

describe('reward arithmetic integration', () => {
  const BASE = 50_000_000n // 5 XLM for beginner

  it.each([
    ['beginner',     [1n, 1n] as [bigint, bigint], 50_000_000n],   // 5 XLM
    ['intermediate', [3n, 2n] as [bigint, bigint], 75_000_000n],   // 7.5 XLM
    ['advanced',     [2n, 1n] as [bigint, bigint], 100_000_000n],  // 10 XLM
    ['expert',       [3n, 1n] as [bigint, bigint], 150_000_000n],  // 15 XLM
  ])('%s: multiplyStroops(%s, [%s]) === %s stroops',
    (_diff, [num, den], expected) => {
      expect(multiplyStroops(BASE, num, den)).toBe(expected)
    },
  )

  it('streak bonus for 3 days at beginner (5 XLM base) is 1.5 XLM', () => {
    // 5 XLM × 3 × (1/10) = 1.5 XLM = 15_000_000 stroops
    const streakBonus = multiplyStroops(BASE, 3n * 1n, 10n)
    expect(streakBonus).toBe(15_000_000n)
  })

  it('streak bonus is capped at 100% of base (5 XLM max bonus for beginner)', () => {
    const uncapped = multiplyStroops(BASE, 20n * 1n, 10n) // 200%
    const capped = clampStroops(uncapped, BASE)
    expect(capped).toBe(BASE)
    expect(stroopsToXlmString(capped)).toBe('5.0000000')
  })

  it('total reward (beginner, 5-day streak, referral) is exactly correct', () => {
    // base = 5 XLM
    const base = multiplyStroops(BASE, 1n, 1n)
    // streak = 5 × 10% × 5 XLM = 2.5 XLM
    const streak = clampStroops(multiplyStroops(base, 5n, 10n), base)
    // referral = 2 XLM
    const referral = 20_000_000n
    const total = addStroops(addStroops(base, streak), referral)

    expect(stroopsToXlmString(total)).toBe('9.5000000') // 5 + 2.5 + 2
  })
})
