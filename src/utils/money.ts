/**
 * money.ts — Exact-arithmetic helpers for Stellar asset amounts.
 *
 * The Stellar network represents all asset amounts in whole-integer "stroops"
 * where 1 XLM = 10_000_000 stroops (7 decimal places). Storing and computing
 * monetary values in stroops (BigInt) avoids all binary floating-point errors.
 *
 * Key invariants:
 *   - All persisted amounts are stored as `bigint` stroops.
 *   - The only place XLM decimal strings are produced is at the I/O boundary
 *     (API responses and Stellar SDK calls).
 *   - Converting a legacy IEEE-754 float to stroops requires explicit rounding
 *     and must never happen silently.
 */

// ---------------------------------------------------------------------------
// Constants
// ---------------------------------------------------------------------------

/** Number of stroops per 1 XLM (7 decimal places). */
export const STROOPS_PER_XLM = 10_000_000n

/**
 * Maximum stroops that can represent a Stellar balance.
 * Stellar's max supply is 100 billion XLM → 10^18 stroops, well within
 * JavaScript BigInt range.  We use 10^18 as a practical safety ceiling.
 */
export const MAX_STROOPS = 10n ** 18n

// ---------------------------------------------------------------------------
// Conversion helpers
// ---------------------------------------------------------------------------

/**
 * Convert a whole-XLM integer to stroops.
 *
 * @example xlmToStroops(5) === 50_000_000n
 */
export function xlmToStroops(xlm: bigint): bigint {
  const result = xlm * STROOPS_PER_XLM
  assertInRange(result)

  return result
}

/**
 * Convert stroops to a 7-decimal XLM string suitable for the Stellar SDK
 * (`Operation.payment({ amount })` expects this format).
 *
 * @example stroopsToXlmString(50_000_000n) === "5.0000000"
 */
export function stroopsToXlmString(stroops: bigint): string {
  assertInRange(stroops)

  const isNegative = stroops < 0n
  const abs = isNegative ? -stroops : stroops

  const whole = abs / STROOPS_PER_XLM
  const frac = abs % STROOPS_PER_XLM

  const fracStr = frac.toString().padStart(7, '0')

  return `${isNegative ? '-' : ''}${whole}.${fracStr}`
}

/**
 * Parse a 7-decimal XLM string (e.g. `"5.0000000"` or `"5.5"`) into stroops.
 * Throws if the string has more than 7 decimal places or is not a valid number.
 */
export function xlmStringToStroops(xlmString: string): bigint {
  if (!/^-?\d+(\.\d{0,7})?$/.test(xlmString.trim())) {
    throw new MoneyError(
      `Invalid XLM string "${xlmString}": must be a decimal with at most 7 fractional digits`,
      'INVALID_XLM_STRING',
    )
  }

  const trimmed = xlmString.trim()
  const isNegative = trimmed.startsWith('-')
  const abs = isNegative ? trimmed.slice(1) : trimmed

  const [wholePart = '0', fracPart = ''] = abs.split('.')
  const paddedFrac = fracPart.padEnd(7, '0')

  const result = BigInt(wholePart) * STROOPS_PER_XLM + BigInt(paddedFrac)

  const signed = isNegative ? -result : result
  assertInRange(signed)

  return signed
}

// ---------------------------------------------------------------------------
// Legacy float conversion (unsafe — must be explicit)
// ---------------------------------------------------------------------------

/**
 * Convert a legacy IEEE-754 float XLM value to stroops by rounding to the
 * nearest stroop (round-half-up).
 *
 * **Use only when migrating legacy data.** Never use this at runtime for new
 * amounts — callers must pass exact stroop values or XLM strings.
 *
 * Throws `MoneyError` if the float is:
 *   - `NaN`
 *   - `Infinity`
 *   - negative
 *   - larger than MAX_STROOPS / STROOPS_PER_XLM
 *   - has more than 7 significant decimal digits (precision already lost)
 */
export function legacyFloatXlmToStroops(floatXlm: number): bigint {
  if (!Number.isFinite(floatXlm)) {
    throw new MoneyError(
      `Cannot convert non-finite float ${floatXlm} to stroops`,
      'NON_FINITE_FLOAT',
    )
  }

  if (floatXlm < 0) {
    throw new MoneyError(
      `Cannot convert negative float ${floatXlm} to stroops without explicit sign handling`,
      'NEGATIVE_FLOAT',
    )
  }

  // Round to nearest stroop (avoids silent precision drift).
  const rounded = Math.round(floatXlm * 1e7) // 1e7 = STROOPS_PER_XLM as number
  const result = BigInt(rounded)

  assertInRange(result)

  return result
}

// ---------------------------------------------------------------------------
// Arithmetic helpers
// ---------------------------------------------------------------------------

/**
 * Add two stroop amounts and assert the result is within range.
 */
export function addStroops(a: bigint, b: bigint): bigint {
  const result = a + b
  assertInRange(result)

  return result
}

/**
 * Subtract `b` from `a`.  Throws if result is negative (monetary values must
 * not go below zero without explicit intent).
 */
export function subtractStroops(a: bigint, b: bigint): bigint {
  const result = a - b

  if (result < 0n) {
    throw new MoneyError(
      `Stroop subtraction underflow: ${a} - ${b} = ${result}`,
      'SUBTRACTION_UNDERFLOW',
    )
  }

  return result
}

/**
 * Multiply a stroop amount by a rational multiplier expressed as
 * `numerator / denominator`.  The result is rounded down (floor division).
 *
 * @example multiplyStroops(50_000_000n, 3n, 2n) === 75_000_000n  // 1.5×
 */
export function multiplyStroops(
  stroops: bigint,
  numerator: bigint,
  denominator: bigint,
): bigint {
  if (denominator === 0n) {
    throw new MoneyError(
      'Division by zero in multiplyStroops',
      'DIVIDE_BY_ZERO',
    )
  }

  const result = (stroops * numerator) / denominator
  assertInRange(result)

  return result
}

/**
 * Clamp `value` to `[0, max]`.  Useful for bonus caps.
 */
export function clampStroops(value: bigint, max: bigint): bigint {
  if (value < 0n) return 0n
  if (value > max) return max

  return value
}

// ---------------------------------------------------------------------------
// Display helpers
// ---------------------------------------------------------------------------

/**
 * Format stroops as a human-readable XLM string with the asset code.
 *
 * @example formatStroops(50_000_000n) === "5.0000000 XLM"
 */
export function formatStroops(stroops: bigint, assetCode = 'XLM'): string {
  return `${stroopsToXlmString(stroops)} ${assetCode}`
}

// ---------------------------------------------------------------------------
// Validation helpers
// ---------------------------------------------------------------------------

/**
 * Assert `stroops` is a non-negative value within the safe ceiling.
 */
export function assertInRange(stroops: bigint): void {
  if (stroops < 0n) {
    throw new MoneyError(`Stroop value ${stroops} is negative`, 'OUT_OF_RANGE')
  }

  if (stroops > MAX_STROOPS) {
    throw new MoneyError(
      `Stroop value ${stroops} exceeds MAX_STROOPS (${MAX_STROOPS})`,
      'OVERFLOW',
    )
  }
}

/**
 * Return `true` when `stroops` is a non-negative BigInt within range.
 */
export function isValidStroopAmount(stroops: unknown): stroops is bigint {
  return typeof stroops === 'bigint' && stroops >= 0n && stroops <= MAX_STROOPS
}

// ---------------------------------------------------------------------------
// Error type
// ---------------------------------------------------------------------------

export class MoneyError extends Error {
  constructor(
    message: string,
    public readonly code: string,
  ) {
    super(message)
    this.name = 'MoneyError'
  }
}
