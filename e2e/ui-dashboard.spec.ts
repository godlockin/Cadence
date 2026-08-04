import { test, expect } from '@playwright/test'
import { adminLogin, createTask, bearer } from './helpers'
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from './ui-helpers'

/**
 * Dashboard through the real UI: seeded task + execution surface as
 * stat cards and in the recent-executions list.
 */
test.describe('UI dashboard', () => {
  test('unauthenticated redirect to /login', async ({ page }) => {
    await page.goto('/dashboard')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('dashboard shows stats and recent executions', async ({ page, request }) => {
    const { accessToken } = await adminLogin(request)
    const task = await createTask(request, accessToken, { name: 'dashboard-seed-task' })
    const trig = await request.post(`/api/tasks/${task.id}/trigger`, {
      headers: bearer(accessToken),
      data: {},
    })
    expect(trig.status()).toBe(202)

    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    // Stat card titles are rendered.
    await expect(page.getByText('Dashboard').first()).toBeVisible()
    await expect(page.getByText('Active Tasks')).toBeVisible()
    await expect(page.getByText('Executions Today')).toBeVisible()
    await expect(page.getByText('Recent Executions')).toBeVisible()

    // The seeded execution appears in the recent list.
    await expect(page.locator('a[href^="/executions/"]').first()).toBeVisible()
  })

  test('stat cards are visible after login', async ({ page, request }) => {
    await adminLogin(request)
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await expect(page.getByText('Active Tasks')).toBeVisible()
    await expect(page.getByText('Executions Today')).toBeVisible()
    await expect(page.getByText('Recent Executions')).toBeVisible()
  })
})
