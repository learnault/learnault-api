import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { hash } from 'bcryptjs'

import { seedUserFixtures } from './fixtures/users'
import { seedModuleFixtures } from './fixtures/modules'
import type { SeedModule } from './fixtures/modules'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

const MS_PER_DAY = 24 * 60 * 60 * 1000
const DIFFICULTY_MULTIPLIER: Record<string, number> = {
  beginner: 1,
  intermediate: 1.4,
  advanced: 1.9,
  expert: 2.5,
}

function createPrng(seed: number) {
  let state = seed >>> 0
  return () => {
    state = (1664525 * state + 1013904223) >>> 0
    return state / 0xffffffff
  }
}

function scoreFor(module: SeedModule, rand: () => number) {
  const base = 66 + rand() * 28
  const penalty = (DIFFICULTY_MULTIPLIER[module.difficulty] - 1) * 5
  return Number(Math.max(60, Math.min(99, base - penalty)).toFixed(2))
}

function xlmAmount(module: SeedModule, rand: () => number) {
  return Number((module.reward * (1 + rand() * 0.3)).toFixed(2))
}

async function resetAllData() {
  console.log('🧹 Resetting all records...')
  await prisma.transaction.deleteMany()
  await prisma.credential.deleteMany()
  await prisma.completion.deleteMany()
  await prisma.webhookDelivery.deleteMany()
  await prisma.webhookEndpoint.deleteMany()
  await prisma.module.deleteMany()
  await prisma.user.deleteMany()
  console.log('✅ Reset complete')
}

async function upsertUsers(passwordHash: string) {
  for (const user of seedUserFixtures) {
    await prisma.user.upsert({
      where: { id: user.id },
      update: {
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
        walletAddress: user.walletAddress,
        password: passwordHash,
      },
      create: {
        id: user.id,
        email: user.email,
        username: user.username,
        role: user.role,
        status: user.status,
        isVerified: user.isVerified,
        walletAddress: user.walletAddress,
        password: passwordHash,
      },
    })
  }
  console.log(`✅ Upserted ${seedUserFixtures.length} users (learners, employers, admin)`)
}

async function upsertModules() {
  for (const moduleData of seedModuleFixtures) {
    await prisma.module.upsert({
      where: { id: moduleData.id },
      update: {
        title: moduleData.title,
        description: moduleData.description,
        category: moduleData.category,
        difficulty: moduleData.difficulty,
        reward: moduleData.reward,
      },
      create: moduleData,
    })
  }
  console.log(`✅ Upserted ${seedModuleFixtures.length} modules across all categories`)
}

async function seedLearningData() {
  const learners = seedUserFixtures.filter((u) => u.email.includes('.learner+'))
  const rand = createPrng(20260308)
  const completions = []
  const credentials = []
  const transactions = []

  for (const user of learners) {
    for (const moduleData of seedModuleFixtures) {
      const completed = rand() < 0.72
      if (!completed) continue

      const completedAt = new Date(Date.now() - Math.floor(rand() * 75) * MS_PER_DAY)
      const score = scoreFor(moduleData, rand)
      const completionId = `seed-completion-${user.id}-${moduleData.id}`

      completions.push(
        prisma.completion.upsert({
          where: { id: completionId },
          update: {
            userId: user.id,
            moduleId: moduleData.id,
            score,
            completedAt,
          },
          create: {
            id: completionId,
            userId: user.id,
            moduleId: moduleData.id,
            score,
            completedAt,
          },
        }),
      )

      const hasCredential = score >= 78 || rand() < 0.7
      if (hasCredential) {
        const credentialId = `seed-credential-${user.id}-${moduleData.id}`
        credentials.push(
          prisma.credential.upsert({
            where: { id: credentialId },
            update: {
              userId: user.id,
              moduleId: moduleData.id,
              onChainId: `cred_${user.id.slice(-5)}_${moduleData.id.slice(-5)}`,
              issuedAt: new Date(completedAt.getTime() + Math.floor(rand() * 12) * 60 * 60 * 1000),
            },
            create: {
              id: credentialId,
              userId: user.id,
              moduleId: moduleData.id,
              onChainId: `cred_${user.id.slice(-5)}_${moduleData.id.slice(-5)}`,
              issuedAt: new Date(completedAt.getTime() + Math.floor(rand() * 12) * 60 * 60 * 1000),
            },
          }),
        )
      }

      const rewardTxnId = `seed-transaction-reward-${user.id}-${moduleData.id}`
      const amount = xlmAmount(moduleData, rand)
      const rewardCreatedAt = new Date(completedAt.getTime() + 60 * 60 * 1000)
      transactions.push(
        prisma.transaction.upsert({
          where: { id: rewardTxnId },
          update: {
            userId: user.id,
            amount,
            type: 'module_reward',
            status: 'completed',
            createdAt: rewardCreatedAt,
          },
          create: {
            id: rewardTxnId,
            userId: user.id,
            amount,
            type: 'module_reward',
            status: 'completed',
            createdAt: rewardCreatedAt,
          },
        }),
      )
    }

    const payoutTxnId = `seed-transaction-withdrawal-${user.id}`
    transactions.push(
      prisma.transaction.upsert({
        where: { id: payoutTxnId },
        update: {
          userId: user.id,
          amount: Number((15 + rand() * 30).toFixed(2)),
          type: 'withdrawal',
          status: rand() < 0.85 ? 'completed' : 'pending',
          createdAt: new Date(Date.now() - Math.floor(rand() * 30) * MS_PER_DAY),
        },
        create: {
          id: payoutTxnId,
          userId: user.id,
          amount: Number((15 + rand() * 30).toFixed(2)),
          type: 'withdrawal',
          status: rand() < 0.85 ? 'completed' : 'pending',
          createdAt: new Date(Date.now() - Math.floor(rand() * 30) * MS_PER_DAY),
        },
      }),
    )
  }

  const employers = seedUserFixtures.filter((u) => u.email.includes('.employer+'))
  for (const employer of employers) {
    const txId = `seed-transaction-employer-credit-${employer.id}`
    transactions.push(
      prisma.transaction.upsert({
        where: { id: txId },
        update: {
          userId: employer.id,
          amount: 1000,
          type: 'admin_adjustment',
          status: 'completed',
          createdAt: new Date(Date.now() - 7 * MS_PER_DAY),
        },
        create: {
          id: txId,
          userId: employer.id,
          amount: 1000,
          type: 'admin_adjustment',
          status: 'completed',
          createdAt: new Date(Date.now() - 7 * MS_PER_DAY),
        },
      }),
    )
  }

  await Promise.all(completions)
  await Promise.all(credentials)
  await Promise.all(transactions)

  console.log(`✅ Upserted ${completions.length} completions`)
  console.log(`✅ Upserted ${credentials.length} credentials`)
  console.log(`✅ Upserted ${transactions.length} transactions`)
}

async function seedWebhookData() {
  const endpointId = 'seed-webhook-endpoint-main'
  await prisma.webhookEndpoint.upsert({
    where: { id: endpointId },
    update: {
      url: 'https://example.com/webhooks/learnault',
      secret: 'seed_webhook_secret',
      description: 'Development webhook endpoint',
      isActive: true,
      events: 'user.registered,module.completed,reward.issued',
    },
    create: {
      id: endpointId,
      url: 'https://example.com/webhooks/learnault',
      secret: 'seed_webhook_secret',
      description: 'Development webhook endpoint',
      isActive: true,
      events: 'user.registered,module.completed,reward.issued',
    },
  })
  console.log('✅ Upserted webhook endpoint')
}

async function main() {
  console.log('🌱 Starting database seed...')
  const shouldReset = process.argv.includes('--reset')
  if (shouldReset) {
    await resetAllData()
  }

  const passwordHash = await hash('seed-password-123', 10)
  await upsertUsers(passwordHash)
  await upsertModules()
  await seedLearningData()
  await seedWebhookData()

  const [userCount, moduleCount, completionCount, credentialCount, transactionCount] = await Promise.all([
    prisma.user.count(),
    prisma.module.count(),
    prisma.completion.count(),
    prisma.credential.count(),
    prisma.transaction.count(),
  ])

  console.log('🎉 Seed completed successfully')
  console.log(
    `📊 Totals => users: ${userCount}, modules: ${moduleCount}, completions: ${completionCount}, credentials: ${credentialCount}, transactions: ${transactionCount}`,
  )
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
    await pool.end()
  })
