import { defineConfig, devices } from '@playwright/test'

const API_PORT = 8787
const WEB_PORT = 5173
const API_URL = `http://localhost:${String(API_PORT)}`
const WEB_URL = `http://localhost:${String(WEB_PORT)}`
const DB_PATH = '/tmp/Cadence-e2e.db'

/**
 * Cadence Playwright E2E.
 *
 * Two servers run in parallel:
 *  - Node.js runtime (`apps/api/src/node.ts`): real HTTP API + better-sqlite3.
 *  - Vite dev server (`apps/web`): React SPA that proxies /api/* to the API.
 *
 * The browser always hits the web server (port 5173). The API server exists
 * so the web app's Vite proxy can forward /api/* calls through it.
 */
// Fallback dev-only secrets — NEVER commit these to git.
// In CI or production these must be provided via env vars or the app fails fast.
const E2E_JWT_SECRET_FALLBACK = 'dev-only-DO-NOT-USE-IN-PROD-fallback-jwt-secret-32bytes!!'
const E2E_ENCRYPTION_KEY_FALLBACK = 'dev-only-DO-NOT-USE-IN-PROD-ZXhhbXBsZVVzZXJJZGVudGl0eQ=='

const isProdLike = process.env.NODE_ENV === 'production' || process.env.CI === 'true'

function e2eJwtSecret(): string {
  const val = process.env.PULSEDECK_E2E_JWT_SECRET
  if (!val) {
    if (isProdLike) throw new Error('PULSEDECK_E2E_JWT_SECRET env var required in CI/production')
    return E2E_JWT_SECRET_FALLBACK
  }
  return val
}

function e2eEncryptionKey(): string {
  const val = process.env.PULSEDECK_E2E_ENCRYPTION_KEY
  if (!val) {
    if (isProdLike) throw new Error('PULSEDECK_E2E_ENCRYPTION_KEY env var required in CI/production')
    return E2E_ENCRYPTION_KEY_FALLBACK
  }
  return val
}

export default defineConfig({
  testDir: './e2e',
  globalSetup: './e2e/global-setup.ts',
  fullyParallel: false,
  workers: 1,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  timeout: 90_000,
  reporter: process.env.CI ? 'github' : [['list']],
  use: {
    baseURL: WEB_URL,
    trace: 'on-first-retry',
    /* Deterministic UI: the client i18n defaults to English for en-US, and
     * the timezone is fixed so date-dependent assertions are stable. */
    locale: 'en-US',
    timezoneId: 'UTC',
    /* apiRequestContext defaults (helpful for the browser smoke test). */
    extraHTTPHeaders: {},
  },
  projects: [
    {
      name: 'chromium',
      use: { ...devices['Desktop Chrome'] },
    },
  ],
  webServer: [
    {
      command: `rm -f ${DB_PATH}* && pnpm --filter @Cadence/api exec tsx src/node.ts`,
      url: `${API_URL}/health`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
      env: {
        PORT: String(API_PORT),
        PULSEDECK_DB_PATH: DB_PATH,
        JWT_SECRET: e2eJwtSecret(),
        ENCRYPTION_KEY: e2eEncryptionKey(),
        PULSEDECK_SCHEDULER_ENABLED: '1',
        NODE_ENV: 'test',
      },
    },
    {
      command: 'pnpm --filter @Cadence/web dev',
      url: `${WEB_URL}`,
      reuseExistingServer: !process.env.CI,
      timeout: 60_000,
    },
  ],
})
