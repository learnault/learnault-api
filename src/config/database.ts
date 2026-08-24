import { PrismaClient } from '@prisma/client'
import { PrismaPg } from '@prisma/adapter-pg'
import { Pool } from 'pg'
import { archiveExclusionExtension } from '../audit/archive.js'

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

  // Archived (soft-deleted) rows are excluded from list and aggregate reads
  // here, at the client, rather than at each call site — one forgotten filter
  // would otherwise leak withdrawn content. See src/audit/archive.ts for the
  // operations covered and how to opt out.
  //
  // The cast keeps the exported type as PrismaClient. $extends() narrows the
  // nominal type (it drops $on and $use), but this extension only rewrites the
  // `where` of a read: it adds no methods, removes none, and changes no result
  // shape. Widening every injection site to a union of both client types is a
  // worse trade — a union of overloaded $transaction signatures stops resolving.
  return new PrismaClient({ adapter }).$extends(
    archiveExclusionExtension
  ) as unknown as PrismaClient
}

const prisma = globalForPrisma.prisma ?? createPrismaClient()

if (process.env.NODE_ENV !== 'production') {
  globalForPrisma.prisma = prisma
}

export default prisma
export { prisma }
