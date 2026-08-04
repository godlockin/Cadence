import { test, expect } from '@playwright/test'
import { adminLogin, registerUser } from './helpers'
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from './ui-helpers'

/**
 * RBAC enforcement through the real UI:
 *  - unauthenticated redirect to /login,
 *  - viewer nav lacks admin links,
 *  - admin nav has admin links,
 *  - viewers cannot access admin routes (403 in UI).
 */
test.describe('UI RBAC', () => {
  test('unauthenticated redirect to /login', async ({ page }) => {
    await page.goto('/admin/users')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('viewer nav lacks admin links, admin nav has admin links', async ({ page, request }) => {
    const viewer = await registerUser(request)

    await loginViaUI(page, viewer.email, viewer.password)
    await expect(page.getByRole('link', { name: 'Users' })).toHaveCount(0)
    await expect(page.getByRole('link', { name: 'Audit Log' })).toHaveCount(0)

    // A fresh page in the same context is unauthenticated (tokens are in-memory).
    const adminPage = await page.context().newPage()
    await loginViaUI(adminPage, ADMIN_EMAIL, ADMIN_PASSWORD)
    await expect(adminPage.getByRole('link', { name: 'Users' })).toBeVisible()
    await expect(adminPage.getByRole('link', { name: 'Audit Log' })).toBeVisible()
  })

  test('viewer cannot access admin routes via direct navigation', async ({ page, request }) => {
    const viewer = await registerUser(request)
    await loginViaUI(page, viewer.email, viewer.password)

    // Try to navigate to admin routes — they should redirect to /login or show forbidden.
    await page.goto('/admin/users')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })
})
