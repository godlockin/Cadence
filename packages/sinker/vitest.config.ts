import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
/**
 * Sinker vitest config.
 *
 * Aliases @cadence/storage and @cadence/queue to their TS source so we
 * don't depend on a built dist. The root config (../../vitest.config.ts)
 * already enables `.ts` extension resolution for relative imports; this
 * config adds the package-name aliases that the integration tests need.
 */
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: {
      '@cadence/storage': resolve(root, 'packages/storage/src/index.ts'),
      '@cadence/queue': resolve(root, 'packages/queue/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo'],
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', 'dist', '.turbo', '**/*.d.ts'],
    },
  },
})
