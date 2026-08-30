import { randomUUID } from 'node:crypto'
import type { Prisma, PrismaClient } from '@prisma/client'
import type { StoredStellarKey } from './kms/kms-secret-store'
import type {
  ClaimedWalletProvisioningJob,
  WalletProvisioningFailureCode,
  WalletRecord,
} from '../types/wallet-provisioning.types'
import { WalletEligibilityError } from '../types/wallet-provisioning.types'

export const CUSTODIAL_WALLET_CONSENT_PURPOSE = 'custodial_wallet'

export interface WalletProvisioningRepository {
  reserveEligibleWallet(userId: string, network: string): Promise<WalletRecord>
  getByUserId(userId: string): Promise<WalletRecord | null>
  claimNext(now: Date, leaseMs: number): Promise<ClaimedWalletProvisioningJob | null>
  claimByWalletId(
    walletId: string,
    now: Date,
    leaseMs: number,
  ): Promise<ClaimedWalletProvisioningJob | null>
  complete(
    walletId: string,
    leaseToken: string,
    material: StoredStellarKey,
    now: Date
  ): Promise<WalletRecord>
  recordFailure(
    walletId: string,
    leaseToken: string,
    code: WalletProvisioningFailureCode,
    retryAt: Date | null,
    now: Date
  ): Promise<void>
}

type DbClient = PrismaClient | Prisma.TransactionClient

export class PrismaWalletProvisioningRepository implements WalletProvisioningRepository {
  constructor(private readonly prisma: PrismaClient) {}

  async reserveEligibleWallet(userId: string, network: string): Promise<WalletRecord> {
    return this.prisma.$transaction(async (tx) => {
      await this.assertEligible(tx, userId)

      const before = await tx.wallet.findUnique({ where: { userId } })
      let wallet = await tx.wallet.upsert({
        where: { userId },
        update: {},
        create: { userId, network, custody: 'MANAGED' },
      })

      if (wallet.status === 'FAILED') {
        wallet = await tx.wallet.update({
          where: { id: wallet.id },
          data: {
            status: 'RESERVED',
            failureCode: null,
            statusChangedAt: new Date(),
          },
        })
      }

      if (wallet.status !== 'ACTIVE') {
        await tx.walletProvisioningJob.upsert({
          where: { walletId: wallet.id },
          update: {
            status: 'PENDING',
            availableAt: new Date(),
            leaseToken: null,
            leasedUntil: null,
            lastFailureCode: null,
            completedAt: null,
          },
          create: { walletId: wallet.id },
        })
      }

      if (!before || before.status === 'FAILED') {
        await tx.auditLog.create({
          data: {
            userId,
            action: before ? 'WALLET_PROVISIONING_REQUEUED' : 'WALLET_PROVISIONING_RESERVED',
            metadata: JSON.stringify({ walletId: wallet.id, network }),
          },
        })
      }

      return wallet as unknown as WalletRecord
    })
  }

  async getByUserId(userId: string): Promise<WalletRecord | null> {
    return this.prisma.wallet.findUnique({ where: { userId } }) as unknown as Promise<WalletRecord | null>
  }

  async claimNext(now: Date, leaseMs: number): Promise<ClaimedWalletProvisioningJob | null> {
    const candidates = await this.prisma.walletProvisioningJob.findMany({
      where: this.claimableWhere(now),
      orderBy: [{ availableAt: 'asc' }, { createdAt: 'asc' }],
      take: 10,
      select: { id: true },
    })

    for (const candidate of candidates) {
      const claimed = await this.claimCandidate(candidate.id, now, leaseMs)
      if (claimed) return claimed
    }

    return null
  }

  async claimByWalletId(
    walletId: string,
    now: Date,
    leaseMs: number,
  ): Promise<ClaimedWalletProvisioningJob | null> {
    const candidate = await this.prisma.walletProvisioningJob.findFirst({
      where: { walletId, ...this.claimableWhere(now) },
      select: { id: true },
    })

    if (!candidate) return null

    return this.claimCandidate(candidate.id, now, leaseMs)
  }

  private async claimCandidate(
    jobId: string,
    now: Date,
    leaseMs: number,
  ): Promise<ClaimedWalletProvisioningJob | null> {
    const leaseToken = randomUUID()
    const leasedUntil = new Date(now.getTime() + leaseMs)

    return this.prisma.$transaction(async (tx) => {
      const result = await tx.walletProvisioningJob.updateMany({
        where: { id: jobId, ...this.claimableWhere(now) },
        data: {
          status: 'PROCESSING',
          leaseToken,
          leasedUntil,
          attempts: { increment: 1 },
        },
      })

      if (result.count !== 1) return null

      const job = await tx.walletProvisioningJob.findUniqueOrThrow({
        where: { id: jobId },
        include: { wallet: true },
      })

      await tx.wallet.update({
        where: { id: job.walletId },
        data: {
          status: 'PROVISIONING',
          attemptCount: { increment: 1 },
          statusChangedAt: now,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: job.wallet.userId,
          action: 'WALLET_PROVISIONING_ATTEMPTED',
          metadata: JSON.stringify({ walletId: job.walletId, attempt: job.attempts }),
        },
      })

      return {
        job: { ...job, leaseToken },
        wallet: { ...job.wallet, status: 'PROVISIONING' },
      } as unknown as ClaimedWalletProvisioningJob
    })
  }

  async complete(
    walletId: string,
    leaseToken: string,
    material: StoredStellarKey,
    now: Date
  ): Promise<WalletRecord> {
    return this.prisma.$transaction(async (tx) => {
      const job = await tx.walletProvisioningJob.findUniqueOrThrow({ where: { walletId } })
      const wallet = await tx.wallet.findUniqueOrThrow({ where: { id: walletId } })

      if (wallet.status === 'ACTIVE') return wallet as unknown as WalletRecord
      if (job.status !== 'PROCESSING' || job.leaseToken !== leaseToken) {
        throw new Error('WALLET_PROVISIONING_LEASE_LOST')
      }

      const managedKey = await tx.managedKeyReference.upsert({
        where: { opaqueReference: material.opaqueReference },
        update: {
          provider: material.provider,
          keyVersion: material.keyVersion,
        },
        create: {
          provider: material.provider,
          opaqueReference: material.opaqueReference,
          keyVersion: material.keyVersion,
        },
      })

      const activeWallet = await tx.wallet.update({
        where: { id: walletId },
        data: {
          publicKey: material.publicKey,
          managedKeyReferenceId: managedKey.id,
          status: 'ACTIVE',
          failureCode: null,
          provisionedAt: now,
          statusChangedAt: now,
        },
      })

      await tx.user.update({
        where: { id: wallet.userId },
        data: { walletAddress: material.publicKey },
      })

      await tx.walletProvisioningJob.update({
        where: { walletId },
        data: {
          status: 'COMPLETED',
          leaseToken: null,
          leasedUntil: null,
          lastFailureCode: null,
          completedAt: now,
        },
      })

      await tx.auditLog.create({
        data: {
          userId: wallet.userId,
          action: 'WALLET_PROVISIONING_COMPLETED',
          metadata: JSON.stringify({
            walletId,
            publicKey: material.publicKey,
            kmsProvider: material.provider,
          }),
        },
      })

      return activeWallet as unknown as WalletRecord
    })
  }

  async recordFailure(
    walletId: string,
    leaseToken: string,
    code: WalletProvisioningFailureCode,
    retryAt: Date | null,
    now: Date
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      const job = await tx.walletProvisioningJob.findUniqueOrThrow({
        where: { walletId },
        include: { wallet: true },
      })

      if (job.status !== 'PROCESSING' || job.leaseToken !== leaseToken) return

      const terminal = retryAt === null
      await tx.wallet.update({
        where: { id: walletId },
        data: {
          status: terminal ? 'FAILED' : 'RETRYABLE',
          failureCode: code,
          statusChangedAt: now,
        },
      })
      await tx.walletProvisioningJob.update({
        where: { walletId },
        data: {
          status: terminal ? 'DEAD_LETTER' : 'RETRY',
          availableAt: retryAt ?? now,
          leaseToken: null,
          leasedUntil: null,
          lastFailureCode: code,
        },
      })
      await tx.auditLog.create({
        data: {
          userId: job.wallet.userId,
          action: terminal ? 'WALLET_PROVISIONING_FAILED' : 'WALLET_PROVISIONING_RETRY_SCHEDULED',
          metadata: JSON.stringify({ walletId, failureCode: code, attempt: job.attempts }),
        },
      })
    })
  }

  private async assertEligible(tx: DbClient, userId: string): Promise<void> {
    const user = await tx.user.findUnique({
      where: { id: userId },
      select: { isVerified: true },
    })
    if (!user) throw new WalletEligibilityError('USER_NOT_FOUND')
    if (!user.isVerified) throw new WalletEligibilityError('USER_NOT_VERIFIED')

    const consent = await tx.consentRecord.findFirst({
      where: { userId, purpose: CUSTODIAL_WALLET_CONSENT_PURPOSE },
      orderBy: { createdAt: 'desc' },
      select: { status: true },
    })
    if (consent?.status !== 'granted') {
      throw new WalletEligibilityError('CUSTODIAL_CONSENT_REQUIRED')
    }
  }

  private claimableWhere(now: Date) {
    return {
      OR: [
        {
          status: { in: ['PENDING', 'RETRY'] },
          availableAt: { lte: now },
        },
        {
          status: 'PROCESSING',
          leasedUntil: { lt: now },
        },
      ],
    }
  }
}
