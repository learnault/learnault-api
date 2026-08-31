import 'dotenv/config'
import { randomUUID } from 'crypto'
import prisma from '../src/config/database'
import { registerOutboxHandlers } from '../src/jobs/handler-registrations'
import { createOutboxRelay } from '../src/workers/outbox-relay'

const TAG = 'relay-evidence'

const relay = createOutboxRelay({
  prisma,
  handlers: registerOutboxHandlers({ prisma }),
})

function banner(title: string): void {
  console.log('')
  console.log('='.repeat(64))
  console.log(` ${title}`)
  console.log('='.repeat(64))
}

async function cleanup(): Promise<void> {
  const users = await prisma.user.findMany({
    where: { username: { startsWith: TAG } },
    select: { id: true },
  })
  const ids = users.map((u) => u.id)

  await prisma.outboxEvent.deleteMany({
    where: { source: { in: [TAG, 'relay.user-created'] } },
  })
  if (ids.length > 0) {
    await prisma.walletProvisioningJob.deleteMany({
      where: { wallet: { userId: { in: ids } } },
    })
    await prisma.wallet.deleteMany({ where: { userId: { in: ids } } })
    await prisma.user.deleteMany({ where: { id: { in: ids } } })
  }
}

async function makeUser(suffix: string, withConsent: boolean): Promise<string> {
  const user = await prisma.user.create({
    data: {
      email: `${TAG}-${suffix}@example.com`,
      username: `${TAG}-${suffix}`,
      password: 'x',
      role: 'LEARNER',
      isVerified: true,
      status: 'ACTIVE',
    },
  })

  if (withConsent) {
    await prisma.consentRecord.create({
      data: {
        userId: user.id,
        purpose: 'custodial_wallet',
        policyVersion: '1',
        status: 'granted',
        source: 'api',
      },
    })
  }

  return user.id
}

async function emit(
  eventType: string,
  aggregateId: string,
  payload: unknown,
): Promise<string> {
  const event = await prisma.outboxEvent.create({
    data: {
      id: randomUUID(),
      aggregateId,
      aggregateType: 'User',
      eventType,
      eventVersion: 1,
      payload: JSON.stringify(payload),
      status: 'PENDING',
      source: TAG,
    },
  })

  return event.id
}

async function fastForwardBackoff(): Promise<void> {
  await prisma.jobAttempt.updateMany({
    where: { status: 'PENDING' },
    data: { availableAt: new Date() },
  })
}

async function drain(ticks: number): Promise<void> {
  for (let i = 0; i < ticks; i++) {
    await fastForwardBackoff()
    const summary = await relay.runOnce()
    if (
      summary.materialized === 0 &&
      summary.dispatched === 0 &&
      summary.failed === 0 &&
      summary.unhandled === 0
    ) {
      break
    }
  }
}

async function showEvents(): Promise<void> {
  const events = await prisma.outboxEvent.findMany({
    where: { source: { in: [TAG, 'relay.user-created'] } },
    orderBy: { createdAt: 'asc' },
    select: {
      id: true,
      eventType: true,
      status: true,
      jobAttempts: { select: { jobType: true, status: true, attempt: true } },
    },
  })

  for (const event of events) {
    const jobs = event.jobAttempts
      .map((j) => `${j.jobType}=${j.status}(attempt ${j.attempt})`)
      .join('  ')
    console.log(
      `  ${event.eventType.padEnd(28)} ${event.status.padEnd(12)} ${jobs}`,
    )
  }
}

async function main(): Promise<void> {
  await cleanup()

  banner('A. Dispatch by event type')
  const okUser = await makeUser('ok', true)
  await emit('UserCreated', okUser, {
    userId: okUser,
    email: `${TAG}-ok@example.com`,
    role: 'LEARNER',
  })
  await drain(6)
  console.log('')
  await showEvents()
  console.log('')
  console.log(
    '  One UserCreated event fanned out to its handler, which emitted',
  )
  console.log(
    '  WalletProvisioningRequested; the relay dispatched that to a different handler.',
  )

  banner('B. Event type with no registered handler')
  await emit('ModuleCompleted', okUser, {
    completionId: randomUUID(),
    userId: okUser,
    moduleId: randomUUID(),
    score: 90,
  })
  const summary = await relay.runOnce()
  console.log('')
  console.log(`  relay summary: ${JSON.stringify(summary)}`)
  const unhandled = await prisma.outboxEvent.findFirst({
    where: { source: TAG, eventType: 'ModuleCompleted' },
    select: { status: true },
  })
  console.log(
    `  ModuleCompleted -> ${unhandled?.status} (dead-lettered, not left PENDING)`,
  )

  banner('C. Failing handler dead-letters, then replays cleanly')
  const blockedUser = await makeUser('blocked', false)
  const blockedEvent = await emit('UserCreated', blockedUser, {
    userId: blockedUser,
    email: `${TAG}-blocked@example.com`,
    role: 'LEARNER',
  })
  console.log('')
  console.log(
    '  User has no custodial-wallet consent, so the handler keeps failing.',
  )
  await drain(12)

  const dead = await prisma.outboxEvent.findUnique({
    where: { id: blockedEvent },
    select: {
      status: true,
      jobAttempts: { select: { status: true, attempt: true, lastError: true } },
    },
  })
  const failedJob = dead?.jobAttempts[0]
  console.log(`  event  -> ${dead?.status}`)
  console.log(
    `  job    -> ${failedJob?.status} after ${failedJob?.attempt} attempts`,
  )
  console.log(`  error  -> ${failedJob?.lastError?.split('\n')[0]}`)

  const before = await prisma.wallet.count({ where: { userId: blockedUser } })

  console.log('')
  console.log('  Operator grants the missing consent, then replays:')
  await prisma.consentRecord.create({
    data: {
      userId: blockedUser,
      purpose: 'custodial_wallet',
      policyVersion: '1',
      status: 'granted',
      source: 'api',
    },
  })
  await relay.replayDeadLetter(blockedEvent)
  await drain(6)

  const replayed = await prisma.outboxEvent.findUnique({
    where: { id: blockedEvent },
    select: {
      status: true,
      jobAttempts: { select: { jobType: true, status: true } },
    },
  })
  const after = await prisma.wallet.count({ where: { userId: blockedUser } })

  console.log(`  event  -> ${replayed?.status}`)
  console.log(
    `  jobs   -> ${replayed?.jobAttempts.map((j) => `${j.jobType}=${j.status}`).join('  ')}`,
  )
  console.log(`  wallets for user: ${before} before replay, ${after} after`)

  banner('D. Re-delivering an already-published event is idempotent')
  await prisma.jobAttempt.updateMany({
    where: { outboxEventId: blockedEvent },
    data: {
      status: 'PENDING',
      attempt: 0,
      availableAt: new Date(),
      leaseToken: null,
      leasedUntil: null,
    },
  })
  await prisma.outboxEvent.update({
    where: { id: blockedEvent },
    data: { status: 'PENDING' },
  })
  console.log('')
  console.log('  Forcing the same event through the relay a second time:')
  await drain(6)

  const redelivered = await prisma.outboxEvent.findUnique({
    where: { id: blockedEvent },
    select: { status: true },
  })
  const afterRedelivery = await prisma.wallet.count({
    where: { userId: blockedUser },
  })
  const walletJobs = await prisma.walletProvisioningJob.count({
    where: { wallet: { userId: blockedUser } },
  })

  console.log(`  event -> ${redelivered?.status}`)
  console.log(
    `  wallets for user: ${after} before re-delivery, ${afterRedelivery} after; provisioning jobs: ${walletJobs}`,
  )
  console.log('  The handler ran again and produced no second wallet.')

  banner('Final state')
  await showEvents()

  await cleanup()
  console.log('')
  console.log('Evidence complete.')
}

main()
  .then(() => prisma.$disconnect())
  .then(() => process.exit(0))
  .catch(async (error) => {
    console.error('FAILED:', error)
    await prisma.$disconnect().catch(() => undefined)
    process.exit(1)
  })
