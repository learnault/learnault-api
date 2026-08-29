import type { TransitionMap } from '../utils/transitions'
import { canTransition } from '../utils/transitions'

export const WALLET_STATUSES = [
  'RESERVED',
  'PROVISIONING',
  'RETRYABLE',
  'ACTIVE',
  'EXPORTING',
  'MIGRATED',
  'FAILED',
  'DISABLED',
] as const

export type WalletStatus = (typeof WALLET_STATUSES)[number]

export const WALLET_TRANSITIONS: TransitionMap<WalletStatus> = {
  RESERVED: ['PROVISIONING', 'FAILED'],
  PROVISIONING: ['ACTIVE', 'RETRYABLE', 'FAILED'],
  RETRYABLE: ['PROVISIONING', 'FAILED'],
  ACTIVE: ['EXPORTING', 'DISABLED'],
  EXPORTING: ['ACTIVE', 'MIGRATED', 'FAILED'],
  MIGRATED: ['DISABLED'],
  FAILED: ['RESERVED'],
  DISABLED: [],
} as const

export function canTransitionWallet(from: WalletStatus, to: WalletStatus): boolean {
  return canTransition(WALLET_TRANSITIONS, from, to)
}

export class InvalidWalletTransitionError extends Error {
  constructor(readonly from: WalletStatus, readonly to: WalletStatus) {
    super(`Cannot transition wallet status from '${from}' to '${to}'`)
    this.name = 'InvalidWalletTransitionError'
  }
}

export function assertValidWalletTransition(from: WalletStatus, to: WalletStatus): void {
  if (!canTransitionWallet(from, to)) {
    throw new InvalidWalletTransitionError(from, to)
  }
}

export const WALLET_JOB_STATUSES = [
  'PENDING',
  'PROCESSING',
  'RETRY',
  'COMPLETED',
  'DEAD_LETTER',
] as const

export type WalletJobStatus = (typeof WALLET_JOB_STATUSES)[number]

export const WALLET_PROVISIONING_FAILURE_CODES = [
  'KEY_GENERATION_FAILED',
  'KMS_UNAVAILABLE',
  'KMS_STORE_UNCERTAIN',
  'DATABASE_FINALIZATION_FAILED',
] as const

export type WalletProvisioningFailureCode =
  (typeof WALLET_PROVISIONING_FAILURE_CODES)[number]

export interface WalletRecord {
  id: string
  userId: string
  network: string
  custody: string
  publicKey: string | null
  status: WalletStatus
  managedKeyReferenceId: string | null
  failureCode: string | null
  attemptCount: number
  provisionedAt: Date | null
  statusChangedAt: Date
  createdAt: Date
  updatedAt: Date
}

export interface WalletProvisioningJobRecord {
  id: string
  walletId: string
  status: WalletJobStatus
  availableAt: Date
  leaseToken: string | null
  leasedUntil: Date | null
  attempts: number
  maxAttempts: number
  lastFailureCode: string | null
  completedAt: Date | null
  createdAt: Date
  updatedAt: Date
}

export interface ClaimedWalletProvisioningJob {
  job: WalletProvisioningJobRecord
  wallet: WalletRecord
}

export interface PublicWallet {
  id: string
  network: string
  custody: string
  publicKey: string | null
  status: WalletStatus
  failureCode: string | null
  createdAt: Date
  updatedAt: Date
}

export function toPublicWallet(wallet: WalletRecord): PublicWallet {
  return {
    id: wallet.id,
    network: wallet.network,
    custody: wallet.custody,
    publicKey: wallet.publicKey,
    status: wallet.status,
    failureCode: wallet.failureCode,
    createdAt: wallet.createdAt,
    updatedAt: wallet.updatedAt,
  }
}

export type WalletEligibilityCode =
  | 'USER_NOT_FOUND'
  | 'USER_NOT_VERIFIED'
  | 'CUSTODIAL_CONSENT_REQUIRED'

export class WalletEligibilityError extends Error {
  constructor(readonly code: WalletEligibilityCode) {
    super(code)
    this.name = 'WalletEligibilityError'
  }
}
