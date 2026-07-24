import { config } from 'dotenv'

config({ path: '.env.test' })

// Ensure JWT_SECRET is set to prevent auth middleware from throwing
if (!process.env.JWT_SECRET) {
  process.env.JWT_SECRET = 'test-jwt-secret-for-integration-tests'
}

// Ensure other required env vars have defaults
if (!process.env.DATABASE_URL) {
  process.env.DATABASE_URL = 'postgresql://user:password@localhost:5432/learnault_test'
}

if (!process.env.NODE_ENV) {
  process.env.NODE_ENV = 'test'
}
