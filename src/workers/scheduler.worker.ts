import 'dotenv/config'
import prisma from '../config/database'
import { schedulerConfig } from '../config/scheduler'
import logger from '../utils/logger'
import { createScheduledJobRunner } from './scheduled-job-runner'

const runner = createScheduledJobRunner({ prisma })

let isShuttingDown = false

async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn(
      '[scheduler] shutdown already in progress, ignoring additional signal',
    )

    return
  }

  isShuttingDown = true
  logger.info(`[scheduler] received ${signal}, starting graceful shutdown...`)

  const forceExit = setTimeout(() => {
    logger.error('[scheduler] shutdown deadline exceeded, forcing exit')
    process.exit(1)
  }, schedulerConfig.shutdownTimeoutMs + 5_000)

  try {
    await runner.stop()
    await prisma.$disconnect()
    clearTimeout(forceExit)
    logger.info('[scheduler] graceful shutdown completed')
    process.exit(0)
  } catch (error) {
    logger.error('[scheduler] error during graceful shutdown:', error)
    clearTimeout(forceExit)
    process.exit(1)
  }
}

process.on('SIGTERM', () => void gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => void gracefulShutdown('SIGINT'))

process.on('uncaughtException', (error: Error) => {
  logger.error('[scheduler] uncaught exception:', error)
  void gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason: unknown) => {
  logger.error('[scheduler] unhandled rejection:', reason)
  void gracefulShutdown('unhandledRejection')
})

logger.info(
  `[scheduler] starting runner ${schedulerConfig.ownerId} ` +
    `(base interval ${schedulerConfig.intervalMs}ms, lease ${schedulerConfig.leaseMs}ms)`,
)

runner.start()

if (runner.registeredQueues.length === 0) {
  logger.error(
    '[scheduler] no queues registered; check SCHEDULER_QUEUES / SCHEDULER_DISABLED_QUEUES',
  )
  process.exit(1)
}
