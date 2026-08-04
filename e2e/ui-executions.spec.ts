import { test, expect } from '@playwright/test'
import { adminLogin, createTask, bearer } from './helpers'
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from './ui-helpers'

/**
 * Executions list through the real UI: seeded executions render and the
 * status filter narrows the table (Queued → rows, Failed → empty state).
 */
test.describe('UI executions', () => {
  test('unauthenticated redirect to /login', async ({ page }) => {
    await page.goto('/executions')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('executions list renders and status filter works', async ({ page, request }) => {
    const { accessToken } = await adminLogin(request)
    const task = await createTask(request, accessToken, { name: 'exec-seed-task' })
    await request.post(`/api/tasks/${task.id}/trigger`, {
      headers: bearer(accessToken),
      data: {},
    })

    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.getByRole('link', { name: 'Executions' }).click()
    await page.waitForURL('**/executions')

    // At least one execution row renders.
    await expect(page.locator('tbody tr').first()).toBeVisible()

    // Filter by Queued → rows still visible. Scope to <main> because the
    // layout header also contains a Radix Select (language switcher).
    await page.getByRole('main').getByRole('combobox').click()
    await page.getByRole('option', { name: 'Queued', exact: true }).click()
    await expect(page.locator('tbody tr').first()).toBeVisible()

    // Filter by Failed → empty state.
    await page.getByRole('main').getByRole('combobox').click()
    await page.getByRole('option', { name: 'Failed', exact: true }).click()
    await expect(page.getByText('No data')).toBeVisible()
  })

  test('click execution row navigates to detail page', async ({ page, request }) => {
    const { accessToken } = await adminLogin(request)
    const task = await createTask(request, accessToken, { name: 'exec-detail-task' })
    await request.post(`/api/tasks/${task.id}/trigger`, {
      headers: bearer(accessToken),
      data: {},
    })

    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.getByRole('link', { name: 'Executions' }).click()
    await page.waitForURL('**/executions')

    // Click the first execution row link.
    const firstLink = page.locator('tbody tr a[href^="/executions/"]').first()
    await firstLink.waitFor({ state: 'visible' })
    const href = await firstLink.getAttribute('href')
    await firstLink.click()
    await page.waitForURL(`**${href}`)
    await expect(page.getByRole('heading', { name: 'Execution detail' })).toBeVisible()
  })
})
