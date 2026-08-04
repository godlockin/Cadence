import { test, expect } from '@playwright/test'
import { spawn, type ChildProcess } from 'node:child_process'
import { rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
/**
 * Graceful shutdown + health.
 *
 * Spawns an independent Node instance (own port + own SQLite file) so the
 * shared E2E webServer is untouched, then verifies:
 *  1. `/health` reports ok + db up while running,
 *  2. SIGTERM triggers a clean exit code 0 (server closed, db closed).
 */
const PORT = 8791

async function waitForHealth(baseURL: string, timeoutMs = 30_000): Promise<void> {
  const deadline = Date.now() + timeoutMs
  let lastError: string | null = null
  while (Date.now() < deadline) {
    try {
      const res = await fetch(`${baseURL}/health`)
      if (res.ok) {
        const body = (await res.json()) as { db?: boolean }
        if (body.db === true) return
        lastError = `db=${String(body.db)}`
      } else {
        lastError = `status=${String(res.status)}`
      }
    } catch (err: unknown) {
      lastError = err instanceof Error ? err.message : String(err)
    }
    await new Promise((resolve) => setTimeout(resolve, 300))
  }
  throw new Error(`server did not become healthy: ${lastError ?? 'timeout'}`)
}

// Fallback dev-only secrets — NEVER commit these to git.
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

test.describe('graceful shutdown', () => {
  test('SIGTERM exits cleanly with code 0', async () => {
    const dbPath = join(tmpdir(), `pulsedeck-shutdown-${Date.now()}.db`)
    const baseURL = `http://localhost:${String(PORT)}`

    // Spawn tsx directly (not via `pnpm exec`) so SIGTERM reaches the Node
    // process that owns the shutdown handler.
    const rootDir = process.cwd()
    const tsxBin = join(rootDir, 'apps', 'api', 'node_modules', '.bin', 'tsx')
    const apiDir = join(rootDir, 'apps', 'api')

    const child: ChildProcess = spawn(tsxBin, ['src/node.ts'], {
      cwd: apiDir,
      env: {
        ...process.env,
        PORT: String(PORT),
        PULSEDECK_DB_PATH: dbPath,
        JWT_SECRET: e2eJwtSecret(),
        ENCRYPTION_KEY: e2eEncryptionKey(),
        PULSEDECK_SCHEDULER_ENABLED: '0',
        NODE_ENV: 'test',
      },
      stdio: ['ignore', 'ignore', 'ignore'],
    })

    const exited = new Promise<number | null>((resolve) => {
      child.once('exit', (code) => resolve(code))
    })
    const failed = new Promise<never>((_, reject) => {
      child.once('error', (err) => reject(err))
    })

    try {
      await Promise.race([waitForHealth(baseURL), failed])

      const health = await fetch(`${baseURL}/health`)
      expect(health.status).toBe(200)
      const body = (await health.json()) as { status?: string; db?: boolean }
      expect(body.db).toBe(true)

      child.kill('SIGTERM')
      const code = await Promise.race([exited, failed])
      expect(code).toBe(0)
    } finally {
      if (child.exitCode === null) child.kill('SIGKILL')
      rmSync(dbPath, { force: true })
      rmSync(`${dbPath}-wal`, { force: true })
      rmSync(`${dbPath}-shm`, { force: true })
    }
  })
})
