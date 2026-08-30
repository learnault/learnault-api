import 'dotenv/config'
import prisma from '../config/database'
import { registerOutboxHandlers } from '../jobs/handler-registrations'
import logger from '../utils/logger'
import { createOutboxRelay } from './outbox-relay'

async function main(): Promise<void> {
  const [command, ...args] = process.argv.slice(2)
  const relay = createOutboxRelay({ prisma, handlers: registerOutboxHandlers({ prisma }) })

  if (command === 'list') {
    const events = await relay.deadLetterEvents()

    if (events.length === 0) {
      logger.info('[replay] no dead-lettered events')
    } else {
      for (const event of events) {
        logger.info(`[replay] ${event.id}  ${event.eventType}  ${event.lastError ?? ''}`)
      }
    }

    return
  }

  if (command === 'replay') {
    if (args.length === 0) {
      throw new Error('usage: outbox:replay replay <eventId> [<eventId>...]')
    }

    for (const eventId of args) {
      const reset = await relay.replayDeadLetter(eventId)
      logger.info(`[replay] ${eventId}: ${reset} job(s) reset to PENDING`)
    }

    return
  }

  throw new Error('usage: outbox:replay <list|replay> [eventId...]')
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    logger.error('[replay] failed:', error)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(1)
  })
