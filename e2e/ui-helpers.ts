/**
 * PulseDeck E2E — browser UI helpers.
 *
 * The web client keeps JWT tokens **in memory only** (see `lib/store.ts`),
 * so every full page reload wipes auth. Tests must therefore:
 *  1. log in through the login form (never seed a token), and
 *  2. navigate between routes with client-side links — not `page.goto`.
 *
 * Language: all UI tests force English so assertions match translation keys.
 */
import { expect, type Page } from '@playwright/test'

export const ADMIN_EMAIL = 'admin@cadence.local'
export const ADMIN_PASSWORD = 'pulsedeck'

/** Register a brand-new account through the UI. */
export async function registerViaUI(
  page: Page,
  opts: { email: string; password: string; displayName: string },
): Promise<void> {
  const { email, password, displayName } = opts
  // Force English so all assertions use English text.
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('pulsedeck.lang', 'en'))
  await page.goto('/register')
  await page.waitForLoadState('networkidle')
  await page.fill('#email', email)
  await page.fill('#displayName', displayName)
  await page.fill('#password', password)
  await page.fill('#confirm', password)
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard')
  await page.waitForLoadState('networkidle')
}

/** Log in through the UI and wait for the dashboard. */
export async function loginViaUI(
  page: Page,
  email: string,
  password: string,
): Promise<void> {
  // Force English so all assertions use English text.
  await page.goto('/')
  await page.evaluate(() => localStorage.setItem('pulsedeck.lang', 'en'))
  await page.goto('/login')
  await page.waitForLoadState('networkidle')
  await page.fill('#email', email)
  await page.fill('#password', password)
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard')
  await page.waitForLoadState('networkidle')
  // Dashboard data fetches settle before the caller proceeds.
  // Use .first() because the dashboard renders both an h1 "Dashboard" (title) and
  // an h3 "Dashboard" (system-status subtitle), which would be a strict-mode violation.
  await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
}

/** Open a Radix `Select` (role=combobox) and choose an option by label. */
export async function selectRadixOption(
  page: Page,
  comboboxIndex: number,
  label: string,
): Promise<void> {
  await page.getByRole('combobox').nth(comboboxIndex).click()
  await page.getByRole('option', { name: label, exact: true }).click()
}
