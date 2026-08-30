import type { PrismaClient } from '@prisma/client'
import defaultPrisma from '../config/database'
import { schedulerConfig, type SchedulerConfig } from '../config/scheduler'
import {
  createJobLeaseService,
  JobLeaseService,
} from '../lib/transactions/job-lease.service'
import logger from '../utils/logger'
import {
  queueMetrics,
  QueueMetricsRegistry,
  type QueueDepthSnapshot,
  type TickOutcome,
} from './queue-metrics'
import { createDefaultQueues, type ScheduledQueue } from './queue-registry'

export type QueueLeaseApi = Pick<
  JobLeaseService,
  'acquireQueueLease' | 'renewQueueLease' | 'releaseQueueLease'
>

export interface ScheduledJobRunnerOptions {
  queues: ScheduledQueue[]
  leaseService: QueueLeaseApi
  config?: SchedulerConfig
  metrics?: QueueMetricsRegistry
  log?: Pick<typeof logger, 'info' | 'warn' | 'error' | 'debug'>
}

const EMPTY_DEPTH: QueueDepthSnapshot = { depth: 0, due: 0, oldestDueAt: null }

export class ScheduledJobRunner {
  private readonly queues: ScheduledQueue[]
  private readonly leaseService: QueueLeaseApi
  private readonly config: SchedulerConfig
  private readonly metrics: QueueMetricsRegistry
  private readonly log: NonNullable<ScheduledJobRunnerOptions['log']>

  private readonly timers = new Map<string, NodeJS.Timeout>()
  private readonly inFlight = new Map<string, Promise<TickOutcome>>()
  private started = false
  private stopping = false

  constructor(options: ScheduledJobRunnerOptions) {
    this.config = options.config ?? schedulerConfig
    this.queues = options.queues.filter((queue) =>
      this.config.isEnabled(queue.name),
    )
    this.leaseService = options.leaseService
    this.metrics = options.metrics ?? queueMetrics
    this.log = options.log ?? logger
  }

  get registeredQueues(): string[] {
    return this.queues.map((queue) => queue.name)
  }

  start(): void {
    if (this.started) return
    this.started = true
    this.stopping = false

    if (this.queues.length === 0) {
      this.log.warn('[scheduler] no queues enabled; runner idle')

      return
    }

    for (const queue of this.queues) {
      this.log.info(
        `[scheduler] registered queue "${queue.name}" (every ${this.config.intervalFor(queue.name)}ms)`,
      )
      this.schedule(queue, 0)
    }
  }

  async runOnce(): Promise<Record<string, TickOutcome>> {
    const outcomes: Record<string, TickOutcome> = {}

    for (const queue of this.queues) {
      outcomes[queue.name] = await this.runQueue(queue)
    }

    return outcomes
  }

  async stop(): Promise<void> {
    if (!this.started || this.stopping) return
    this.stopping = true

    for (const timer of this.timers.values()) {
      clearTimeout(timer)
    }
    this.timers.clear()

    const pending = [...this.inFlight.values()]
    if (pending.length > 0) {
      this.log.info(`[scheduler] draining ${pending.length} in-flight tick(s)`)
      const drained = await this.withDeadline(
        Promise.allSettled(pending),
        this.config.shutdownTimeoutMs,
      )

      if (!drained) {
        this.log.warn(
          `[scheduler] shutdown deadline (${this.config.shutdownTimeoutMs}ms) reached; ` +
            'remaining leases expire on their own',
        )
      }
    }

    this.started = false
    this.log.info('[scheduler] stopped')
  }

  private schedule(queue: ScheduledQueue, delayMs: number): void {
    const timer = setTimeout(() => {
      void this.tick(queue)
    }, delayMs)

    this.timers.set(queue.name, timer)
  }

  private async tick(queue: ScheduledQueue): Promise<void> {
    this.timers.delete(queue.name)
    if (this.stopping) return

    const pending = this.runQueue(queue)
    this.inFlight.set(queue.name, pending)

    try {
      await pending
    } finally {
      this.inFlight.delete(queue.name)
    }

    if (!this.stopping) {
      this.schedule(queue, this.config.intervalFor(queue.name))
    }
  }

  private async runQueue(queue: ScheduledQueue): Promise<TickOutcome> {
    const leaseMs = this.config.leaseFor(queue.name)
    const before = await this.inspect(queue)
    const lagMs = before.oldestDueAt
      ? Math.max(0, Date.now() - before.oldestDueAt.getTime())
      : 0

    let lease
    try {
      lease = await this.leaseService.acquireQueueLease({
        queueName: queue.name,
        leaseMs,
        owner: this.config.ownerId,
      })
    } catch (error) {
      return this.record(queue, 'failed', 0, before, lagMs, error)
    }

    if (!lease) {
      return this.record(queue, 'skipped', 0, before, lagMs)
    }

    const heartbeat = setInterval(
      () => {
        void this.leaseService
          .renewQueueLease(queue.name, lease.leaseToken, leaseMs)
          .catch((error) =>
            this.log.warn(
              `[scheduler] failed to renew lease for "${queue.name}"`,
              error,
            ),
          )
      },
      Math.max(1_000, Math.floor(leaseMs / 2)),
    )

    const startedAt = Date.now()

    try {
      await queue.drain()

      return this.record(queue, 'ran', Date.now() - startedAt, before, lagMs)
    } catch (error) {
      return this.record(
        queue,
        'failed',
        Date.now() - startedAt,
        before,
        lagMs,
        error,
      )
    } finally {
      clearInterval(heartbeat)
      await this.leaseService
        .releaseQueueLease(queue.name, lease.leaseToken)
        .catch((error) =>
          this.log.warn(
            `[scheduler] failed to release lease for "${queue.name}"`,
            error,
          ),
        )
    }
  }

  private async inspect(queue: ScheduledQueue): Promise<QueueDepthSnapshot> {
    try {
      return await queue.inspect()
    } catch (error) {
      this.log.warn(`[scheduler] depth probe failed for "${queue.name}"`, error)

      return EMPTY_DEPTH
    }
  }

  private record(
    queue: ScheduledQueue,
    outcome: TickOutcome,
    durationMs: number,
    depth: QueueDepthSnapshot,
    lagMs: number,
    error?: unknown,
  ): TickOutcome {
    this.metrics.record({
      queue: queue.name,
      outcome,
      durationMs,
      depth: depth.depth,
      due: depth.due,
      lagMs,
      error: error === undefined ? undefined : toMessage(error),
    })

    return outcome
  }

  private async withDeadline(
    work: Promise<unknown>,
    timeoutMs: number,
  ): Promise<boolean> {
    let timer: NodeJS.Timeout | undefined

    const deadline = new Promise<false>((resolve) => {
      timer = setTimeout(() => resolve(false), timeoutMs)
    })

    try {
      return await Promise.race([work.then(() => true), deadline])
    } finally {
      if (timer) clearTimeout(timer)
    }
  }
}

function toMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error)
}

export function createScheduledJobRunner(
  overrides: Partial<ScheduledJobRunnerOptions> & {
    prisma?: PrismaClient
  } = {},
): ScheduledJobRunner {
  const prisma = overrides.prisma ?? defaultPrisma

  return new ScheduledJobRunner({
    queues: overrides.queues ?? createDefaultQueues({ prisma }),
    leaseService: overrides.leaseService ?? createJobLeaseService(prisma),
    config: overrides.config,
    metrics: overrides.metrics,
    log: overrides.log,
  })
}
