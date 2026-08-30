import { describe, it, expect, vi, beforeEach } from 'vitest'
import { EventSchemaRegistry } from '../../src/lib/transactions/event-schema'
import { OutboxHandlerRegistry } from '../../src/lib/transactions/handler-registry'
import { OutboxRelay } from '../../src/workers/outbox-relay'
import type { OutboxEventHandler } from '../../src/lib/transactions/types'

vi.mock('../../src/utils/logger', () => ({
  default: { info: vi.fn(), warn: vi.fn(), error: vi.fn(), debug: vi.fn() },
}))

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

interface FakeEvent {
  id: string
  eventType: string
  eventVersion: number
  aggregateId: string
  aggregateType: string
  payload: string
  status: string
}

interface FakeJob {
  id: string
  outboxEventId: string
  jobType: string
  status: string
  attempt: number
  maxAttempts: number
  lastError: string | null
  availableAt: number
}

class FakeDb {
  events: FakeEvent[] = []
  jobs: FakeJob[] = []
  private seq = 0

  addEvent(
    partial: Partial<FakeEvent> & { eventType: string; payload: unknown },
  ): FakeEvent {
    const event: FakeEvent = {
      id: partial.id ?? `evt-${++this.seq}`,
      eventType: partial.eventType,
      eventVersion: partial.eventVersion ?? 1,
      aggregateId: partial.aggregateId ?? 'agg-1',
      aggregateType: partial.aggregateType ?? 'User',
      payload: JSON.stringify(partial.payload),
      status: partial.status ?? 'PENDING',
    }
    this.events.push(event)

    return event
  }

  get outboxEvent() {
    return {
      findMany: async (args: any) => {
        let rows = this.events.filter((e) => e.status === args.where.status)
        if (args.where.jobAttempts?.none) {
          rows = rows.filter(
            (e) => !this.jobs.some((j) => j.outboxEventId === e.id),
          )
        }

        return rows.slice(0, args.take ?? rows.length)
      },
      update: async (args: any) => {
        const event = this.events.find((e) => e.id === args.where.id)!
        Object.assign(event, args.data)

        return event
      },
      count: async () =>
        this.events.filter((e) => e.status === 'PENDING').length,
      findFirst: async () =>
        this.events.find((e) => e.status === 'PENDING') ?? null,
    }
  }

  get jobAttempt() {
    return {
      create: async (args: any) => {
        const job: FakeJob = {
          id: `job-${++this.seq}`,
          outboxEventId: args.data.outboxEventId,
          jobType: args.data.jobType,
          status: args.data.status,
          attempt: args.data.attempt,
          maxAttempts: args.data.maxAttempts,
          lastError: null,
          availableAt: Date.now(),
        }
        this.jobs.push(job)

        return job
      },
      findUnique: async (args: any) => {
        const job = this.jobs.find((j) => j.id === args.where.id)
        if (!job) return null

        return {
          ...job,
          outboxEvent:
            this.events.find((e) => e.id === job.outboxEventId) ?? null,
        }
      },
      findMany: async (args: any) =>
        this.jobs.filter(
          (j) =>
            j.outboxEventId === args.where.outboxEventId &&
            j.status === args.where.status,
        ),
    }
  }

  async $transaction(arg: any) {
    return Array.isArray(arg) ? Promise.all(arg) : arg(this)
  }
}

class FakeLeaseService {
  constructor(private db: FakeDb) {}

  async leaseJob({ jobType }: { jobType: string }) {
    const job = this.db.jobs.find(
      (j) =>
        j.jobType === jobType &&
        j.status === 'PENDING' &&
        j.availableAt <= Date.now(),
    )
    if (!job) return null
    job.status = 'LEASED'
    const event = this.db.events.find((e) => e.id === job.outboxEventId)!

    return {
      jobId: job.id,
      leaseToken: `tok-${job.id}`,
      leasedUntil: new Date(Date.now() + 30_000),
      attempt: job.attempt,
      payload: JSON.parse(event.payload),
    }
  }

  async completeJob(jobId: string) {
    const job = this.db.jobs.find((j) => j.id === jobId)!
    job.status = 'COMPLETED'
    const siblings = this.db.jobs.filter(
      (j) => j.outboxEventId === job.outboxEventId,
    )
    if (siblings.every((j) => j.status === 'COMPLETED')) {
      this.db.events.find((e) => e.id === job.outboxEventId)!.status =
        'PUBLISHED'
    }
  }

  async failJob(jobId: string, _token: string, error: Error | string) {
    const job = this.db.jobs.find((j) => j.id === jobId)!
    job.attempt += 1
    job.lastError = error instanceof Error ? error.message : String(error)

    if (job.attempt >= job.maxAttempts) {
      job.status = 'DEAD_LETTER'
      this.db.events.find((e) => e.id === job.outboxEventId)!.status =
        'DEAD_LETTER'
    } else {
      job.status = 'PENDING'
      job.availableAt = Date.now() + 60_000
    }
  }

  async resetJobForRetry(jobId: string) {
    const job = this.db.jobs.find((j) => j.id === jobId)!
    job.status = 'PENDING'
    job.attempt = 0
    job.lastError = null
    job.availableAt = Date.now()
  }

  releaseBackoff() {
    for (const job of this.db.jobs) job.availableAt = Date.now()
  }
}

function buildRelay(db: FakeDb, handlers: OutboxEventHandler[]) {
  const schemas = new EventSchemaRegistry()
  schemas.register({
    eventType: 'UserCreated',
    version: 1,
    validate: () => undefined,
  })
  schemas.register({
    eventType: 'OrderPlaced',
    version: 1,
    validate: () => undefined,
  })

  const registry = new OutboxHandlerRegistry(schemas)
  for (const handler of handlers) registry.register(handler)

  const leases = new FakeLeaseService(db)
  const relay = new OutboxRelay({
    prisma: db as any,
    handlers: registry,
    schemas,
    leaseService: leases as any,
    log: silentLog,
  })

  return { relay, leases }
}

describe('OutboxRelay', () => {
  let db: FakeDb

  beforeEach(() => {
    vi.clearAllMocks()
    db = new FakeDb()
  })

  it('dispatches an event to its registered handler and publishes it', async () => {
    const seen: unknown[] = []
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })

    const { relay } = buildRelay(db, [
      {
        name: 'h1',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async (ctx) => {
          seen.push(ctx.payload)
        },
      },
    ])

    const summary = await relay.runOnce()

    expect(summary).toMatchObject({ materialized: 1, dispatched: 1, failed: 0 })
    expect(seen).toEqual([{ userId: 'u1' }])
    expect(db.events[0].status).toBe('PUBLISHED')
  })

  it('routes each event only to handlers for its own type', async () => {
    const userSeen: string[] = []
    const orderSeen: string[] = []
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })
    db.addEvent({ eventType: 'OrderPlaced', payload: { orderId: 'o1' } })

    const { relay } = buildRelay(db, [
      {
        name: 'user-handler',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async (ctx) => {
          userSeen.push(ctx.eventId)
        },
      },
      {
        name: 'order-handler',
        eventType: 'OrderPlaced',
        eventVersion: 1,
        handle: async (ctx) => {
          orderSeen.push(ctx.eventId)
        },
      },
    ])

    await relay.runOnce()

    expect(userSeen).toEqual(['evt-1'])
    expect(orderSeen).toEqual(['evt-2'])
  })

  it('publishes only after every handler for the type succeeds', async () => {
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })
    let failNext = true

    const { relay, leases } = buildRelay(db, [
      {
        name: 'ok',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async () => undefined,
      },
      {
        name: 'flaky',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async () => {
          if (failNext) {
            failNext = false
            throw new Error('transient')
          }
        },
      },
    ])

    await relay.runOnce()
    expect(db.events[0].status).toBe('PENDING')

    leases.releaseBackoff()
    await relay.runOnce()
    expect(db.events[0].status).toBe('PUBLISHED')
  })

  it('dead-letters an event whose type has no registered handler', async () => {
    db.addEvent({ eventType: 'OrderPlaced', payload: { orderId: 'o1' } })

    const { relay } = buildRelay(db, [
      {
        name: 'user-handler',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async () => undefined,
      },
    ])

    const summary = await relay.runOnce()

    expect(summary.unhandled).toBe(1)
    expect(db.events[0].status).toBe('DEAD_LETTER')
    expect(silentLog.error).toHaveBeenCalledWith(
      expect.stringContaining('no handler registered'),
    )
  })

  it('dead-letters after max attempts without blocking other event types', async () => {
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })
    db.addEvent({ eventType: 'OrderPlaced', payload: { orderId: 'o1' } })

    const { relay, leases } = buildRelay(db, [
      {
        name: 'always-fails',
        eventType: 'UserCreated',
        eventVersion: 1,
        maxAttempts: 2,
        handle: async () => {
          throw new Error('provider down')
        },
      },
      {
        name: 'healthy',
        eventType: 'OrderPlaced',
        eventVersion: 1,
        handle: async () => undefined,
      },
    ])

    await relay.runOnce()
    leases.releaseBackoff()
    await relay.runOnce()

    const [userEvent, orderEvent] = db.events
    expect(userEvent.status).toBe('DEAD_LETTER')
    expect(orderEvent.status).toBe('PUBLISHED')
    expect(
      db.jobs.find((j) => j.jobType === 'always-fails')?.lastError,
    ).toContain('provider down')
  })

  it('replays a dead-lettered event without duplicating side effects', async () => {
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })
    const effects: string[] = []
    let healthy = false

    const { relay } = buildRelay(db, [
      {
        name: 'recovers',
        eventType: 'UserCreated',
        eventVersion: 1,
        maxAttempts: 1,
        handle: async (ctx) => {
          if (!healthy) throw new Error('downstream down')
          effects.push(ctx.eventId)
        },
      },
    ])

    await relay.runOnce()
    expect(db.events[0].status).toBe('DEAD_LETTER')
    expect(effects).toEqual([])

    healthy = true
    await relay.replayDeadLetter('evt-1')
    await relay.runOnce()

    expect(db.events[0].status).toBe('PUBLISHED')
    expect(effects).toEqual(['evt-1'])

    await relay.runOnce()
    expect(effects).toEqual(['evt-1'])
  })

  it('does not re-materialise jobs for an event it has already fanned out', async () => {
    db.addEvent({ eventType: 'UserCreated', payload: { userId: 'u1' } })

    const { relay } = buildRelay(db, [
      {
        name: 'h1',
        eventType: 'UserCreated',
        eventVersion: 1,
        handle: async () => undefined,
      },
    ])

    await relay.runOnce()
    await relay.runOnce()

    expect(db.jobs).toHaveLength(1)
  })
})
