import { test, expect } from '@playwright/test'

test('click edit link navigates to edit page', async ({ page }) => {
  // Login
  await page.goto('/login')
  await page.fill('#email', 'admin@test.com')
  await page.fill('#password', 'test1234')
  await page.click('button[type=submit]')
  await page.waitForURL('**/dashboard', { timeout: 10000 })
  console.log('Logged in, URL:', page.url())

  // Navigate to tasks via sidebar link (SPA, no reload)
  await page.click('a[href="/tasks"]')
  await page.waitForTimeout(2000)
  console.log('After sidebar nav, URL:', page.url())

  const bodyText = await page.locator('body').textContent()
  console.log('Body snippet:', bodyText?.slice(0, 300))

  // Find edit links
  const editLinks = page.locator('a:has-text("edit")')
  const count = await editLinks.count()
  console.log(`Found ${count} edit links`)

  // Check for auth redirect
  if (page.url().includes('/login')) {
    throw new Error('Got redirected to login')
  }

  // Check if tasks loaded
  const h1 = await page.locator('h1').textContent().catch(() => null)
  console.log('H1:', h1)

  if (count === 0) {
    throw new Error(`No edit links found. URL: ${page.url()}, H1: ${h1}`)
  }

  // Get first edit link info
  const firstEdit = editLinks.first()
  const href = await firstEdit.getAttribute('href')
  const outerHTML = await firstEdit.evaluate(el => el.outerHTML)
  console.log('Edit link href:', href)
  console.log('Edit link HTML:', outerHTML)

  // Click edit link
  await firstEdit.click()
  await page.waitForTimeout(1500)

  const finalUrl = page.url()
  console.log('Final URL:', finalUrl)

  // Should navigate to edit page
  expect(finalUrl).toMatch(/\/tasks\/[^/]+\/edit/)
  await expect(page.locator('form')).toBeVisible({ timeout: 5000 })
})
