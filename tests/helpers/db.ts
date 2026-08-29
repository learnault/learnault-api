import { execSync } from 'child_process'
import { Pool } from 'pg'

const WORKER_SCHEMA_PREFIX = 'test_w'

export function getWorkerSchemaName(workerId?: string): string {
  const id = workerId ?? process.env.VITEST_WORKER_ID ?? '0'

  return `${WORKER_SCHEMA_PREFIX}_${id.replace(/[^0-9]/g, '')}`
}

export function buildWorkerDatabaseUrl(
  baseUrl: string,
  schemaName: string,
): string {
  const url = new URL(baseUrl)
  url.searchParams.set('schema', schemaName)

  return url.toString()
}

export async function createWorkerSchema(
  databaseUrl: string,
  schemaName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await pool.query(`CREATE SCHEMA IF NOT EXISTS "${schemaName}"`)
  } finally {
    await pool.end()
  }
}

export async function dropWorkerSchema(
  databaseUrl: string,
  schemaName: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    await pool.query(`DROP SCHEMA IF EXISTS "${schemaName}" CASCADE`)
  } finally {
    await pool.end()
  }
}

export async function dropAllWorkerSchemas(
  databaseUrl: string,
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(
      `SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE '${WORKER_SCHEMA_PREFIX}_%'`,
    )
    for (const row of result.rows) {
      await pool.query(`DROP SCHEMA IF EXISTS "${row.schema_name}" CASCADE`)
    }
  } finally {
    await pool.end()
  }
}

export async function truncateAllTables(
  databaseUrl: string,
  schema: string = 'public',
): Promise<void> {
  const pool = new Pool({ connectionString: databaseUrl })
  try {
    const result = await pool.query(
      'SELECT tablename FROM pg_tables WHERE schemaname = $1',
      [schema],
    )
    if (result.rows.length > 0) {
      const tables = result.rows
        .map((r) => `"${schema}"."${r.tablename}"`)
        .join(', ')
      await pool.query(`TRUNCATE TABLE ${tables} CASCADE`)
    }
  } finally {
    await pool.end()
  }
}

export function applyMigrations(databaseUrl: string): void {
  execSync('npx tsx node_modules/prisma/build/index.js db push --accept-data-loss', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    cwd: process.cwd(),
  })
}

export function runMigrations(databaseUrl: string): void {
  execSync('npx tsx node_modules/prisma/build/index.js migrate deploy', {
    env: { ...process.env, DATABASE_URL: databaseUrl },
    stdio: 'pipe',
    cwd: process.cwd(),
  })
}
