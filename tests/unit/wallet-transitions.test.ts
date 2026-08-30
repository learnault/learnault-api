import { describe, expect, it } from 'vitest'
import {
  assertValidWalletTransition,
  canTransitionWallet,
  InvalidWalletTransitionError,
  WALLET_STATUSES,
  WALLET_TRANSITIONS,
} from '../../src/types/wallet-provisioning.types'

describe('wallet status transitions and lifecycle guards', () => {
  it('defines all required statuses', () => {
    expect(WALLET_STATUSES).toEqual([
      'RESERVED',
      'PROVISIONING',
      'RETRYABLE',
      'ACTIVE',
      'EXPORTING',
      'MIGRATED',
      'FAILED',
      'DISABLED',
    ])
  })

  it('allows valid provisioning and lifecycle paths', () => {
    // Normal provisioning flow
    expect(canTransitionWallet('RESERVED', 'PROVISIONING')).toBe(true)
    expect(canTransitionWallet('PROVISIONING', 'ACTIVE')).toBe(true)

    // Retryable failure flow
    expect(canTransitionWallet('PROVISIONING', 'RETRYABLE')).toBe(true)
    expect(canTransitionWallet('RETRYABLE', 'PROVISIONING')).toBe(true)

    // Export and migration flow
    expect(canTransitionWallet('ACTIVE', 'EXPORTING')).toBe(true)
    expect(canTransitionWallet('EXPORTING', 'MIGRATED')).toBe(true)
    expect(canTransitionWallet('EXPORTING', 'ACTIVE')).toBe(true) // aborted/failed export returns to active

    // Disabling and failure recovery
    expect(canTransitionWallet('ACTIVE', 'DISABLED')).toBe(true)
    expect(canTransitionWallet('MIGRATED', 'DISABLED')).toBe(true)
    expect(canTransitionWallet('PROVISIONING', 'FAILED')).toBe(true)
    expect(canTransitionWallet('FAILED', 'RESERVED')).toBe(true)
  })

  it('rejects illegal or out-of-order state transitions', () => {
    // Cannot skip provisioning
    expect(canTransitionWallet('RESERVED', 'ACTIVE')).toBe(false)
    expect(canTransitionWallet('RESERVED', 'MIGRATED')).toBe(false)

    // Cannot transition from terminal DISABLED state
    expect(canTransitionWallet('DISABLED', 'ACTIVE')).toBe(false)
    expect(canTransitionWallet('DISABLED', 'RESERVED')).toBe(false)

    // Cannot jump straight to migrated without export
    expect(canTransitionWallet('ACTIVE', 'MIGRATED')).toBe(false)

    // Self transitions are not permitted
    WALLET_STATUSES.forEach((status) => {
      expect(canTransitionWallet(status, status)).toBe(false)
    })
  })

  it('throws InvalidWalletTransitionError on illegal transitions via assertValidWalletTransition', () => {
    expect(() => assertValidWalletTransition('RESERVED', 'ACTIVE')).toThrow(
      InvalidWalletTransitionError,
    )
    expect(() => assertValidWalletTransition('DISABLED', 'ACTIVE')).toThrow(
      'Cannot transition wallet status from \'DISABLED\' to \'ACTIVE\'',
    )
    expect(() =>
      assertValidWalletTransition('ACTIVE', 'EXPORTING'),
    ).not.toThrow()
  })

  it('has exhaustive transition entries for every status', () => {
    for (const status of WALLET_STATUSES) {
      expect(WALLET_TRANSITIONS).toHaveProperty(status)
      expect(Array.isArray(WALLET_TRANSITIONS[status])).toBe(true)
    }
  })
})
