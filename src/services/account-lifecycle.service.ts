import crypto from 'crypto'
import prisma from '../config/database'
import logger from '../utils/logger'
import { env } from '../config/env'
import { auditService } from './audit.service'
import { dataExportService } from './data-export.service'
import {
  AccountStatus,
  AuditAction,
  DeletionStatus,
  RequestContext,
} from '../types/account.types'

const ACTIVE_DELETION_STATUSES = [DeletionStatus.PENDING, DeletionStatus.PROCESSING]

export interface DeletionRequestRecord {
  id: string
  userId: string
  status: string
  reason: string | null
  scheduledFor: Date
  cancelledAt: Date | null
  completedAt: Date | null
  attemptCount: number
  maxAttempts: number
  createdAt: Date
}

export type DeactivateResult =
  | { kind: 'deactivated' }
  | { kind: 'conflict'; status: string }

export type RequestDeletionResult =
  | { kind: 'created'; request: DeletionRequestRecord }
  | { kind: 'duplicate'; request: DeletionRequestRecord }

export type CancelDeletionResult =
  | { kind: 'cancelled'; request: DeletionRequestRecord }
  | { kind: 'finalized' }
  | { kind: 'none' }

export class AccountLifecycleService {
  async deactivate(userId: string, currentStatus: string, ctx: RequestContext): Promise<DeactivateResult> {
    if (currentStatus !== AccountStatus.ACTIVE) {
      return { kind: 'conflict', status: currentStatus }
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { status: AccountStatus.DEACTIVATED, statusChangedAt: new Date() },
      }),
      prisma.session.updateMany({
        where: { userId, isRevoked: false },
        data: { isRevoked: true, revokedAt: new Date() },
      }),
      auditService.op({ userId, action: AuditAction.ACCOUNT_DEACTIVATED, ...ctx }),
    ])

    return { kind: 'deactivated' }
  }

  async reactivate(userId: string, ctx: RequestContext): Promise<void> {
    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { status: AccountStatus.ACTIVE, statusChangedAt: new Date() },
      }),
      auditService.op({ userId, action: AuditAction.ACCOUNT_REACTIVATED, ...ctx }),
    ])
  }

  async requestDeletion(
    userId: string,
    reason: string | undefined,
    ctx: RequestContext
  ): Promise<RequestDeletionResult> {
    const existing = await prisma.accountDeletionRequest.findFirst({
      where: { userId, status: { in: ACTIVE_DELETION_STATUSES } },
    })

    if (existing) {
      return { kind: 'duplicate', request: existing as DeletionRequestRecord }
    }

    const scheduledFor = new Date(Date.now() + env.DELETION_COOLING_OFF_DAYS * 24 * 60 * 60_000)

    try {
      const [request] = await prisma.$transaction([
        prisma.accountDeletionRequest.create({
          data: { userId, status: DeletionStatus.PENDING, reason: reason ?? null, scheduledFor },
        }),
        prisma.user.update({
          where: { id: userId },
          data: { status: AccountStatus.PENDING_DELETION, statusChangedAt: new Date() },
        }),
        prisma.session.updateMany({
          where: { userId, isRevoked: false },
          data: { isRevoked: true, revokedAt: new Date() },
        }),
        auditService.op({
          userId,
          action: AuditAction.DELETION_REQUESTED,
          metadata: { scheduledFor: scheduledFor.toISOString() },
          ...ctx,
        }),
      ])

      return { kind: 'created', request: request as DeletionRequestRecord }
    } catch (error: any) {
      // Partial unique index uq_active_deletion_per_user: concurrent request won the race
      if (error?.code === 'P2002' || /uq_active_deletion_per_user/.test(error?.message ?? '')) {
        const winner = await prisma.accountDeletionRequest.findFirst({
          where: { userId, status: { in: ACTIVE_DELETION_STATUSES } },
        })
        if (winner) {
          return { kind: 'duplicate', request: winner as DeletionRequestRecord }
        }
      }
      throw error
    }
  }

  async getLatestDeletionRequest(userId: string): Promise<DeletionRequestRecord | null> {
    return (await prisma.accountDeletionRequest.findFirst({
      where: { userId },
      orderBy: { createdAt: 'desc' },
    })) as DeletionRequestRecord | null
  }

  async cancelDeletion(userId: string, ctx: RequestContext): Promise<CancelDeletionResult> {
    // Status-guarded update is the race protection: if finalization already
    // claimed the request (processing/completed), count is 0 and we lose.
    const cancelled = await prisma.accountDeletionRequest.updateMany({
      where: { userId, status: DeletionStatus.PENDING },
      data: { status: DeletionStatus.CANCELLED, cancelledAt: new Date() },
    })

    if (cancelled.count === 0) {
      const latest = await this.getLatestDeletionRequest(userId)
      if (
        latest &&
        (latest.status === DeletionStatus.PROCESSING || latest.status === DeletionStatus.COMPLETED)
      ) {
        return { kind: 'finalized' }
      }

      return { kind: 'none' }
    }

    await prisma.$transaction([
      prisma.user.update({
        where: { id: userId },
        data: { status: AccountStatus.ACTIVE, statusChangedAt: new Date() },
      }),
      auditService.op({ userId, action: AuditAction.DELETION_CANCELLED, ...ctx }),
    ])

    const request = await this.getLatestDeletionRequest(userId)

    return { kind: 'cancelled', request: request as DeletionRequestRecord }
  }

  /**
   * Finalize deletion requests whose cooling-off window has elapsed.
   * Claim-based so concurrent sweeps and crash re-runs are safe; every
   * operation in the finalization matrix is idempotent.
   */
  async processDue(): Promise<void> {
    const now = new Date()
    const due = await prisma.accountDeletionRequest.findMany({
      where: {
        status: DeletionStatus.PENDING,
        scheduledFor: { lte: now },
        attemptCount: { lt: 5 },
        OR: [{ nextAttemptAt: null }, { nextAttemptAt: { lte: now } }],
      },
    })

    for (const request of due) {
      const claimed = await prisma.accountDeletionRequest.updateMany({
        where: { id: request.id, status: DeletionStatus.PENDING },
        data: {
          status: DeletionStatus.PROCESSING,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      })

      if (claimed.count === 0) {
        continue
      }

      try {
        await this.finalizeDeletion(request.id, request.userId)
      } catch (error: any) {
        await this.handleFinalizationFailure(
          request as DeletionRequestRecord,
          error?.message ?? 'Deletion finalization error'
        )
      }
    }
  }

  /**
   * Applies the deletion/anonymization matrix:
   * - Hard delete: sessions, verification tokens, device tokens, sync events,
   *   notification logs/preferences, email deliveries, completions, referral
   *   code, data export requests (full-PII artifacts).
   * - Retain: transactions, referrals, credentials (financial/on-chain
   *   records, no PII in-row), stellar fundings (keyed by public key; link is
   *   severed by nulling walletAddress).
   * - Retain + scrub: audit logs (keep action/createdAt, drop ip/UA/metadata).
   * - User row: anonymized in place (tombstone) so retained FKs stay valid.
   */
  private async finalizeDeletion(requestId: string, userId: string): Promise<void> {
    const tombstoneSuffix = userId.replace(/-/g, '').slice(0, 12)

    await prisma.$transaction([
      prisma.session.deleteMany({ where: { userId } }),
      prisma.verificationToken.deleteMany({ where: { userId } }),
      prisma.deviceToken.deleteMany({ where: { userId } }),
      prisma.syncEvent.deleteMany({ where: { userId } }),
      prisma.notificationLog.deleteMany({ where: { userId } }),
      prisma.notificationPreference.deleteMany({ where: { userId } }),
      prisma.emailDelivery.deleteMany({ where: { userId } }),
      prisma.completion.deleteMany({ where: { userId } }),
      prisma.referralCode.deleteMany({ where: { userId } }),
      prisma.dataExportRequest.deleteMany({ where: { userId } }),
      prisma.auditLog.updateMany({
        where: { userId },
        data: {
          ipAddress: null,
          userAgent: null,
          metadata: JSON.stringify({ redacted: true }),
        },
      }),
      prisma.user.update({
        where: { id: userId },
        data: {
          email: `deleted+${tombstoneSuffix}@anon.invalid`,
          username: `deleted_${tombstoneSuffix}`,
          password: crypto.randomBytes(32).toString('hex'),
          walletAddress: null,
          isVerified: false,
          lastLoginAt: null,
          status: AccountStatus.DELETED,
          statusChangedAt: new Date(),
        },
      }),
      prisma.accountDeletionRequest.update({
        where: { id: requestId },
        data: { status: DeletionStatus.COMPLETED, completedAt: new Date(), error: null },
      }),
      auditService.op({
        userId,
        action: AuditAction.DELETION_COMPLETED,
        metadata: { requestId },
      }),
    ])

    logger.info(`[AccountLifecycleService] Deletion request ${requestId} finalized`)
  }

  private async handleFinalizationFailure(request: DeletionRequestRecord, error: string): Promise<void> {
    const nextAttemptCount = request.attemptCount + 1

    if (nextAttemptCount >= request.maxAttempts) {
      await prisma.accountDeletionRequest.updateMany({
        where: { id: request.id, status: DeletionStatus.PROCESSING },
        data: { status: DeletionStatus.FAILED, error },
      })
      logger.error(
        `[AccountLifecycleService] Deletion ${request.id} dead-lettered after ${nextAttemptCount} attempts: ${error}`
      )
    } else {
      const backoffMinutes = Math.pow(5, nextAttemptCount - 1)
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)

      await prisma.accountDeletionRequest.updateMany({
        where: { id: request.id, status: DeletionStatus.PROCESSING },
        data: { status: DeletionStatus.PENDING, error, nextAttemptAt },
      })
    }
  }

  async sweep(): Promise<void> {
    const results = await Promise.allSettled([
      this.processDue(),
      dataExportService.processQueue(),
      dataExportService.purgeExpired(),
    ])

    for (const result of results) {
      if (result.status === 'rejected') {
        logger.error('[AccountLifecycleService] Sweep task failed:', result.reason)
      }
    }
  }
}

export const accountLifecycleService = new AccountLifecycleService()
