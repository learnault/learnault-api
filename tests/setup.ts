import { config } from 'dotenv'
import { validateTestDatabaseUrl } from './helpers/guard'
import {
  getWorkerSchemaName,
  createWorkerSchema,
  buildWorkerDatabaseUrl,
} from './helpers/db'

config({ path: '.env.test' })

try {
  const dbUrl = validateTestDatabaseUrl()
  const schemaName = getWorkerSchemaName()

  await createWorkerSchema(dbUrl, schemaName)
  process.env.DATABASE_URL = buildWorkerDatabaseUrl(dbUrl, schemaName)
} catch (err) {
  console.warn(
    '[setup] Database URL validation failed. ' +
      'Integration tests requiring a database will fail. ' +
      `Error: ${(err as Error).message}`,
  )
}
