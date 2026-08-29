import { config } from 'dotenv'
import os from 'os'

config()

const DEFAULT_INTERVAL_MS = 15_000
const DEFAULT_LEASE_MS = 60_000
const DEFAULT_SHUTDOWN_TIMEOUT_MS = 30_000

function toInt(value: string | undefined, fallback: number): number {
  const parsed = parseInt(value ?? '', 10)

  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

function toBool(value: string | undefined, fallback = false): boolean {
  if (value === undefined || value === '') return fallback

  return value === 'true' || value === '1'
}

function toList(value: string | undefined): string[] {
  return (value ?? '')
    .split(',')
    .map(entry => entry.trim())
    .filter(entry => entry.length > 0)
}

function envKeyFor(queueName: string): string {
  return `SCHEDULER_${queueName.replace(/[^a-zA-Z0-9]+/g, '_').toUpperCase()}_INTERVAL_MS`
}

export const schedulerConfig = {
  intervalMs: toInt(process.env.SCHEDULER_INTERVAL_MS, DEFAULT_INTERVAL_MS),
  leaseMs: toInt(process.env.SCHEDULER_LEASE_MS, DEFAULT_LEASE_MS),
  shutdownTimeoutMs: toInt(
    process.env.SCHEDULER_SHUTDOWN_TIMEOUT_MS,
    DEFAULT_SHUTDOWN_TIMEOUT_MS
  ),
  inProcess: toBool(process.env.SCHEDULER_IN_PROCESS, false),
  only: toList(process.env.SCHEDULER_QUEUES),
  disabled: toList(process.env.SCHEDULER_DISABLED_QUEUES),
  ownerId: process.env.SCHEDULER_OWNER_ID || `${os.hostname()}:${process.pid}`,

  isEnabled(queueName: string): boolean {
    if (this.disabled.includes(queueName)) return false

    return this.only.length === 0 || this.only.includes(queueName)
  },

  intervalFor(queueName: string): number {
    const override = process.env[envKeyFor(queueName)]
    if (override !== undefined) {
      return toInt(override, this.intervalMs)
    }

    if (queueName === 'account-lifecycle') {
      const legacy = parseInt(process.env.LIFECYCLE_SWEEP_INTERVAL_MS ?? '', 10)
      if (Number.isFinite(legacy) && legacy > 0) {
        return legacy
      }
    }

    return this.intervalMs
  },

  leaseFor(queueName: string): number {
    return Math.max(this.leaseMs, this.intervalFor(queueName) * 2)
  },
}

export type SchedulerConfig = typeof schedulerConfig
