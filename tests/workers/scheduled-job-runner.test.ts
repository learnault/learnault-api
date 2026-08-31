import { describe, it, expect, vi, beforeEach } from 'vitest'
import type { SchedulerConfig } from '../../src/config/scheduler'
import { QueueMetricsRegistry } from '../../src/workers/queue-metrics'
import {
  ScheduledJobRunner,
  type QueueLeaseApi,
} from '../../src/workers/scheduled-job-runner'
import type { ScheduledQueue } from '../../src/workers/queue-registry'

vi.mock('../../src/utils/logger', () => ({
  default: {
    info: vi.fn(),
    warn: vi.fn(),
    error: vi.fn(),
    debug: vi.fn(),
  },
}))

const silentLog = {
  info: vi.fn(),
  warn: vi.fn(),
  error: vi.fn(),
  debug: vi.fn(),
}

function testConfig(overrides: Partial<SchedulerConfig> = {}): SchedulerConfig {
  return {
    intervalMs: 10,
    leaseMs: 2_000,
    shutdownTimeoutMs: 1_000,
    inProcess: false,
    only: [],
    disabled: [],
    ownerId: 'test-runner',
    isEnabled(queueName: string) {
      return (
        !this.disabled.includes(queueName) &&
        (this.only.length === 0 || this.only.includes(queueName))
      )
    },
    intervalFor() {
      return this.intervalMs
    },
    leaseFor() {
      return this.leaseMs
    },
    ...overrides,
  } as SchedulerConfig
}

class FakeLeaseStore implements QueueLeaseApi {
  private readonly rows = new Map<string, { token: string; until: number }>()
  private seq = 0

  acquireQueueLease = vi.fn(
    async (options: {
      queueName: string
      leaseMs?: number
      owner?: string
    }) => {
      const now = Date.now()
      const leaseMs = options.leaseMs ?? 60_000
      const current = this.rows.get(options.queueName)

      if (current && current.until > now) {
        return null
      }

      const leaseToken = `${options.owner ?? 'anon'}-${++this.seq}`
      this.rows.set(options.queueName, {
        token: leaseToken,
        until: now + leaseMs,
      })

      return {
        queueName: options.queueName,
        leaseToken,
        leasedUntil: new Date(now + leaseMs),
      }
    },
  )

  renewQueueLease = vi.fn(
    async (queueName: string, leaseToken: string, leaseMs = 60_000) => {
      const current = this.rows.get(queueName)
      if (!current || current.token !== leaseToken) return false
      current.until = Date.now() + leaseMs

      return true
    },
  )

  releaseQueueLease = vi.fn(async (queueName: string, leaseToken: string) => {
    const current = this.rows.get(queueName)
    if (!current || current.token !== leaseToken) return false
    this.rows.delete(queueName)

    return true
  })

  hold(queueName: string, forMs: number): void {
    this.rows.set(queueName, {
      token: 'foreign-holder',
      until: Date.now() + forMs,
    })
  }
}

async function waitFor(
  predicate: () => boolean,
  timeoutMs = 2_000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs
  while (!predicate()) {
    if (Date.now() > deadline) {
      throw new Error('waitFor timed out')
    }
    await new Promise((resolve) => setTimeout(resolve, 5))
  }
}

interface FakeRow {
  id: string
  nextAttemptAt: Date
}

function fakeQueue(
  name: string,
  rows: FakeRow[],
  processed: string[],
  drainImpl?: () => Promise<void>,
): ScheduledQueue {
  return {
    name,
    drain:
      drainImpl ??
      (async () => {
        const now = Date.now()
        const due = rows.filter((row) => row.nextAttemptAt.getTime() <= now)
        for (const row of due) {
          rows.splice(rows.indexOf(row), 1)
          processed.push(row.id)
        }
      }),
    inspect: async () => {
      const now = Date.now()
      const due = rows.filter((row) => row.nextAttemptAt.getTime() <= now)
      const oldest = [...due].sort(
        (a, b) => a.nextAttemptAt.getTime() - b.nextAttemptAt.getTime(),
      )[0]

      return {
        depth: rows.length,
        due: due.length,
        oldestDueAt: oldest?.nextAttemptAt ?? null,
      }
    },
  }
}

describe('ScheduledJobRunner', () => {
  let leases: FakeLeaseStore
  let metrics: QueueMetricsRegistry

  beforeEach(() => {
    vi.clearAllMocks()
    leases = new FakeLeaseStore()
    metrics = new QueueMetricsRegistry()
  })

  it('drains due rows on a timer with no inbound traffic', async () => {
    const processed: string[] = []
    const rows: FakeRow[] = [
      { id: 'row-1', nextAttemptAt: new Date(Date.now() - 1) },
    ]

    const runner = new ScheduledJobRunner({
      queues: [fakeQueue('email', rows, processed)],
      leaseService: leases,
      config: testConfig(),
      metrics,
      log: silentLog,
    })

    runner.start()
    await waitFor(() => processed.length === 1)
    await runner.stop()

    expect(processed).toEqual(['row-1'])
  })

  it('picks up a row whose nextAttemptAt falls due within one interval', async () => {
    const processed: string[] = []
    const rows: FakeRow[] = [
      { id: 'retry-1', nextAttemptAt: new Date(Date.now() + 40) },
    ]

    const runner = new ScheduledJobRunner({
      queues: [fakeQueue('email', rows, processed)],
      leaseService: leases,
      config: testConfig({ intervalMs: 10 }),
      metrics,
      log: silentLog,
    })

    runner.start()

    await new Promise((resolve) => setTimeout(resolve, 15))
    expect(processed).toEqual([])

    await waitFor(() => processed.length === 1)
    await runner.stop()

    expect(processed).toEqual(['retry-1'])
  })

  it('skips a tick when another holder owns the queue lease', async () => {
    const processed: string[] = []
    const rows: FakeRow[] = [
      { id: 'row-1', nextAttemptAt: new Date(Date.now() - 1) },
    ]
    leases.hold('email', 60_000)

    const runner = new ScheduledJobRunner({
      queues: [fakeQueue('email', rows, processed)],
      leaseService: leases,
      config: testConfig(),
      metrics,
      log: silentLog,
    })

    const outcomes = await runner.runOnce()

    expect(outcomes.email).toBe('skipped')
    expect(processed).toEqual([])
    expect(metrics.snapshot()[0].skipped).toBe(1)
    expect(metrics.snapshot()[0].attempts).toBe(0)
  })

  it('never lets two replicas process the same row twice', async () => {
    const processed: string[] = []
    const rows: FakeRow[] = Array.from({ length: 25 }, (_, index) => ({
      id: `row-${index}`,
      nextAttemptAt: new Date(Date.now() - 1),
    }))

    const slowDrain = async () => {
      const now = Date.now()
      const due = rows.filter((row) => row.nextAttemptAt.getTime() <= now)
      for (const row of due) {
        const index = rows.indexOf(row)
        if (index === -1) continue
        rows.splice(index, 1)
        await new Promise((resolve) => setTimeout(resolve, 1))
        processed.push(row.id)
      }
    }

    const makeRunner = (owner: string) =>
      new ScheduledJobRunner({
        queues: [fakeQueue('email', rows, processed, slowDrain)],
        leaseService: leases,
        config: testConfig({ ownerId: owner, intervalMs: 5 }),
        metrics: new QueueMetricsRegistry(),
        log: silentLog,
      })

    const replicaA = makeRunner('replica-a')
    const replicaB = makeRunner('replica-b')

    replicaA.start()
    replicaB.start()

    await waitFor(() => processed.length === 25, 5_000)
    await Promise.all([replicaA.stop(), replicaB.stop()])

    expect(new Set(processed).size).toBe(25)
    expect(processed).toHaveLength(25)
  })

  it('releases the lease and records a failure when a drain throws', async () => {
    const failing: ScheduledQueue = {
      name: 'webhook',
      drain: async () => {
        throw new Error('provider down')
      },
      inspect: async () => ({
        depth: 3,
        due: 3,
        oldestDueAt: new Date(Date.now() - 5_000),
      }),
    }

    const runner = new ScheduledJobRunner({
      queues: [failing],
      leaseService: leases,
      config: testConfig(),
      metrics,
      log: silentLog,
    })

    const outcomes = await runner.runOnce()

    expect(outcomes.webhook).toBe('failed')
    expect(leases.releaseQueueLease).toHaveBeenCalledOnce()

    const [snapshot] = metrics.snapshot()
    expect(snapshot.failures).toBe(1)
    expect(snapshot.lastError).toBe('provider down')

    expect(await runner.runOnce()).toEqual({ webhook: 'failed' })
    expect(leases.acquireQueueLease).toHaveBeenCalledTimes(2)
  })

  it('emits depth, due, attempt, failure and lag metrics per queue', async () => {
    const oldestDueAt = new Date(Date.now() - 30_000)
    const queue: ScheduledQueue = {
      name: 'notification',
      drain: async () => undefined,
      inspect: async () => ({ depth: 7, due: 4, oldestDueAt }),
    }

    const runner = new ScheduledJobRunner({
      queues: [queue],
      leaseService: leases,
      config: testConfig(),
      metrics,
      log: silentLog,
    })

    await runner.runOnce()

    const [snapshot] = metrics.snapshot()
    expect(snapshot.queue).toBe('notification')
    expect(snapshot.depth).toBe(7)
    expect(snapshot.due).toBe(4)
    expect(snapshot.attempts).toBe(1)
    expect(snapshot.failures).toBe(0)
    expect(snapshot.lagMs).toBeGreaterThanOrEqual(30_000)
    expect(snapshot.lastRunAt).not.toBeNull()
  })

  it('drains the in-flight tick and releases its lease on shutdown', async () => {
    let started = false

    const queue: ScheduledQueue = {
      name: 'data-export',
      drain: async () => {
        started = true
        await new Promise((resolve) => setTimeout(resolve, 60))
      },
      inspect: async () => ({ depth: 1, due: 1, oldestDueAt: null }),
    }

    const runner = new ScheduledJobRunner({
      queues: [queue],
      leaseService: leases,
      config: testConfig(),
      metrics,
      log: silentLog,
    })

    runner.start()
    await waitFor(() => started)

    await runner.stop()

    expect(leases.releaseQueueLease).toHaveBeenCalledOnce()
    expect(
      await leases.acquireQueueLease({ queueName: 'data-export' }),
    ).not.toBeNull()

    const ticksAtStop = metrics.snapshot()[0].attempts
    await new Promise((resolve) => setTimeout(resolve, 40))
    expect(metrics.snapshot()[0].attempts).toBe(ticksAtStop)
  })

  it('honours the disabled and allow lists when registering queues', () => {
    const queues = [
      fakeQueue('email', [], []),
      fakeQueue('webhook', [], []),
      fakeQueue('notification', [], []),
    ]

    const disabled = new ScheduledJobRunner({
      queues,
      leaseService: leases,
      config: testConfig({ disabled: ['webhook'] }),
      log: silentLog,
    })
    expect(disabled.registeredQueues).toEqual(['email', 'notification'])

    const only = new ScheduledJobRunner({
      queues,
      leaseService: leases,
      config: testConfig({ only: ['notification'] }),
      log: silentLog,
    })
    expect(only.registeredQueues).toEqual(['notification'])
  })
})
