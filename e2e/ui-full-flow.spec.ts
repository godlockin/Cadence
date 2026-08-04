import { test, expect, type APIRequestContext } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI, registerViaUI } from './ui-helpers'

async function inviteAdmin(request: APIRequestContext, email: string): Promise<void> {
  const login = await request.post('/api/auth/login', {
    data: { email: ADMIN_EMAIL, password: ADMIN_PASSWORD },
  })
  expect(login.status(), 'admin login').toBe(200)
  const body = (await login.json()) as { accessToken: string }
  const res = await request.post('/api/users/invite', {
    headers: { Authorization: `Bearer ${body.accessToken}` },
    data: { email, password: 'admin-pass-1234', displayName: 'UI Admin', role: 'admin' },
  })
  expect(res.status()).toBe(201)
}

test.describe('UI full flow', () => {
  test('register via UI lands on dashboard', async ({ page }) => {
    const email = `ui-reg-${Date.now()}@cadence.dev`
    await registerViaUI(page, { email, password: 'viewer-pass-1234', displayName: 'UI Register' })
    await expect(page.getByRole('heading', { name: 'Dashboard' }).first()).toBeVisible()
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Audit Log' })).toHaveCount(0)
  })

  test('create task → trigger → view execution', async ({ page, request }) => {
    const email = `ui-admin-${Date.now()}@cadence.dev`
    await inviteAdmin(request, email)

    // Login as the invited admin.
    await loginViaUI(page, email, 'admin-pass-1234')

    // Create a task via the 5-step wizard.
    await page.getByRole('link', { name: 'Tasks' }).click()
    await page.waitForURL('**/tasks')
    await expect(page.getByRole('heading', { name: 'Tasks' }).first()).toBeVisible()
    await page.getByRole('link', { name: 'New task' }).click()
    await page.waitForURL('**/tasks/new')

    // Step 1: Select the blank template, advance to step 2.
    await expect(page.getByText('Blank task', { exact: false })).toBeVisible()
    await page.getByText('Blank task', { exact: false }).click()
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 2: Fill basic info, advance to step 3.
    await page.locator('#task-name').waitFor({ state: 'visible' })
    await page.fill('#task-name', 'E2E HTTP Task')
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 3: Accept default schedule, advance to step 4.
    await page.locator('h2', { hasText: 'Set schedule' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 4: Accept default config, advance to step 5.
    await page.locator('h2', { hasText: 'Configure execution' }).waitFor({ state: 'visible' })
    await page.getByRole('button', { name: 'Next' }).click()

    // Step 5: Create.
    await expect(page.getByRole('button', { name: /create/i })).toBeVisible()
    await page.getByRole('button', { name: /create/i }).click()

    // After create, navigate back to dashboard via SPA (in-memory auth persists), then go to executions.
    await page.getByRole('link', { name: 'Dashboard' }).click()
    await page.waitForURL('**/dashboard')
    await page.getByRole('link', { name: 'Executions' }).click()
    await page.waitForURL('**/executions')
    await page.waitForLoadState('networkidle')
    await expect(page.locator('tbody tr').first()).toBeVisible()
  })
})
