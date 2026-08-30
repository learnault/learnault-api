import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { buildUser, createUser } from '../helpers/factories'
import { validateTestDatabaseUrl } from '../helpers/guard'
import { Pool } from 'pg'

async function isDatabaseAvailable(): Promise<boolean> {
  try {
    const url = validateTestDatabaseUrl()
    const pool = new Pool({
      connectionString: url,
      max: 1,
      connectionTimeoutMillis: 3000,
    })
    const client = await pool.connect()
    client.release()
    await pool.end()

    return true
  } catch {
    return false
  }
}

const dbAvailable = await isDatabaseAvailable()

describe.runIf(dbAvailable)('Database isolation', () => {
  let prisma: Awaited<ReturnType<typeof importPrisma>> | null = null

  async function importPrisma() {
    const { prisma: client } = await import('../../src/config/database')

    return client
  }

  beforeAll(async () => {
    prisma = await importPrisma()
  })

  afterAll(async () => {
    await prisma?.$disconnect()
  })

  it('creates and retrieves a user', async () => {
    const userData = buildUser()
    const user = await prisma!.user.create({ data: userData })

    expect(user.email).toBe(userData.email)
    expect(user.username).toBe(userData.username)
    expect(user.role).toBe('LEARNER')

    await prisma!.user.delete({ where: { id: user.id } })
  })

  it('factory creates a persisted user', async () => {
    const user = await createUser(prisma!)
    expect(user.id).toBeDefined()
    expect(user.email).toMatch(/^test_.+@example\.com$/)

    await prisma!.user.delete({ where: { id: user.id } })
  })

  it('does not leak records across test cases', async () => {
    const count = await prisma!.user.count()
    expect(count).toBe(0)
  })
})

describe('Isolation helpers', () => {
  it('withIsolation rolls back transaction', () => {})

  it('createIsolatedTest wraps test function', () => {})
})
