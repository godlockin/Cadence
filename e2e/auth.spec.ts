import { test, expect } from '@playwright/test'
import { adminLogin, registerUser, bearer, ADMIN_EMAIL } from './helpers'

test.describe('auth', () => {
  test('login as bootstrap admin returns tokens', async ({ request }) => {
    const { accessToken, refreshToken } = await adminLogin(request)
    expect(accessToken).toBeTruthy()
    expect(refreshToken).toBeTruthy()
  })

  test('login with wrong password is rejected 401', async ({ request }) => {
    const res = await request.post('/api/auth/login', {
      data: { email: ADMIN_EMAIL, password: 'wrong-password' },
    })
    expect(res.status()).toBe(401)
  })

  test('register creates a viewer account', async ({ request }) => {
    const user = await registerUser(request)
    expect(user.role).toBe('viewer')
    expect(user.tokens.accessToken).toBeTruthy()
  })

  test('GET /api/auth/me returns the authenticated user', async ({ request }) => {
    const { accessToken } = await adminLogin(request)
    const res = await request.get('/api/auth/me', { headers: bearer(accessToken) })
    expect(res.status()).toBe(200)
    const body = (await res.json()) as { email?: string }
    expect(body.email).toBe(ADMIN_EMAIL)
  })

  test('unauthenticated request to protected route is 401', async ({ request }) => {
    const res = await request.get('/api/tasks')
    expect(res.status()).toBe(401)
  })

  test('register rejects malformed email with 400', async ({ request }) => {
    const res = await request.post('/api/auth/register', {
      data: { email: 'not-an-email', password: 'test-pass-1234', displayName: 'Bad' },
    })
    expect(res.status()).toBe(400)
  })
})
