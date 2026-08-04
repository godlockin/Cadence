import { test, expect } from '@playwright/test'

/**
 * Chromium smoke test — verifies a real browser can reach the deployed
 * server and receives a healthy JSON payload from /health.
 */
test('browser reaches /health and renders the ok status', async ({ page }) => {
  const response = await page.goto('http://localhost:8787/health')
  expect(response?.status()).toBe(200)
  // The JSON body is rendered as text in the browser.
  await expect(page.getByText(/"status"\s*:\s*"ok"/)).toBeVisible()
})
