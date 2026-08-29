/**
 * Job Lease Service: Distribute work to workers with concurrency control
 *
 * Implements lease-based job processing to ensure:
 * 1. Only one worker processes each job at a time (via leaseToken)
 * 2. Abandoned leases (expired leasedUntil) are reclaimed and retried
 * 3. Exponential backoff delays retries
 * 4. Dead-letter jobs after max attempts
 * 5. Idempotent completion prevents duplicate side effects
 */

import { PrismaClient } from '@prisma/client'
import {
  LeaseJobOptions,
  LeaseJobResult,
  JobResult,
  JobAttempt,
  AcquireQueueLeaseOptions,
  QueueLeaseResult,
} from './types.js'
import { randomUUID } from 'crypto'

const DEFAULT_QUEUE_LEASE_MS = 60000

export class JobLeaseService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Lease a job for processing
   *
   * Atomically:
   * 1. Find a PENDING job (status = PENDING and availableAt <= now)
   * 2. Check if already abandoned (status = LEASED and leasedUntil in past)
   * 3. Update job with leaseToken and leasedUntil timestamp
   * 4. Return job details to worker
   *
   * Returns null if no jobs available.
   *
   * Usage:
   * ```typescript
   * const lease = await jobLeaseService.leaseJob({
   *   jobType: "wallet.provision",
   *   maxLeaseMs: 30000,
   * });
   *
   * if (!lease) {
   *   console.log("No jobs available");
   *   return;
   * }
   *
   * try {
   *   const result = await processJob(lease.payload);
   *   await jobLeaseService.completeJob(lease.jobId, lease.leaseToken, result);
   * } catch (error) {
   *   await jobLeaseService.failJob(lease.jobId, lease.leaseToken, error);
   * }
   * ```
   *
   * @param options Lease options (jobType, maxLeaseMs)
   * @returns LeaseJobResult with job details and lease token, or null if no jobs available
   */
  async leaseJob(options: LeaseJobOptions): Promise<LeaseJobResult | null> {
    const maxLeaseMs = options.maxLeaseMs ?? 30000
    const leaseToken = randomUUID()
    const now = new Date()
    const leasedUntil = new Date(now.getTime() + maxLeaseMs)

    // Use raw SQL to atomically lease a job
    // First, try to find a PENDING job
    const result = await this.prisma.$transaction(async (tx) => {
      // Find a PENDING job available now
      const job = await tx.jobAttempt.findFirst({
        where: {
          jobType: options.jobType,
          status: 'PENDING',
          availableAt: { lte: now },
        },
        orderBy: { createdAt: 'asc' },
      })

      if (!job) {
        // Check for abandoned leases
        const abandonedJob = await tx.jobAttempt.findFirst({
          where: {
            jobType: options.jobType,
            status: 'LEASED',
            leasedUntil: { lt: now },
          },
          orderBy: { leasedUntil: 'asc' },
        })

        if (!abandonedJob) {
          return null
        }

        // Reclaim abandoned lease
        const updated = await tx.jobAttempt.update({
          where: { id: abandonedJob.id },
          data: {
            leaseToken,
            leasedUntil,
            status: 'LEASED',
            lastAttemptAt: now,
          },
          include: { outboxEvent: true },
        })

        return updated
      }

      // Lease the PENDING job
      const updated = await tx.jobAttempt.update({
        where: { id: job.id },
        data: {
          leaseToken,
          leasedUntil,
          status: 'LEASED',
          lastAttemptAt: now,
        },
        include: { outboxEvent: true },
      })

      return updated
    })

    if (!result) {
      return null
    }

    // Parse event payload
    const payload = JSON.parse((result.outboxEvent as any).payload)

    return {
      jobId: result.id,
      leaseToken,
      leasedUntil,
      attempt: result.attempt,
      payload,
    }
  }

  /**
   * Complete a job successfully
   *
   * Atomically:
   * 1. Verify leaseToken matches
   * 2. Set status = COMPLETED
   * 3. Store idempotencyKey and result
   * 4. Check if all jobs for this event are complete
   * 5. If all complete, mark event as PUBLISHED
   *
   * @param jobId JobAttempt.id
   * @param leaseToken The lease token returned by leaseJob
   * @param result Job processing result
   */
  async completeJob(
    jobId: string,
    leaseToken: string,
    result: JobResult
  ): Promise<void> {
    await this.prisma.$transaction(async (tx) => {
      // Verify lease token and update job to COMPLETED
      const updated = await tx.jobAttempt.updateMany({
        where: {
          id: jobId,
          leaseToken,
        },
        data: {
          status: 'COMPLETED',
          completedAt: new Date(),
          idempotencyKey: result.idempotencyKey,
          result: result.result ? JSON.stringify(result.result) : null,
          leaseToken: null,
          leasedUntil: null,
        },
      })

      if (updated.count === 0) {
        throw new Error(
          `Job ${jobId} lease mismatch or already completed (token: ${leaseToken})`
        )
      }

      // Check if all jobs for this event are complete
      const job = await tx.jobAttempt.findUnique({ where: { id: jobId } })
      if (!job) {
        return
      }

      const pendingCount = await tx.jobAttempt.count({
        where: {
          outboxEventId: job.outboxEventId,
          status: { not: 'COMPLETED' },
        },
      })

      // If all jobs are complete, mark event as PUBLISHED
      if (pendingCount === 0) {
        await tx.outboxEvent.update({
          where: { id: job.outboxEventId },
          data: {
            status: 'PUBLISHED',
            publishedAt: new Date(),
          },
        })
      }
    })
  }

  /**
   * Handle job failure with retry logic
   *
   * Atomically:
   * 1. Verify leaseToken matches
   * 2. Increment attempt counter
   * 3. If attempt < maxAttempts:
   *    - Calculate exponential backoff delay
   *    - Set availableAt to now + delay
   *    - Set status = PENDING (for retry)
   * 4. If attempt >= maxAttempts:
   *    - Set status = DEAD_LETTER
   *    - Mark event as DEAD_LETTER
   *
   * @param jobId JobAttempt.id
   * @param leaseToken The lease token returned by leaseJob
   * @param error Error message or stack trace
   */
  async failJob(
    jobId: string,
    leaseToken: string,
    error: Error | string
  ): Promise<void> {
    const errorMessage =
      error instanceof Error ? `${error.message}\n${error.stack}` : String(error)

    await this.prisma.$transaction(async (tx) => {
      // Get current job to check attempt count
      const job = await tx.jobAttempt.findUnique({
        where: { id: jobId },
      })

      if (!job) {
        throw new Error(`Job ${jobId} not found`)
      }

      if (job.leaseToken !== leaseToken) {
        throw new Error(
          `Job ${jobId} lease mismatch (provided: ${leaseToken}, held: ${job.leaseToken})`
        )
      }

      const nextAttempt = job.attempt + 1
      const isMaxAttemptsReached = nextAttempt >= job.maxAttempts

      if (isMaxAttemptsReached) {
        // Dead-letter this job
        await tx.jobAttempt.update({
          where: { id: jobId },
          data: {
            status: 'DEAD_LETTER',
            lastError: errorMessage,
            leaseToken: null,
            leasedUntil: null,
          },
        })

        // Mark event as DEAD_LETTER
        await tx.outboxEvent.update({
          where: { id: job.outboxEventId },
          data: { status: 'DEAD_LETTER' },
        })
      } else {
        // Calculate exponential backoff
        const delayMs = job.backoffBaseMs * Math.pow(job.backoffMultiplier, nextAttempt)
        const availableAt = new Date(Date.now() + delayMs)

        // Retry with backoff
        await tx.jobAttempt.update({
          where: { id: jobId },
          data: {
            status: 'PENDING',
            attempt: nextAttempt,
            availableAt,
            lastError: errorMessage,
            leaseToken: null,
            leasedUntil: null,
          },
        })
      }
    })
  }

  /**
   * Recover abandoned leases
   *
   * Find all leased jobs where leasedUntil is in the past and reclaim them
   * for reprocessing. Call this periodically (e.g. every 5 minutes).
   *
   * @returns Number of abandoned leases recovered
   */
  async recoverAbandonedLeases(): Promise<number> {
    const now = new Date()

    const result = await this.prisma.jobAttempt.updateMany({
      where: {
        status: 'LEASED',
        leasedUntil: { lt: now },
      },
      data: {
        status: 'PENDING',
        leaseToken: null,
        leasedUntil: null,
      },
    })

    return result.count
  }

  async acquireQueueLease(
    options: AcquireQueueLeaseOptions
  ): Promise<QueueLeaseResult | null> {
    const leaseMs = options.leaseMs ?? DEFAULT_QUEUE_LEASE_MS
    const leaseToken = randomUUID()
    const owner = options.owner ?? null

    const rows = await this.prisma.$queryRaw<Array<{ leasedUntil: Date }>>`
      INSERT INTO "queue_leases"
        ("id", "queueName", "leaseToken", "leasedUntil", "owner", "createdAt", "updatedAt")
      VALUES (
        ${randomUUID()},
        ${options.queueName},
        ${leaseToken},
        now() + (${String(leaseMs)}::text || ' milliseconds')::interval,
        ${owner},
        now(),
        now()
      )
      ON CONFLICT ("queueName") DO UPDATE
        SET "leaseToken" = EXCLUDED."leaseToken",
            "leasedUntil" = EXCLUDED."leasedUntil",
            "owner" = EXCLUDED."owner",
            "updatedAt" = now()
        WHERE "queue_leases"."leasedUntil" IS NULL
           OR "queue_leases"."leasedUntil" <= now()
      RETURNING "leasedUntil"
    `

    if (rows.length === 0) {
      return null
    }

    return {
      queueName: options.queueName,
      leaseToken,
      leasedUntil: rows[0].leasedUntil,
    }
  }

  async renewQueueLease(
    queueName: string,
    leaseToken: string,
    leaseMs: number = DEFAULT_QUEUE_LEASE_MS
  ): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "queue_leases"
      SET "leasedUntil" = now() + (${String(leaseMs)}::text || ' milliseconds')::interval,
          "updatedAt" = now()
      WHERE "queueName" = ${queueName}
        AND "leaseToken" = ${leaseToken}
    `

    return updated > 0
  }

  async releaseQueueLease(queueName: string, leaseToken: string): Promise<boolean> {
    const updated = await this.prisma.$executeRaw`
      UPDATE "queue_leases"
      SET "leaseToken" = NULL,
          "leasedUntil" = NULL,
          "lastTickAt" = now(),
          "updatedAt" = now()
      WHERE "queueName" = ${queueName}
        AND "leaseToken" = ${leaseToken}
    `

    return updated > 0
  }

  /**
   * Get dead-letter jobs for manual inspection and recovery
   *
   * @param limit Maximum number of dead-letter jobs to retrieve
   * @returns Array of JobAttempts in DEAD_LETTER status
   */
  async getDeadLetterJobs(limit: number = 100): Promise<JobAttempt[]> {
    return this.prisma.jobAttempt.findMany({
      where: { status: 'DEAD_LETTER' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }) as Promise<JobAttempt[]>
  }

  /**
   * Get job attempts for an outbox event
   *
   * @param eventId OutboxEvent.id
   * @returns Array of JobAttempts for the event
   */
  async getJobsForEvent(eventId: string): Promise<JobAttempt[]> {
    return this.prisma.jobAttempt.findMany({
      where: { outboxEventId: eventId },
      orderBy: { createdAt: 'asc' },
    }) as Promise<JobAttempt[]>
  }

  /**
   * Reset a dead-letter job for retry
   *
   * Useful for manual recovery after fixing underlying issues.
   *
   * @param jobId JobAttempt.id
   */
  async resetJobForRetry(jobId: string): Promise<void> {
    const job = await this.prisma.jobAttempt.findUnique({
      where: { id: jobId },
    })

    if (!job) {
      throw new Error(`Job ${jobId} not found`)
    }

    if (job.status !== 'DEAD_LETTER') {
      throw new Error(`Job ${jobId} is not in DEAD_LETTER status`)
    }

    // Reset to PENDING with attempt counter reset
    await this.prisma.jobAttempt.update({
      where: { id: jobId },
      data: {
        status: 'PENDING',
        attempt: 0,
        availableAt: new Date(),
        lastError: null,
      },
    })
  }
}

/**
 * Factory function to create a JobLeaseService instance
 *
 * @param prisma Prisma client
 * @returns JobLeaseService instance
 */
export function createJobLeaseService(prisma: PrismaClient): JobLeaseService {
  return new JobLeaseService(prisma)
}
