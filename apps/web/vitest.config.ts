import { defineConfig } from 'vitest/config'

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.test.tsx', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo'],
    /* The web app ships no tests yet; do not fail the monorepo test run. */
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      
      exclude: ['node_modules', 'dist', '.turbo', '**/*.d.ts'],
    },
  },
})
