/**
 * Outbox Service: Write domain changes and events atomically
 *
 * Implements the transactional outbox pattern to ensure that:
 * 1. Domain state changes are persisted in PostgreSQL
 * 2. Outbox events are written in the same transaction
 * 3. Events are never lost, even if server crashes after response sent
 * 4. Workers process events asynchronously with retry and backoff
 */

import { PrismaClient, Prisma } from '@prisma/client'
import { CreateOutboxEventOptions, OutboxEvent, JobConfig } from './types.js'

export class OutboxService {
  constructor(private prisma: PrismaClient) {}

  /**
   * Create an outbox event within an existing transaction
   *
   * Usage:
   * ```typescript
   * const result = await prisma.$transaction(async (tx) => {
   *   // Make domain changes
   *   const user = await tx.user.create({ data: { email, ... } });
   *
   *   // Write outbox event in same transaction
   *   const event = await outboxService.createEvent(tx, {
   *     aggregateId: user.id,
   *     aggregateType: "User",
   *     eventType: "UserCreated",
   *     eventVersion: 1,
   *     payload: { userId: user.id, email },
   *   });
   *
   *   return { user, event };
   * });
   * ```
   *
   * @param tx Prisma transaction client (from prisma.$transaction)
   * @param options Event creation options
   * @returns Created OutboxEvent
   */
  async createEvent(
    tx: Prisma.TransactionClient,
    options: CreateOutboxEventOptions,
  ): Promise<OutboxEvent> {
    return tx.outboxEvent.create({
      data: {
        id: `${options.aggregateId}_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`,
        aggregateId: options.aggregateId,
        aggregateType: options.aggregateType,
        eventType: options.eventType,
        eventVersion: options.eventVersion,
        payload: JSON.stringify(options.payload),
        source: options.source,
        causedBy: options.causedBy,
        status: 'PENDING',
      },
    }) as Promise<OutboxEvent>
  }

  /**
   * Create job attempts for an outbox event
   *
   * Call this after creating an OutboxEvent to define which jobs should process it.
   * Each (OutboxEvent, jobType) pair gets one JobAttempt row.
   *
   * @param tx Prisma transaction client
   * @param eventId OutboxEvent.id
   * @param jobs Array of JobConfigs defining which jobs to create
   */
  async createJobAttempts(
    tx: Prisma.TransactionClient,
    eventId: string,
    jobs: JobConfig[],
  ): Promise<void> {
    for (const job of jobs) {
      await tx.jobAttempt.create({
        data: {
          id: `${eventId}_${job.jobType}_${Date.now()}`,
          outboxEventId: eventId,
          jobType: job.jobType,
          jobName: job.jobName,
          status: 'PENDING',
          attempt: 0,
          maxAttempts: job.maxAttempts ?? 3,
          backoffMultiplier: job.backoffMultiplier ?? 2.0,
          backoffBaseMs: job.backoffBaseMs ?? 1000,
          availableAt: new Date(),
        },
      })
    }
  }

  /**
   * Get pending outbox events that haven't been published yet
   *
   * @param limit Maximum number of events to retrieve
   * @returns Array of PENDING OutboxEvents
   */
  async getPendingEvents(limit: number = 100): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: { status: 'PENDING' },
      orderBy: { createdAt: 'asc' },
      take: limit,
    }) as Promise<OutboxEvent[]>
  }

  /**
   * Mark an outbox event as published
   *
   * Call this after all associated JobAttempts have completed successfully.
   *
   * @param eventId OutboxEvent.id
   */
  async markPublished(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'PUBLISHED', publishedAt: new Date() },
    })
  }

  /**
   * Mark an outbox event as dead-lettered
   *
   * Call this when an event or its jobs permanently fail after max retries.
   *
   * @param eventId OutboxEvent.id
   */
  async markDeadLetter(eventId: string): Promise<void> {
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: {
        status: 'DEAD_LETTER',
      },
    })
  }

  /**
   * Mark an outbox event as rolled back
   *
   * Call this when the domain transaction rolls back. This prevents workers
   * from processing the event.
   *
   * @param eventId OutboxEvent.id
   * @param reason Optional reason for rollback
   */
  async markRolledBack(eventId: string, reason?: string): Promise<void> {
    // Create a rolled-back record marker
    await this.prisma.rolledBackRecord.create({
      data: {
        id: `event_${eventId}_${Date.now()}`,
        recordType: 'OutboxEvent',
        recordId: eventId,
        reason,
      },
    })

    // Mark event as rolled back
    await this.prisma.outboxEvent.update({
      where: { id: eventId },
      data: { status: 'ROLLED_BACK' },
    })
  }

  /**
   * Get an outbox event by ID
   *
   * @param eventId OutboxEvent.id
   * @returns OutboxEvent or null if not found
   */
  async getEvent(eventId: string): Promise<OutboxEvent | null> {
    return this.prisma.outboxEvent.findUnique({
      where: { id: eventId },
    }) as Promise<OutboxEvent | null>
  }

  /**
   * Get events by aggregate
   *
   * @param aggregateId Aggregate ID
   * @param aggregateType Aggregate type
   * @param limit Maximum number of events to retrieve
   * @returns Array of OutboxEvents for the aggregate
   */
  async getEventsByAggregate(
    aggregateId: string,
    aggregateType: string,
    limit: number = 100,
  ): Promise<OutboxEvent[]> {
    return this.prisma.outboxEvent.findMany({
      where: { aggregateId, aggregateType },
      orderBy: { createdAt: 'desc' },
      take: limit,
    }) as Promise<OutboxEvent[]>
  }
}

/**
 * Factory function to create an OutboxService instance
 *
 * @param prisma Prisma client
 * @returns OutboxService instance
 */
export function createOutboxService(prisma: PrismaClient): OutboxService {
  return new OutboxService(prisma)
}
