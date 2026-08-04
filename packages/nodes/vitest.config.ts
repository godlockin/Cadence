import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', 'dist', '.turbo', '**/*.d.ts'],
    },
  },
})
