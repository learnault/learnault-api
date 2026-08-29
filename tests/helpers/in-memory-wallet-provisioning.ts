import type { StoredStellarKey } from '../../src/services/kms/kms-secret-store'
import type { WalletProvisioningRepository } from '../../src/services/wallet-provisioning.repository'
import type {
  ClaimedWalletProvisioningJob,
  WalletProvisioningFailureCode,
  WalletProvisioningJobRecord,
  WalletRecord,
} from '../../src/types/wallet-provisioning.types'
import { WalletEligibilityError } from '../../src/types/wallet-provisioning.types'

interface UserState {
  verified: boolean
  custodialConsent: boolean
}

export class InMemoryWalletProvisioningRepository implements WalletProvisioningRepository {
  private sequence = 0
  private readonly users = new Map<string, UserState>()
  private readonly wallets = new Map<string, WalletRecord>()
  private readonly walletByUser = new Map<string, string>()
  private readonly jobs = new Map<string, WalletProvisioningJobRecord>()
  private readonly jobByWallet = new Map<string, string>()
  readonly managedKeyReferences: StoredStellarKey[] = []
  readonly audits: Array<Record<string, unknown>> = []
  completeFailures = 0

  setUser(userId: string, state: UserState): void {
    this.users.set(userId, state)
  }

  async reserveEligibleWallet(
    userId: string,
    network: string,
  ): Promise<WalletRecord> {
    const user = this.users.get(userId)
    if (!user) throw new WalletEligibilityError('USER_NOT_FOUND')
    if (!user.verified) throw new WalletEligibilityError('USER_NOT_VERIFIED')
    if (!user.custodialConsent) {
      throw new WalletEligibilityError('CUSTODIAL_CONSENT_REQUIRED')
    }

    const existingId = this.walletByUser.get(userId)
    if (existingId) {
      const existing = this.wallets.get(existingId)!
      if (existing.status === 'FAILED') {
        existing.status = 'RESERVED'
        existing.failureCode = null
        const job = this.jobs.get(this.jobByWallet.get(existing.id)!)!
        job.status = 'PENDING'
        job.availableAt = new Date(0)
        job.leaseToken = null
        job.leasedUntil = null
      }

      return existing
    }

    const now = new Date(0)
    const walletId = this.id('wallet')
    const wallet: WalletRecord = {
      id: walletId,
      userId,
      network,
      custody: 'MANAGED',
      publicKey: null,
      status: 'RESERVED',
      managedKeyReferenceId: null,
      failureCode: null,
      attemptCount: 0,
      provisionedAt: null,
      statusChangedAt: now,
      createdAt: now,
      updatedAt: now,
    }
    const jobId = this.id('job')
    const job: WalletProvisioningJobRecord = {
      id: jobId,
      walletId,
      status: 'PENDING',
      availableAt: now,
      leaseToken: null,
      leasedUntil: null,
      attempts: 0,
      maxAttempts: 8,
      lastFailureCode: null,
      completedAt: null,
      createdAt: now,
      updatedAt: now,
    }

    this.wallets.set(walletId, wallet)
    this.walletByUser.set(userId, walletId)
    this.jobs.set(jobId, job)
    this.jobByWallet.set(walletId, jobId)
    this.audits.push({
      action: 'WALLET_PROVISIONING_RESERVED',
      userId,
      walletId,
      network,
    })

    return wallet
  }

  async getByUserId(userId: string): Promise<WalletRecord | null> {
    const walletId = this.walletByUser.get(userId)

    return walletId ? this.wallets.get(walletId)! : null
  }

  async claimNext(
    now: Date,
    leaseMs: number,
  ): Promise<ClaimedWalletProvisioningJob | null> {
    const job = [...this.jobs.values()].find((candidate) => {
      if (
        (candidate.status === 'PENDING' || candidate.status === 'RETRY') &&
        candidate.availableAt <= now
      ) {
        return true
      }

      return (
        candidate.status === 'PROCESSING' &&
        candidate.leasedUntil !== null &&
        candidate.leasedUntil < now
      )
    })
    if (!job) return null

    job.status = 'PROCESSING'
    job.leaseToken = this.id('lease')
    job.leasedUntil = new Date(now.getTime() + leaseMs)
    job.attempts += 1
    const wallet = this.wallets.get(job.walletId)!
    wallet.status = 'PROVISIONING'
    wallet.attemptCount += 1
    wallet.statusChangedAt = now
    this.audits.push({
      action: 'WALLET_PROVISIONING_ATTEMPTED',
      attempt: job.attempts,
    })

    return { job, wallet }
  }

  async complete(
    walletId: string,
    leaseToken: string,
    material: StoredStellarKey,
    now: Date,
  ): Promise<WalletRecord> {
    if (this.completeFailures > 0) {
      this.completeFailures -= 1
      throw new Error('injected database finalization failure')
    }

    const wallet = this.wallets.get(walletId)!
    if (wallet.status === 'ACTIVE') return wallet
    const job = this.jobs.get(this.jobByWallet.get(walletId)!)!
    if (job.status !== 'PROCESSING' || job.leaseToken !== leaseToken) {
      throw new Error('lease lost')
    }

    if (
      !this.managedKeyReferences.some(
        (entry) => entry.opaqueReference === material.opaqueReference,
      )
    ) {
      this.managedKeyReferences.push(material)
    }
    wallet.publicKey = material.publicKey
    wallet.managedKeyReferenceId = material.opaqueReference
    wallet.status = 'ACTIVE'
    wallet.failureCode = null
    wallet.provisionedAt = now
    wallet.statusChangedAt = now
    wallet.updatedAt = now
    job.status = 'COMPLETED'
    job.leaseToken = null
    job.leasedUntil = null
    job.completedAt = now
    this.audits.push({
      action: 'WALLET_PROVISIONING_COMPLETED',
      walletId,
      publicKey: material.publicKey,
      kmsProvider: material.provider,
    })

    return wallet
  }

  async recordFailure(
    walletId: string,
    leaseToken: string,
    code: WalletProvisioningFailureCode,
    retryAt: Date | null,
    now: Date,
  ): Promise<void> {
    const job = this.jobs.get(this.jobByWallet.get(walletId)!)!
    if (job.status !== 'PROCESSING' || job.leaseToken !== leaseToken) return
    const wallet = this.wallets.get(walletId)!
    wallet.status = retryAt ? 'RETRYABLE' : 'FAILED'
    wallet.failureCode = code
    wallet.statusChangedAt = now
    job.status = retryAt ? 'RETRY' : 'DEAD_LETTER'
    job.availableAt = retryAt ?? now
    job.leaseToken = null
    job.leasedUntil = null
    job.lastFailureCode = code
    this.audits.push({
      action: retryAt
        ? 'WALLET_PROVISIONING_RETRY_SCHEDULED'
        : 'WALLET_PROVISIONING_FAILED',
      failureCode: code,
    })
  }

  get walletCount(): number {
    return this.wallets.size
  }

  get jobCount(): number {
    return this.jobs.size
  }

  get activeWalletCount(): number {
    return [...this.wallets.values()].filter(
      (wallet) => wallet.status === 'ACTIVE',
    ).length
  }

  snapshot(): string {
    return JSON.stringify({
      wallets: [...this.wallets.values()],
      jobs: [...this.jobs.values()],
      managedKeyReferences: this.managedKeyReferences,
      audits: this.audits,
    })
  }

  private id(prefix: string): string {
    this.sequence += 1

    return `${prefix}-${this.sequence}`
  }
}
