import 'dotenv/config'
import { defineConfig } from 'prisma/config'

// `prisma generate` (and the Docker build) must succeed even when no database
// is reachable, so fall back to a local default when DATABASE_URL is unset.
// `prisma migrate`/`db push` still require a real DATABASE_URL.
const DATABASE_URL =
  process.env.DATABASE_URL ??
  'postgresql://postgres:postgres@localhost:5432/learnault_dev?schema=public'

export default defineConfig({
  schema: 'prisma/schema.prisma',
  migrations: {
    path: 'prisma/migrations',
    seed: 'tsx prisma/seed.ts',
  },
  datasource: {
    url: DATABASE_URL,
  },
})
