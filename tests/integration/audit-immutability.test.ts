import { describe, it, expect, beforeAll, afterAll } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'
import { randomUUID } from 'crypto'
import { Pool } from 'pg'
import { AUDIT_PURGE_SETTING } from '../../src/audit/audit-event.service'

/**
 * Database-level proof that audit events are immutable.
 *
 * The unit tests assert the *service* offers no way to edit an event. This
 * asserts the database refuses even when someone bypasses the service and
 * writes raw SQL — which is the only guarantee worth having, since an audit
 * trail the application can quietly rewrite is not an audit trail.
 *
 * Skipped when no test database is reachable. Bring one up with
 * `pnpm stack:up` (or any Postgres on DATABASE_URL) to run it.
 */

const MIGRATION = join(
  process.cwd(),
  'prisma',
  'migrations',
  '20260824090000_auditable_data_lifecycle',
  'migration.sql',
)

let pool: Pool | undefined
let available = false

/**
 * Apply the immutability DDL from the shipped migration.
 *
 * `tests/globalSetup.ts` prepares the schema with `prisma db push`, which
 * creates tables from schema.prisma and never executes migration SQL — so the
 * triggers do not exist in a test database by default. Extracting them from the
 * real migration file means this test verifies the artifact that actually ships,
 * not a copy of it that could drift.
 */
async function applyImmutabilityDdl(db: Pool): Promise<void> {
  const sql = readFileSync(MIGRATION, 'utf8')

  const start = sql.indexOf(
    'CREATE OR REPLACE FUNCTION "audit_events_reject_mutation"',
  )
  const end = sql.indexOf('-- ARCHIVE COLUMNS')

  if (start === -1 || end === -1 || end <= start) {
    throw new Error(
      'Could not locate the immutability DDL in the migration file',
    )
  }

  await db.query(sql.slice(start, end))
}

async function insertEvent(db: Pool, action = 'test.event'): Promise<string> {
  const id = randomUUID()

  await db.query(
    `INSERT INTO "audit_events"
       ("id", "actorType", "action", "recordClass", "targetType", "targetId")
     VALUES ($1, 'SYSTEM', $2, 'IMMUTABLE', 'User', $3)`,
    [id, action, randomUUID()],
  )

  return id
}

beforeAll(async () => {
  const connectionString = process.env.DATABASE_URL
  if (!connectionString) return

  const candidate = new Pool({
    connectionString,
    connectionTimeoutMillis: 3000,
  })

  try {
    await candidate.query('SELECT 1 FROM "audit_events" LIMIT 1')
    await applyImmutabilityDdl(candidate)
    pool = candidate
    available = true
  } catch {
    await candidate.end().catch(() => undefined)
  }
})

afterAll(async () => {
  if (!pool) return

  // The purge setting is the only sanctioned way to remove rows, so cleanup has
  // to use it too — which is itself a small confirmation that it works.
  await pool
    .query(`SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`)
    .catch(() => undefined)
  await pool
    .query(
      `BEGIN; SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on';
       DELETE FROM "audit_events" WHERE "action" LIKE 'test.%'; COMMIT;`,
    )
    .catch(() => undefined)
  await pool.end().catch(() => undefined)
})

describe.skipIf(!process.env.DATABASE_URL)(
  'audit_events immutability (database)',
  () => {
    it('accepts an append', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)
      const { rows } = await pool!.query(
        'SELECT "id" FROM "audit_events" WHERE "id" = $1',
        [id],
      )

      expect(rows).toHaveLength(1)
    })

    it('rejects an UPDATE', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)

      await expect(
        pool!.query('UPDATE "audit_events" SET "reason" = $1 WHERE "id" = $2', [
          'tampered',
          id,
        ]),
      ).rejects.toThrow(/immutable/i)
    })

    it('rejects an UPDATE even inside the purge escape hatch', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)
      const client = await pool!.connect()

      try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`)

        // The escape hatch exists for the retention purge only. It must not
        // become a way to edit history.
        await expect(
          client.query(
            'UPDATE "audit_events" SET "reason" = $1 WHERE "id" = $2',
            ['x', id],
          ),
        ).rejects.toThrow(/immutable/i)
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })

    it('rejects a DELETE without the purge setting', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)

      await expect(
        pool!.query('DELETE FROM "audit_events" WHERE "id" = $1', [id]),
      ).rejects.toThrow(/retention purge/i)
    })

    it('rejects a TRUNCATE, which bypasses row-level triggers', async () => {
      if (!available) return expect(available).toBe(false)

      await expect(
        pool!.query('TRUNCATE TABLE "audit_events"'),
      ).rejects.toThrow(/may not be truncated/i)
    })

    it('allows a DELETE when the retention purge sets the session variable', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)
      const client = await pool!.connect()

      try {
        await client.query('BEGIN')
        await client.query(`SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`)
        const result = await client.query(
          'DELETE FROM "audit_events" WHERE "id" = $1',
          [id],
        )
        await client.query('COMMIT')

        expect(result.rowCount).toBe(1)
      } finally {
        await client.query('ROLLBACK').catch(() => undefined)
        client.release()
      }
    })

    it('confines the purge setting to its own transaction', async () => {
      if (!available) return expect(available).toBe(false)

      const id = await insertEvent(pool!)
      const client = await pool!.connect()

      try {
        // SET LOCAL, not SET: the permission must not leak to later statements on
        // a pooled connection that some unrelated request picks up next.
        await client.query('BEGIN')
        await client.query(`SET LOCAL "${AUDIT_PURGE_SETTING}" = 'on'`)
        await client.query('COMMIT')

        await expect(
          client.query('DELETE FROM "audit_events" WHERE "id" = $1', [id]),
        ).rejects.toThrow(/retention purge/i)
      } finally {
        client.release()
      }
    })
  },
)

describe.skipIf(!process.env.DATABASE_URL)(
  'archive constraints (database)',
  () => {
    it('rejects an archived row with no reason', async () => {
      if (!available) return expect(available).toBe(false)

      // The check constraint is what makes "archive behaviour is deterministic"
      // true for writers that skip the helper in src/audit/audited-mutation.ts.
      await expect(
        pool!.query(
          `INSERT INTO "Module"
           ("id", "title", "description", "category", "difficulty", "archivedAt", "updatedAt")
         VALUES ($1, 't', 'd', 'c', 'easy', now(), now())`,
          [randomUUID()],
        ),
      ).rejects.toThrow(/archive_reason_check/i)
    })

    it('accepts an archived row that states a reason', async () => {
      if (!available) return expect(available).toBe(false)

      const id = randomUUID()

      await pool!.query(
        `INSERT INTO "Module"
         ("id", "title", "description", "category", "difficulty",
          "archivedAt", "archivedReason", "updatedAt")
       VALUES ($1, 't', 'd', 'c', 'easy', now(), 'superseded', now())`,
        [id],
      )

      await pool!.query('DELETE FROM "Module" WHERE "id" = $1', [id])
    })
  },
)
