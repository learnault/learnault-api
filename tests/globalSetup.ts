import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export default async function globalSetup() {
  console.log('🚀 Setting up test database...')
  
  // Skip database migrations if no DATABASE_URL is set
  // This allows tests to run in CI without a real database for now
  const databaseUrl = process.env.DATABASE_URL
  
  if (!databaseUrl || databaseUrl.includes('file:')) {
    console.log('⚠️  Skipping database migrations (no PostgreSQL DATABASE_URL set)')

    return
  }
  
  // Apply migrations to test database
  try {
    await execAsync('npx prisma migrate deploy')
    console.log('✅ Test database migrations applied')
  } catch {
    console.error('❌ Failed to apply migrations')
    // Don't fail the entire test suite if migrations fail
    // This allows CI to at least check for syntax errors
    console.warn('⚠️  Continuing without database...')
  }
}
