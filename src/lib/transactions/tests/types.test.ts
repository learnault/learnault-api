/**
 * Types Test: Verify transaction outbox types are exported correctly
 */

import { describe, it, expect } from 'vitest'
import type {
  OutboxEvent,
  OutboxEventStatus,
  JobAttempt,
  JobAttemptStatus,
  RolledBackRecord,
  JobConfig,
  EventSchema,
  JobResult,
  CreateOutboxEventOptions,
  LeaseJobOptions,
  LeaseJobResult,
} from '../types'

describe('Transaction Outbox Types', () => {
  it('should export OutboxEvent type', () => {
    const event: OutboxEvent = {
      id: 'event-1',
      aggregateId: 'user-1',
      aggregateType: 'User',
      eventType: 'UserCreated',
      eventVersion: 1,
      payload: { userId: 'user-1' },
      status: 'PENDING',
      publishedAt: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(event.id).toBe('event-1')
    expect(event.status).toBe('PENDING')
  })

  it('should export JobAttempt type', () => {
    const job: JobAttempt = {
      id: 'job-1',
      outboxEventId: 'event-1',
      jobType: 'email.send',
      jobName: 'Send email',
      status: 'PENDING',
      leaseToken: null,
      leasedUntil: null,
      availableAt: new Date(),
      attempt: 0,
      maxAttempts: 3,
      backoffMultiplier: 2.0,
      backoffBaseMs: 1000,
      lastError: null,
      lastAttemptAt: null,
      idempotencyKey: null,
      completedAt: null,
      result: null,
      createdAt: new Date(),
      updatedAt: new Date(),
    }

    expect(job.id).toBe('job-1')
    expect(job.jobType).toBe('email.send')
  })

  it('should export RolledBackRecord type', () => {
    const record: RolledBackRecord = {
      id: 'rolled-back-1',
      recordType: 'OutboxEvent',
      recordId: 'event-1',
      createdAt: new Date(),
    }

    expect(record.recordType).toBe('OutboxEvent')
  })

  it('should export JobConfig type', () => {
    const config: JobConfig = {
      jobType: 'email.send',
      jobName: 'Send email',
      maxAttempts: 5,
      backoffMultiplier: 2.0,
      backoffBaseMs: 1000,
    }

    expect(config.maxAttempts).toBe(5)
  })

  it('should export EventSchema type', () => {
    const schema: EventSchema = {
      version: 1,
      eventType: 'UserCreated',
      validate: async (payload) => {
        if (!payload) throw new Error('Invalid payload')
      },
    }

    expect(schema.version).toBe(1)
  })

  it('should export JobResult type', () => {
    const result: JobResult = {
      success: true,
      idempotencyKey: 'idempotent-1',
      result: { txHash: 'abc123' },
    }

    expect(result.success).toBe(true)
  })

  it('should support OutboxEventStatus union type', () => {
    const statuses: OutboxEventStatus[] = [
      'PENDING',
      'PROCESSING',
      'PUBLISHED',
      'DEAD_LETTER',
      'ROLLED_BACK',
    ]

    expect(statuses).toHaveLength(5)
  })

  it('should support JobAttemptStatus union type', () => {
    const statuses: JobAttemptStatus[] = [
      'PENDING',
      'LEASED',
      'COMPLETED',
      'FAILED',
      'DEAD_LETTER',
      'ROLLED_BACK',
    ]

    expect(statuses).toHaveLength(6)
  })

  it('should export CreateOutboxEventOptions type', () => {
    const options: CreateOutboxEventOptions = {
      aggregateId: 'user-1',
      aggregateType: 'User',
      eventType: 'UserCreated',
      eventVersion: 1,
      payload: { userId: 'user-1' },
    }

    expect(options.eventType).toBe('UserCreated')
  })

  it('should export LeaseJobOptions type', () => {
    const options: LeaseJobOptions = {
      jobType: 'email.send',
      maxLeaseMs: 30000,
    }

    expect(options.jobType).toBe('email.send')
  })

  it('should export LeaseJobResult type', () => {
    const result: LeaseJobResult = {
      jobId: 'job-1',
      leaseToken: 'token-123',
      leasedUntil: new Date(),
      attempt: 0,
      payload: { email: 'test@example.com' },
    }

    expect(result.jobId).toBe('job-1')
  })
})
