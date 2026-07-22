import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { createDataLifecycleExtension } from '../audit/middleware.js'

const connectionString =
  process.env.DATABASE_URL ??
  'postgresql://user:password@localhost:5432/learnault'

const globalForPrisma = globalThis as unknown as {
  prisma: PrismaClient | undefined
  pool: Pool | undefined
}

function createPrismaClient(): PrismaClient {
  const pool =
    globalForPrisma.pool ??
    new Pool({
      connectionString,
      max: 10,
    })

  if (process.env.NODE_ENV !== 'production') {
    globalForPrisma.pool = pool
  }

  const adapter = new PrismaPg(pool)

  const baseClient = new PrismaClient({ adapter })
  
  // Apply data lifecycle extension for audit trail and soft-delete
  const extendedClient = baseClient.$extends(createDataLifecycleExtension())
  
  return extendedClient as any
}

const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
export { prisma }
