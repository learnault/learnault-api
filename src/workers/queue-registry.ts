import type { PrismaClient } from '@prisma/client'
import defaultPrisma from '../config/database'
import { accountLifecycleService } from '../services/account-lifecycle.service'
import { dataExportService } from '../services/data-export.service'
import { emailService } from '../services/email.service'
import { NotificationService } from '../services/notification.service'
import { stellarFundingService } from '../services/stellar-funding.service'
import { WebhookService } from '../services/webhook.service'
import { DeletionStatus, ExportStatus } from '../types/account.types'
import type { QueueDepthSnapshot } from './queue-metrics'

export interface ScheduledQueue {
  name: string
  drain(): Promise<void>
  inspect(): Promise<QueueDepthSnapshot>
}

interface DelegateDepthOptions {
  pending: Record<string, unknown>
  dueField?: string
}

interface CountableDelegate {
  count(args: { where: Record<string, unknown> }): Promise<number>
  findFirst(args: {
    where: Record<string, unknown>
    orderBy: Record<string, unknown>
    select: Record<string, unknown>
  }): Promise<Record<string, Date | null> | null>
}

function delegateDepth(
  delegate: CountableDelegate,
  options: DelegateDepthOptions
): () => Promise<QueueDepthSnapshot> {
  const dueField = options.dueField ?? 'nextAttemptAt'

  return async () => {
    const now = new Date()
    const dueWhere = {
      ...options.pending,
      OR: [{ [dueField]: null }, { [dueField]: { lte: now } }],
    }

    const [depth, due, oldest] = await Promise.all([
      delegate.count({ where: options.pending }),
      delegate.count({ where: dueWhere }),
      delegate.findFirst({
        where: dueWhere,
        orderBy: { [dueField]: 'asc' },
        select: { [dueField]: true },
      }),
    ])

    return { depth, due, oldestDueAt: (oldest?.[dueField] as Date | null) ?? null }
  }
}

export interface QueueRegistryDeps {
  prisma?: PrismaClient
  notificationService?: Pick<NotificationService, 'processQueue'>
  webhookService?: Pick<WebhookService, 'processQueue'>
}

export function createDefaultQueues(deps: QueueRegistryDeps = {}): ScheduledQueue[] {
  const prisma = deps.prisma ?? defaultPrisma
  const notificationService = deps.notificationService ?? new NotificationService()
  const webhookService = deps.webhookService ?? new WebhookService()

  const db = prisma as unknown as Record<string, CountableDelegate>

  return [
    {
      name: 'email',
      drain: () => emailService.processQueue(),
      inspect: delegateDepth(db.emailDelivery, { pending: { status: 'pending' } }),
    },
    {
      name: 'notification',
      drain: () => notificationService.processQueue(),
      inspect: delegateDepth(db.notificationLog, { pending: { status: 'pending' } }),
    },
    {
      name: 'webhook',
      drain: () => webhookService.processQueue(),
      inspect: delegateDepth(db.webhookDelivery, { pending: { status: 'pending' } }),
    },
    {
      name: 'stellar-funding',
      drain: () => stellarFundingService.processQueue(),
      inspect: delegateDepth(db.stellarFunding, {
        pending: { status: { in: ['pending', 'submitted'] } },
      }),
    },
    {
      name: 'data-export',
      drain: async () => {
        await dataExportService.processQueue()
        await dataExportService.purgeExpired()
      },
      inspect: delegateDepth(db.dataExportRequest, {
        pending: { status: ExportStatus.PENDING },
      }),
    },
    {
      name: 'account-lifecycle',
      drain: () => accountLifecycleService.processDue(),
      inspect: delegateDepth(db.accountDeletionRequest, {
        pending: { status: DeletionStatus.PENDING },
        dueField: 'scheduledFor',
      }),
    },
  ]
}
