import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

export default async function globalSetup() {
  console.log('🚀 Setting up test database...')
  
  // Apply migrations to test database
  try {
    await execAsync('npx prisma migrate deploy')
    console.log('✅ Test database migrations applied')
  } catch (error) {
    console.error('❌ Failed to apply migrations:', error)
    throw error
  }
}
