import type { PrismaClient } from '@prisma/client'
import defaultPrisma from '../config/database'
import {
  EventSchemaRegistry,
  getEventSchemaRegistry,
} from '../lib/transactions/event-schema'
import {
  getOutboxHandlerRegistry,
  OutboxHandlerRegistry,
} from '../lib/transactions/handler-registry'
import {
  createJobLeaseService,
  JobLeaseService,
} from '../lib/transactions/job-lease.service'
import logger from '../utils/logger'

export interface OutboxRelayOptions {
  prisma?: PrismaClient
  handlers?: OutboxHandlerRegistry
  schemas?: EventSchemaRegistry
  leaseService?: JobLeaseService
  batchSize?: number
  leaseMs?: number
  log?: Pick<typeof logger, 'info' | 'warn' | 'error' | 'debug'>
}

export interface RelayTickSummary {
  materialized: number
  dispatched: number
  failed: number
  unhandled: number
}

interface EventRow {
  id: string
  eventType: string
  eventVersion: number
  aggregateId: string
  aggregateType: string
  payload: string
}

export class OutboxRelay {
  private readonly prisma: PrismaClient
  private readonly handlers: OutboxHandlerRegistry
  private readonly schemas: EventSchemaRegistry
  private readonly leases: JobLeaseService
  private readonly batchSize: number
  private readonly leaseMs: number
  private readonly log: NonNullable<OutboxRelayOptions['log']>

  constructor(options: OutboxRelayOptions = {}) {
    this.prisma = options.prisma ?? defaultPrisma
    this.handlers = options.handlers ?? getOutboxHandlerRegistry()
    this.schemas = options.schemas ?? getEventSchemaRegistry()
    this.leases = options.leaseService ?? createJobLeaseService(this.prisma)
    this.batchSize = options.batchSize ?? 50
    this.leaseMs = options.leaseMs ?? 30_000
    this.log = options.log ?? logger
  }

  async runOnce(): Promise<RelayTickSummary> {
    const { materialized, unhandled } = await this.materializePending()
    const { dispatched, failed } = await this.dispatchLeasable()

    return { materialized, dispatched, failed, unhandled }
  }

  async materializePending(): Promise<{
    materialized: number
    unhandled: number
  }> {
    const pending = (await this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING', jobAttempts: { none: {} } },
      orderBy: { createdAt: 'asc' },
      take: this.batchSize,
      select: {
        id: true,
        eventType: true,
        eventVersion: true,
        aggregateId: true,
        aggregateType: true,
        payload: true,
      },
    })) as EventRow[]

    let materialized = 0
    let unhandled = 0

    for (const event of pending) {
      const handlers = this.handlers.handlersFor(
        event.eventType,
        event.eventVersion,
      )

      if (handlers.length === 0) {
        unhandled += 1
        this.log.error(
          `[relay] no handler registered for ${event.eventType} v${event.eventVersion}; dead-lettering event ${event.id}`,
        )
        await this.prisma.outboxEvent.update({
          where: { id: event.id },
          data: { status: 'DEAD_LETTER' },
        })
        continue
      }

      await this.prisma.$transaction(
        handlers.map((handler) =>
          this.prisma.jobAttempt.create({
            data: {
              outboxEventId: event.id,
              jobType: handler.name,
              jobName: `${event.eventType} -> ${handler.name}`,
              status: 'PENDING',
              attempt: 0,
              maxAttempts: handler.maxAttempts ?? 3,
              backoffBaseMs: handler.backoffBaseMs ?? 1000,
              backoffMultiplier: handler.backoffMultiplier ?? 2.0,
              availableAt: new Date(),
            },
          }),
        ),
      )

      materialized += 1
      this.log.info(
        `[relay] materialized ${handlers.length} job(s) for ${event.eventType} v${event.eventVersion} (${event.id})`,
      )
    }

    return { materialized, unhandled }
  }

  async dispatchLeasable(): Promise<{ dispatched: number; failed: number }> {
    let dispatched = 0
    let failed = 0

    for (const name of this.handlers.registeredNames()) {
      let drained = 0

      while (drained < this.batchSize) {
        const outcome = await this.dispatchOne(name)
        if (outcome === 'idle') break

        drained += 1
        if (outcome === 'ok') dispatched += 1
        else failed += 1
      }
    }

    return { dispatched, failed }
  }

  private async dispatchOne(
    jobType: string,
  ): Promise<'ok' | 'failed' | 'idle'> {
    const handler = this.handlers.handlerByName(jobType)
    if (!handler) return 'idle'

    const lease = await this.leases.leaseJob({
      jobType,
      maxLeaseMs: this.leaseMs,
    })
    if (!lease) return 'idle'

    const job = await this.prisma.jobAttempt.findUnique({
      where: { id: lease.jobId },
      include: { outboxEvent: true },
    })

    if (!job?.outboxEvent) {
      await this.leases.failJob(
        lease.jobId,
        lease.leaseToken,
        'Outbox event missing for job',
      )

      return 'failed'
    }

    const event = job.outboxEvent as unknown as EventRow

    try {
      await this.schemas.validate(
        event.eventType,
        event.eventVersion,
        lease.payload,
      )

      const result = await handler.handle({
        eventId: event.id,
        eventType: event.eventType,
        eventVersion: event.eventVersion,
        aggregateId: event.aggregateId,
        aggregateType: event.aggregateType,
        payload: lease.payload,
        attempt: lease.attempt,
      })

      await this.leases.completeJob(lease.jobId, lease.leaseToken, {
        success: true,
        idempotencyKey: result?.idempotencyKey ?? `${event.id}:${handler.name}`,
        result: result?.result,
      })

      this.log.info(
        `[relay] dispatched ${event.eventType} v${event.eventVersion} -> ${handler.name} (${event.id})`,
      )

      return 'ok'
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      this.log.error(
        `[relay] handler ${handler.name} failed for ${event.eventType} (${event.id}) attempt ${lease.attempt + 1}: ${message}`,
      )
      await this.leases.failJob(lease.jobId, lease.leaseToken, error as Error)

      return 'failed'
    }
  }

  async replayDeadLetter(eventId: string): Promise<number> {
    const jobs = await this.prisma.jobAttempt.findMany({
      where: { outboxEventId: eventId, status: 'DEAD_LETTER' },
      select: { id: true },
    })

    for (const job of jobs) {
      await this.leases.resetJobForRetry(job.id)
    }

    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'PENDING' },
    })

    this.log.info(
      `[relay] replayed event ${eventId} (${jobs.length} job(s) reset)`,
    )

    return jobs.length
  }

  async deadLetterEvents(
    limit = 100,
  ): Promise<
    Array<{ id: string; eventType: string; lastError: string | null }>
  > {
    const events = await this.prisma.outboxEvent.findMany({
      where: { status: 'DEAD_LETTER' },
      orderBy: { createdAt: 'asc' },
      take: limit,
      select: {
        id: true,
        eventType: true,
        jobAttempts: {
          where: { status: 'DEAD_LETTER' },
          select: { lastError: true },
          take: 1,
        },
      },
    })

    return events.map((event) => ({
      id: event.id,
      eventType: event.eventType,
      lastError: event.jobAttempts[0]?.lastError ?? null,
    }))
  }
}

export function createOutboxRelay(
  options: OutboxRelayOptions = {},
): OutboxRelay {
  return new OutboxRelay(options)
}
