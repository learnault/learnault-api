import { Server } from 'http'
import app from './app'
import { schedulerConfig } from './config/scheduler'
import logger from './utils/logger'
import prisma from './config/database'
import { createScheduledJobRunner, ScheduledJobRunner } from './workers/scheduled-job-runner'

const PORT = process.env.PORT || 5000
const SHUTDOWN_TIMEOUT_MS = parseInt(process.env.SHUTDOWN_TIMEOUT_MS || '30000', 10)

const server: Server = app.listen(PORT, () => {
  logger.info(`Server running on port ${PORT}`)
})

let isShuttingDown = false
let scheduler: ScheduledJobRunner | null = null

if (schedulerConfig.inProcess) {
  scheduler = createScheduledJobRunner({ prisma })
  scheduler.start()
  logger.info(
    `In-process scheduler enabled for queues: ${scheduler.registeredQueues.join(', ') || 'none'}`
  )
}

/**
 * Graceful shutdown handler
 * Drains HTTP connections, stops background jobs, and closes database connections
 */
async function gracefulShutdown(signal: string): Promise<void> {
  if (isShuttingDown) {
    logger.warn('Shutdown already in progress, ignoring additional signal')

    return
  }

  isShuttingDown = true
  logger.info(`Received ${signal}, starting graceful shutdown...`)

  // Set a hard deadline for shutdown
  const shutdownTimer = setTimeout(() => {
    logger.error(`Shutdown timeout (${SHUTDOWN_TIMEOUT_MS}ms) exceeded, forcing exit`)
    process.exit(1)
  }, SHUTDOWN_TIMEOUT_MS)

  try {
    // 1. Stop accepting new connections
    logger.info('Closing HTTP server...')
    await new Promise<void>((resolve, reject) => {
      server.close((err) => {
        if (err) {
          logger.error('Error closing HTTP server:', err)
          reject(err)
        } else {
          logger.info('HTTP server closed')
          resolve()
        }
      })
    })

    // 2. Stop background jobs
    if (scheduler) {
      logger.info('Stopping in-process scheduler...')
      await scheduler.stop()
      scheduler = null
    }

    // 3. Close database connections
    logger.info('Closing database connections...')
    await prisma.$disconnect()
    logger.info('Database connections closed')

    // 4. Perform any final cleanup
    logger.info('Graceful shutdown completed successfully')

    // Clear the shutdown timer and exit cleanly
    clearTimeout(shutdownTimer)
    process.exit(0)
  } catch (error) {
    logger.error('Error during graceful shutdown:', error)
    clearTimeout(shutdownTimer)
    process.exit(1)
  }
}

// Register shutdown handlers
process.on('SIGTERM', () => gracefulShutdown('SIGTERM'))
process.on('SIGINT', () => gracefulShutdown('SIGINT'))

// Handle uncaught exceptions and rejections
process.on('uncaughtException', (error: Error) => {
  logger.error('Uncaught exception:', error)
  gracefulShutdown('uncaughtException')
})

process.on('unhandledRejection', (reason: any) => {
  logger.error('Unhandled rejection:', reason)
  gracefulShutdown('unhandledRejection')
})
