import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    // Skip global setup for audit tests (no database needed)
    include: ['integrations/unit/audit.*.test.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      outputDir: 'coverage',
      include: ['src/audit/**/*.ts'],
      exclude: ['src/**/*.d.ts'],
    },
  },
})
