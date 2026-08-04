import { test, expect } from '@playwright/test'
import { ADMIN_EMAIL, ADMIN_PASSWORD, loginViaUI } from './ui-helpers'

/**
 * Credential management through the real UI:
 *  - create a credential via the dialog,
 *  - the created card appears in the list,
 *  - the refresh action resolves without exposing the secret.
 */
test.describe('UI credentials', () => {
  test('unauthenticated redirect to /login', async ({ page }) => {
    await page.goto('/credentials')
    await page.waitForURL('**/login')
    await expect(page.getByRole('heading', { name: 'Welcome back' })).toBeVisible()
  })

  test('credentials list renders after login', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)
    await page.getByRole('link', { name: 'Credentials' }).click()
    await page.waitForURL('**/credentials')
    await expect(page.getByRole('heading', { name: 'Credentials' })).toBeVisible()
    await expect(page.getByRole('button', { name: 'New credential' })).toBeVisible()
  })

  test('create credential and refresh it in the UI', async ({ page }) => {
    await loginViaUI(page, ADMIN_EMAIL, ADMIN_PASSWORD)

    await page.getByRole('link', { name: 'Credentials' }).click()
    await page.waitForURL('**/credentials')

    // Open the create dialog.
    await page.getByRole('button', { name: 'New credential' }).click()
    await page.fill('#name', 'ui-github-token')
    await page.fill('#secret', 'super-secret-ui-value-123')
    await page.fill('#expiresInSeconds', '3600')
    await page.getByRole('button', { name: 'Create' }).click()

    // The card appears and never renders the plaintext secret.
    await expect(page.getByText('ui-github-token')).toBeVisible()
    await expect(page.getByText('super-secret-ui-value-123')).toHaveCount(0)

    // Refresh resolves — the credential remains visible. (Earlier API specs
    // may have left other credentials, so scope to the first refresh button.)
    await page.getByRole('button', { name: 'Refresh' }).first().click()
    await expect(page.getByText('ui-github-token')).toBeVisible()

    // Rotate also resolves.
    await page.getByRole('button', { name: 'Rotate' }).first().click()
    await expect(page.getByText('ui-github-token')).toBeVisible()
  })
})
