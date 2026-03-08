
import 'dotenv/config'
import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { hash } from 'bcryptjs'

const pool = new Pool({ connectionString: process.env.DATABASE_URL })
const adapter = new PrismaPg(pool)
const prisma = new PrismaClient({ adapter })

async function main() {
  console.log('🌱 Starting database seed...')

  // Clear existing data
  await prisma.transaction.deleteMany()
  await prisma.credential.deleteMany()
  await prisma.completion.deleteMany()
  await prisma.webhookDelivery.deleteMany()
  await prisma.webhookEndpoint.deleteMany()
  await prisma.module.deleteMany()
  await prisma.user.deleteMany()

  // Create test users
  const user1 = await prisma.user.create({
    data: {
      email: 'alice@example.com',
      name: 'Alice Johnson',
      walletAddress: 'GBUQWP3BOUZX34ULNQG23RQ6F4BFSRJ4HBSNF63YLIXLQ5EDLF274Y6C',
      passwordHash: await hash('password123', 10),
    },
  })

  const user2 = await prisma.user.create({
    data: {
      email: 'bob@example.com',
      name: 'Bob Smith',
      walletAddress: 'GB7YLLICSMNYWJ46NWYCBTGXD54FPPWFY3YQYBFJFTQ6B2N3WHAL5V4K',
      passwordHash: await hash('password456', 10),
    },
  })

  console.log(`✅ Created ${2} users`)

  // Create modules
  const modules = await Promise.all([
    prisma.module.create({
      data: {
        title: 'Introduction to Stellar',
        description: 'Learn the basics of Stellar blockchain',
        category: 'Blockchain',
        difficulty: 'easy',
        reward: 10,
      },
    }),
    prisma.module.create({
      data: {
        title: 'Smart Contracts with Soroban',
        description: 'Build smart contracts on Stellar using Soroban',
        category: 'Blockchain',
        difficulty: 'hard',
        reward: 50,
      },
    }),
    prisma.module.create({
      data: {
        title: 'Stellar wallet integration',
        description: 'Integrate Stellar wallets into your applications',
        category: 'Integration',
        difficulty: 'medium',
        reward: 25,
      },
    }),
    prisma.module.create({
      data: {
        title: 'JavaScript fundamentals',
        description: 'Master JavaScript basics for blockchain development',
        category: 'Programming',
        difficulty: 'easy',
        reward: 15,
      },
    }),
  ])

  console.log(`✅ Created ${modules.length} modules`)

  // Create completions
  const completions = await Promise.all([
    prisma.completion.create({
      data: {
        userId: user1.id,
        moduleId: modules[0].id,
        score: 95,
      },
    }),
    prisma.completion.create({
      data: {
        userId: user1.id,
        moduleId: modules[2].id,
        score: 87,
      },
    }),
    prisma.completion.create({
      data: {
        userId: user2.id,
        moduleId: modules[0].id,
        score: 92,
      },
    }),
  ])

  console.log(`✅ Created ${completions.length} completions`)

  // Create credentials
  const credentials = await Promise.all([
    prisma.credential.create({
      data: {
        userId: user1.id,
        moduleId: modules[0].id,
        onChainId: 'cred_abc123def456',
        issuedAt: new Date(),
      },
    }),
    prisma.credential.create({
      data: {
        userId: user1.id,
        moduleId: modules[2].id,
        onChainId: 'cred_xyz789uvw012',
        issuedAt: new Date(),
      },
    }),
  ])

  console.log(`✅ Created ${credentials.length} credentials`)

  // Create transactions
  const transactions = await Promise.all([
    prisma.transaction.create({
      data: {
        userId: user1.id,
        amount: 20,
        type: 'reward',
        status: 'completed',
      },
    }),
    prisma.transaction.create({
      data: {
        userId: user2.id,
        amount: 10,
        type: 'reward',
        status: 'completed',
      },
    }),
    prisma.transaction.create({
      data: {
        userId: user1.id,
        amount: 5,
        type: 'transfer',
        status: 'pending',
      },
    }),
  ])

  console.log(`✅ Created ${transactions.length} transactions`)

  // Create webhook endpoint
  const webhook = await prisma.webhookEndpoint.create({
    data: {
      url: 'https://example.com/webhook',
      secret: 'webhook_secret_key',
      description: 'Test webhook endpoint',
      isActive: true,
      events: 'module.completed,reward.issued',
    },
  })

  console.log('✅ Created webhook endpoint')

  console.log('🎉 Database seed completed successfully!')
}

main()
  .catch((e) => {
    console.error('❌ Seed failed:', e)
    process.exit(1)
  })
  .finally(async () => {
    await prisma.$disconnect()
  })
