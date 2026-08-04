import { defineConfig } from 'vitest/config'
import { fileURLToPath } from 'node:url'
import { dirname, resolve } from 'node:path'
const __dirname = dirname(fileURLToPath(import.meta.url))
const root = resolve(__dirname, '..', '..')
/**
 * API vitest config.
 *
 * Aliases @cadence/* to TS source so tests don't depend on built dist.
 */
export default defineConfig({
  resolve: {
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
    alias: {
      '@cadence/auth': resolve(root, 'packages/auth/src/index.ts'),
      '@cadence/storage': resolve(root, 'packages/storage/src/index.ts'),
      '@cadence/domain': resolve(root, 'packages/domain/src/index.ts'),
      '@cadence/db': resolve(root, 'packages/db/src/index.ts'),
      '@cadence/sinker': resolve(root, 'packages/sinker/src/index.ts'),
      '@cadence/queue': resolve(root, 'packages/queue/src/index.ts'),
      '@cadence/scheduler': resolve(root, 'packages/scheduler/src/index.ts'),
      '@cadence/executor-pipeline': resolve(root, 'packages/executor-pipeline/src/index.ts'),
    },
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
      exclude: ['node_modules', 'dist', '.turbo', '**/*.d.ts', 'src/node.ts'],
    },
  },
})