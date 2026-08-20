import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import {
  isStrongPassword,
  hashPassword,
  comparePassword,
  currentHashCost,
  needsRehash,
  getConfiguredSaltRounds,
} from '../../src/utils/password'

describe('isStrongPassword', () => {
  it('accepts a password with upper, lower, number, and symbol', () => {
    expect(isStrongPassword('Str0ng!Pass')).toBe(true)
  })

  it.each<[string, boolean]>([
    ['Short1!', false], // 7 chars — below the minimum length
    ['alllowercase1!', false],
    ['ALLUPPERCASE1!', false],
    ['NoNumbers!', false],
    ['NoSymbols123', false],
    ['Ab1!', false], // too short
  ])('rejects %s', (candidate, expected) => {
    expect(isStrongPassword(candidate)).toBe(expected)
  })
})

describe('getConfiguredSaltRounds', () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllEnvs())

  it('defaults to 12 when unset', () => {
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '')
    expect(getConfiguredSaltRounds()).toBe(12)
  })

  it('honors a valid configured value', () => {
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '13')
    expect(getConfiguredSaltRounds()).toBe(13)
  })

  it('falls back to 12 for an out-of-range value', () => {
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '99')
    expect(getConfiguredSaltRounds()).toBe(12)
  })
})

describe('hashPassword / comparePassword', () => {
  it('round-trips: a hash verifies against its own plaintext', async () => {
    const hash = await hashPassword('Str0ng!Pass', 10)

    await expect(comparePassword('Str0ng!Pass', hash)).resolves.toBe(true)
    await expect(comparePassword('wrong', hash)).resolves.toBe(false)
  })
})

describe('currentHashCost / needsRehash', () => {
  beforeEach(() => vi.unstubAllEnvs())
  afterEach(() => vi.unstubAllEnvs())

  it('reads the cost factor embedded in a bcrypt hash', async () => {
    const hash = await hashPassword('Str0ng!Pass', 10)

    expect(currentHashCost(hash)).toBe(10)
  })

  it('returns null for a non-bcrypt string', () => {
    expect(currentHashCost('not-a-hash')).toBeNull()
  })

  it('flags a hash below the configured cost as needing a rehash', async () => {
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '12')
    const weakHash = await hashPassword('Str0ng!Pass', 10)

    expect(needsRehash(weakHash)).toBe(true)
  })

  it('does not flag a hash at or above the configured cost', async () => {
    vi.stubEnv('BCRYPT_SALT_ROUNDS', '10')
    const currentHash = await hashPassword('Str0ng!Pass', 10)

    expect(needsRehash(currentHash)).toBe(false)
  })
})
