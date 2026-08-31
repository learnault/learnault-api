import logger from '../utils/logger'

export type TickOutcome = 'ran' | 'skipped' | 'failed'

export interface QueueDepthSnapshot {
  depth: number
  due: number
  oldestDueAt: Date | null
}

export interface QueueTickSample {
  queue: string
  outcome: TickOutcome
  durationMs: number
  depth: number
  due: number
  lagMs: number
  error?: string
}

export interface QueueMetricsSnapshot {
  queue: string
  attempts: number
  failures: number
  skipped: number
  depth: number
  due: number
  lagMs: number
  lastDurationMs: number
  lastRunAt: string | null
  lastError: string | null
}

const emptyMetrics = (queue: string): QueueMetricsSnapshot => ({
  queue,
  attempts: 0,
  failures: 0,
  skipped: 0,
  depth: 0,
  due: 0,
  lagMs: 0,
  lastDurationMs: 0,
  lastRunAt: null,
  lastError: null,
})

export class QueueMetricsRegistry {
  private readonly queues = new Map<string, QueueMetricsSnapshot>()

  record(sample: QueueTickSample): QueueMetricsSnapshot {
    const current = this.queues.get(sample.queue) ?? emptyMetrics(sample.queue)

    const next: QueueMetricsSnapshot = {
      ...current,
      depth: sample.depth,
      due: sample.due,
      lagMs: sample.lagMs,
      lastDurationMs: sample.durationMs,
    }

    if (sample.outcome === 'skipped') {
      next.skipped = current.skipped + 1
    } else {
      next.attempts = current.attempts + 1
      next.lastRunAt = new Date().toISOString()
    }

    if (sample.outcome === 'failed') {
      next.failures = current.failures + 1
      next.lastError = sample.error ?? 'unknown error'
    } else if (sample.outcome === 'ran') {
      next.lastError = null
    }

    this.queues.set(sample.queue, next)
    this.emit(sample, next)

    return next
  }

  snapshot(): QueueMetricsSnapshot[] {
    return [...this.queues.values()].sort((a, b) =>
      a.queue.localeCompare(b.queue),
    )
  }

  reset(): void {
    this.queues.clear()
  }

  private emit(sample: QueueTickSample, totals: QueueMetricsSnapshot): void {
    const meta = {
      queue: sample.queue,
      outcome: sample.outcome,
      depth: totals.depth,
      due: totals.due,
      lagMs: totals.lagMs,
      durationMs: totals.lastDurationMs,
      attempts: totals.attempts,
      failures: totals.failures,
      skipped: totals.skipped,
      ...(sample.error ? { error: sample.error } : {}),
    }

    if (sample.outcome === 'failed') {
      logger.error('[scheduler] queue tick failed', meta)
    } else if (sample.outcome === 'skipped') {
      logger.debug(
        '[scheduler] queue tick skipped (lease held elsewhere)',
        meta,
      )
    } else {
      logger.info('[scheduler] queue tick', meta)
    }
  }
}

export const queueMetrics = new QueueMetricsRegistry()
