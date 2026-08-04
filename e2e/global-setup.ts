/**
 * PulseDeck E2E — global setup.
 *
 * Runs ONCE per test run, AFTER the webServer is up. The Node runtime
 * auto-creates a bootstrap super_admin (`admin@cadence.local`) on a
 * fresh database, so this setup just verifies that account can log in —
 * every spec relies on it as the admin identity.
 */
import { writeFileSync } from 'node:fs'
import type { FullConfig } from '@playwright/test'

export const ADMIN = {
  email: 'admin@cadence.local',
  password: 'pulsedeck',
} as const

export default async function globalSetup(_config: FullConfig): Promise<void> {
  writeFileSync('/tmp/pulsedeck-e2e-gs.txt', 'started', 'utf8')
  const baseURL = process.env['PLAYWRIGHT_BASE_URL'] ?? 'http://localhost:8787'

  const login = await fetch(`${baseURL}/api/auth/login`, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ email: ADMIN.email, password: ADMIN.password }),
  })
  if (!login.ok) {
    writeMarker(`login=${String(login.status)}`)
    throw new Error(`[e2e] bootstrap admin login failed: ${login.status}`)
  }
  const body = (await login.json()) as { user?: { isSuperadmin?: boolean } }
  if (body.user?.isSuperadmin !== true) {
    writeMarker('not-superadmin')
    throw new Error('[e2e] bootstrap admin is not superadmin')
  }
  console.info('[e2e] bootstrap admin ready')
  writeMarker('ready')
}

function writeMarker(state: string): void {
  writeFileSync('/tmp/pulsedeck-e2e-gs.txt', state, 'utf8')
}
