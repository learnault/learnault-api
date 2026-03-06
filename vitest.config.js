const { defineConfig } = require('vitest/config')

module.exports = defineConfig({
  test: {
    include: ['tests/**/*.test.ts', 'tests/**/*.spec.ts'],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      outputDir: 'coverage',
    },
  },
})
