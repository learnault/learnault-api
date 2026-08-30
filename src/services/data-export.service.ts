import prisma from '../config/database'
import logger from '../utils/logger'
import { env } from '../config/env'
import { auditService } from './audit.service'
import { emailService } from './email.service'
import { ExportStatus, AuditAction } from '../types/account.types'

// Caps the number of sync events included in an export so the DB-stored
// artifact stays bounded in size.
const SYNC_EVENT_EXPORT_CAP = 1000

const ACTIVE_EXPORT_STATUSES = [ExportStatus.PENDING, ExportStatus.PROCESSING]

export interface ExportRequestRecord {
  id: string
  userId: string
  status: string
  artifact: string | null
  error: string | null
  attemptCount: number
  maxAttempts: number
  completedAt: Date | null
  expiresAt: Date | null
  downloadedAt: Date | null
  createdAt: Date
}

export type RequestExportResult =
  | { kind: 'created'; request: ExportRequestRecord }
  | { kind: 'duplicate'; request: ExportRequestRecord }

export class DataExportService {
  async requestExport(userId: string): Promise<RequestExportResult> {
    const existing = await prisma.dataExportRequest.findFirst({
      where: { userId, status: { in: ACTIVE_EXPORT_STATUSES } },
    })

    if (existing) {
      return { kind: 'duplicate', request: existing as ExportRequestRecord }
    }

    let request: ExportRequestRecord
    try {
      request = (await prisma.dataExportRequest.create({
        data: {
          userId,
          status: ExportStatus.PENDING,
          nextAttemptAt: new Date(),
        },
      })) as ExportRequestRecord
    } catch (error: any) {
      // Partial unique index uq_active_export_per_user: a concurrent request won the race
      if (
        error?.code === 'P2002' ||
        /uq_active_export_per_user/.test(error?.message ?? '')
      ) {
        const winner = await prisma.dataExportRequest.findFirst({
          where: { userId, status: { in: ACTIVE_EXPORT_STATUSES } },
        })
        if (winner) {
          return { kind: 'duplicate', request: winner as ExportRequestRecord }
        }
      }
      throw error
    }

    await auditService.record({
      userId,
      action: AuditAction.EXPORT_REQUESTED,
      metadata: { requestId: request.id },
    })

    return { kind: 'created', request }
  }

  async getExportStatus(
    userId: string,
    id: string,
  ): Promise<ExportRequestRecord | null> {
    // Scoped to the requesting user: other users' export ids behave as not found
    return (await prisma.dataExportRequest.findFirst({
      where: { id, userId },
    })) as ExportRequestRecord | null
  }

  async processQueue(): Promise<void> {
    const due = await prisma.dataExportRequest.findMany({
      where: {
        status: ExportStatus.PENDING,
        nextAttemptAt: { lte: new Date() },
        attemptCount: { lt: 5 },
      },
    })

    for (const request of due) {
      // Claim the row before working on it: if another runner already flipped
      // it out of `pending`, count is 0 and we skip. This makes concurrent
      // sweeps and re-runs after a crash safe.
      const claimed = await prisma.dataExportRequest.updateMany({
        where: { id: request.id, status: ExportStatus.PENDING },
        data: {
          status: ExportStatus.PROCESSING,
          attemptCount: { increment: 1 },
          lastAttemptAt: new Date(),
        },
      })

      if (claimed.count === 0) {
        continue
      }

      try {
        await this.generateExport(request.id, request.userId)
      } catch (error: any) {
        await this.handleFailure(
          request as ExportRequestRecord,
          error?.message ?? 'Export generation error',
        )
      }
    }
  }

  private async generateExport(
    requestId: string,
    userId: string,
  ): Promise<void> {
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: {
        id: true,
        email: true,
        username: true,
        role: true,
        walletAddress: true,
        isVerified: true,
        status: true,
        createdAt: true,
        lastLoginAt: true,
      },
    })

    if (!user) {
      throw new Error(`User ${userId} not found for export`)
    }

    const [
      completions,
      credentials,
      transactions,
      referralCode,
      referralsGiven,
      referralReceived,
      syncEvents,
      notificationPreference,
      notificationLogs,
      sessions,
      auditLogs,
    ] = await Promise.all([
      prisma.completion.findMany({
        where: { userId },
        include: { module: { select: { title: true } } },
      }),
      prisma.credential.findMany({
        where: { userId },
        include: { module: { select: { title: true } } },
      }),
      prisma.transaction.findMany({ where: { userId } }),
      prisma.referralCode.findFirst({
        where: { userId },
        select: { code: true, createdAt: true },
      }),
      prisma.referral.findMany({
        where: { referrerId: userId },
        select: {
          referreeId: true,
          bonusPaid: true,
          bonusAmount: true,
          createdAt: true,
        },
      }),
      prisma.referral.findFirst({
        where: { referreeId: userId },
        select: { referrerId: true, createdAt: true },
      }),
      prisma.syncEvent.findMany({
        where: { userId },
        orderBy: { createdAt: 'desc' },
        take: SYNC_EVENT_EXPORT_CAP,
        select: {
          deviceId: true,
          eventType: true,
          payload: true,
          clientTimestamp: true,
          status: true,
          createdAt: true,
        },
      }),
      prisma.notificationPreference.findFirst({
        where: { userId },
        select: {
          rewardReceipt: true,
          quizPassFail: true,
          streakReminders: true,
        },
      }),
      prisma.notificationLog.findMany({
        where: { userId },
        select: { type: true, title: true, status: true, createdAt: true },
      }),
      // Session metadata only — never token/refreshToken
      prisma.session.findMany({
        where: { userId },
        select: {
          userAgent: true,
          ipAddress: true,
          createdAt: true,
          expiresAt: true,
          isRevoked: true,
        },
      }),
      prisma.auditLog.findMany({
        where: { userId },
        select: { action: true, createdAt: true },
      }),
    ])

    const artifact = JSON.stringify({
      exportVersion: 1,
      generatedAt: new Date().toISOString(),
      data: {
        profile: user,
        completions: completions.map((c: any) => ({
          moduleId: c.moduleId,
          moduleTitle: c.module?.title,
          score: c.score,
          completedAt: c.completedAt,
        })),
        credentials: credentials.map((c: any) => ({
          moduleId: c.moduleId,
          moduleTitle: c.module?.title,
          onChainId: c.onChainId,
          issuedAt: c.issuedAt,
        })),
        transactions: transactions.map((t: any) => ({
          id: t.id,
          amount: t.amount,
          type: t.type,
          status: t.status,
          createdAt: t.createdAt,
        })),
        referralCode,
        referralsGiven,
        referralReceived,
        syncEvents,
        notificationPreference,
        notificationLogs,
        sessions,
        auditLog: auditLogs,
      },
    })

    const expiresAt = new Date(
      Date.now() + env.EXPORT_TTL_DAYS * 24 * 60 * 60_000,
    )

    await prisma.dataExportRequest.update({
      where: { id: requestId },
      data: {
        status: ExportStatus.READY,
        artifact,
        artifactBytes: Buffer.byteLength(artifact, 'utf8'),
        error: null,
        completedAt: new Date(),
        expiresAt,
      },
    })

    await auditService.record({
      userId,
      action: AuditAction.EXPORT_READY,
      metadata: { requestId },
    })

    await emailService.queueEmail(
      userId,
      user.email,
      'Your Learnault data export is ready',
      this.buildExportReadyEmail(user.username, expiresAt),
      'DATA_EXPORT',
    )
  }

  private async handleFailure(
    request: ExportRequestRecord,
    error: string,
  ): Promise<void> {
    const nextAttemptCount = request.attemptCount + 1

    if (nextAttemptCount >= request.maxAttempts) {
      await prisma.dataExportRequest.update({
        where: { id: request.id },
        data: { status: ExportStatus.FAILED, error },
      })
      logger.error(
        `[DataExportService] Export ${request.id} dead-lettered after ${nextAttemptCount} attempts: ${error}`,
      )
    } else {
      const backoffMinutes = Math.pow(5, nextAttemptCount - 1)
      const nextAttemptAt = new Date(Date.now() + backoffMinutes * 60_000)

      await prisma.dataExportRequest.update({
        where: { id: request.id },
        data: { status: ExportStatus.PENDING, error, nextAttemptAt },
      })
    }
  }

  async purgeExpired(): Promise<number> {
    const result = await prisma.dataExportRequest.updateMany({
      where: { status: ExportStatus.READY, expiresAt: { lte: new Date() } },
      data: { status: ExportStatus.EXPIRED, artifact: null },
    })

    if (result.count > 0) {
      logger.info(
        `[DataExportService] Purged ${result.count} expired export artifact(s)`,
      )
    }

    return result.count
  }

  async markDownloaded(userId: string, id: string): Promise<void> {
    await prisma.dataExportRequest.updateMany({
      where: { id, userId, downloadedAt: null },
      data: { downloadedAt: new Date() },
    })
    await auditService.record({
      userId,
      action: AuditAction.EXPORT_DOWNLOADED,
      metadata: { requestId: id },
    })
  }

  private buildExportReadyEmail(username: string, expiresAt: Date): string {
    return `
      <p>Hi ${username},</p>
      <p>Your Learnault data export is ready to download from your account settings.</p>
      <p>The download is available until <strong>${expiresAt.toUTCString()}</strong>, after which it is permanently removed.</p>
      <p>If you did not request this export, please change your password immediately.</p>
    `
  }
}

export const dataExportService = new DataExportService()
