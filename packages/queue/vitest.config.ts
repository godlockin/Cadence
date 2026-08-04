import { defineConfig } from 'vitest/config'
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    include: ['src/**/*.test.ts'],
    environment: 'node',
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', 'dist', '.turbo', '**/*.d.ts'],
    },
  },
})
