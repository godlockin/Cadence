import { defineConfig } from 'vitest/config'

export default defineConfig({
  resolve: {
    // Map `.js`/`.mjs` imports to `.ts` source under `verbatimModuleSyntax`.
    extensions: ['.mjs', '.mts', '.ts', '.tsx', '.js', '.jsx', '.json'],
  },
  test: {
    globals: true,
    environment: 'node',
    include: ['src/**/*.test.ts', 'src/**/*.spec.ts', 'tests/**/*.test.ts', 'test/**/*.test.ts'],
    exclude: ['node_modules', 'dist', '.turbo', '.wrangler'],
    passWithNoTests: true,
    coverage: {
      provider: 'v8',
    },
  },
})
