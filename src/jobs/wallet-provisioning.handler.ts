import type {
  KmsSecretStore,
  StoredStellarKey,
} from '../services/kms/kms-secret-store'
import type { StellarKeypairGenerator } from '../services/stellar-keypair.adapter'
import type { WalletProvisioningRepository } from '../services/wallet-provisioning.repository'
import type {
  ClaimedWalletProvisioningJob,
  WalletProvisioningFailureCode,
} from '../types/wallet-provisioning.types'

export type WalletProvisioningHandleResult =
  | { kind: 'idle' }
  | { kind: 'completed'; walletId: string; publicKey: string }
  | {
      kind: 'retry-scheduled'
      walletId: string
      failureCode: WalletProvisioningFailureCode
    }
  | {
      kind: 'dead-letter'
      walletId: string
      failureCode: WalletProvisioningFailureCode
    }

export interface WalletProvisioningHandlerOptions {
  leaseMs?: number
  baseRetryMs?: number
  now?: () => Date
}

/** Durable outbox/job handler for one idempotent wallet provisioning attempt. */
export class WalletProvisioningOutboxHandler {
  private readonly leaseMs: number
  private readonly baseRetryMs: number
  private readonly now: () => Date

  constructor(
    private readonly repository: WalletProvisioningRepository,
    private readonly kms: KmsSecretStore,
    private readonly keypairGenerator: StellarKeypairGenerator,
    options: WalletProvisioningHandlerOptions = {},
  ) {
    this.leaseMs = options.leaseMs ?? 60_000
    this.baseRetryMs = options.baseRetryMs ?? 1_000
    this.now = options.now ?? (() => new Date())
  }

  async handleNext(): Promise<WalletProvisioningHandleResult> {
    const claimed = await this.repository.claimNext(this.now(), this.leaseMs)

    return this.handleClaimed(claimed)
  }

  async handleWallet(
    walletId: string,
  ): Promise<WalletProvisioningHandleResult> {
    const claimed = await this.repository.claimByWalletId(
      walletId,
      this.now(),
      this.leaseMs,
    )

    return this.handleClaimed(claimed)
  }

  private async handleClaimed(
    claimed: ClaimedWalletProvisioningJob | null,
  ): Promise<WalletProvisioningHandleResult> {
    if (!claimed) return { kind: 'idle' }

    const leaseToken = claimed.job.leaseToken
    if (!leaseToken) {
      return this.fail(claimed, 'DATABASE_FINALIZATION_FAILED')
    }

    let material: StoredStellarKey | null
    try {
      material = await this.kms.findByIdempotencyKey(claimed.wallet.id)
    } catch {
      return this.fail(claimed, 'KMS_UNAVAILABLE')
    }

    if (!material) {
      let generated
      try {
        generated = this.keypairGenerator.generate()
      } catch {
        return this.fail(claimed, 'KEY_GENERATION_FAILED')
      }

      try {
        material = await this.kms.storeStellarSecret({
          idempotencyKey: claimed.wallet.id,
          publicKey: generated.publicKey,
          secret: generated.secret,
        })
      } catch {
        // The write may have committed before the provider response was lost.
        // A deterministic lookup repairs that ambiguity without a second keypair.
        try {
          material = await this.kms.findByIdempotencyKey(claimed.wallet.id)
        } catch {
          material = null
        }
        if (!material) return this.fail(claimed, 'KMS_STORE_UNCERTAIN')
      }
    }

    try {
      const wallet = await this.repository.complete(
        claimed.wallet.id,
        leaseToken,
        material,
        this.now(),
      )

      return {
        kind: 'completed',
        walletId: wallet.id,
        publicKey: material.publicKey,
      }
    } catch {
      return this.fail(claimed, 'DATABASE_FINALIZATION_FAILED')
    }
  }

  private async fail(
    claimed: ClaimedWalletProvisioningJob,
    failureCode: WalletProvisioningFailureCode,
  ): Promise<WalletProvisioningHandleResult> {
    const leaseToken = claimed.job.leaseToken
    const terminal = claimed.job.attempts >= claimed.job.maxAttempts
    const retryAt = terminal
      ? null
      : new Date(
          this.now().getTime() +
            this.baseRetryMs *
              Math.pow(2, Math.max(0, claimed.job.attempts - 1)),
        )

    if (leaseToken) {
      try {
        await this.repository.recordFailure(
          claimed.wallet.id,
          leaseToken,
          failureCode,
          retryAt,
          this.now(),
        )
      } catch {
        // A database outage leaves the lease to expire; the job then becomes
        // claimable again without losing the KMS idempotency key.
      }
    }

    return terminal
      ? { kind: 'dead-letter', walletId: claimed.wallet.id, failureCode }
      : { kind: 'retry-scheduled', walletId: claimed.wallet.id, failureCode }
  }
}
