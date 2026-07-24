import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    setupFiles: ['./tests/setup.ts'],
    globalSetup: ['./tests/globalSetup.ts'],
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts', 'integrations/**/*.test.ts'],
    // Exclude integration tests that require database if DATABASE_URL is not set or is SQLite
    exclude: process.env.DATABASE_URL?.includes('postgresql') 
      ? ['**/node_modules/**', '**/dist/**']
      : ['**/node_modules/**', '**/dist/**', '**/tests/integration/phase-1/**'],
    testTimeout: 30000,
    hookTimeout: 30000,
    teardownTimeout: 10000,
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html', 'json'],
      outputDir: 'coverage',
      include: ['src/**/*.ts'],
      exclude: ['src/**/*.d.ts', 'src/types/**/*.ts'],
    },
  },
})
