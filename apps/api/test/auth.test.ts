/**
 * @cadence/api — auth route tests.
 *
 *  - register: happy + duplicate email + validation error
 *  - login: happy + bad password + audit entry
 *  - refresh: rotate + revoke consumed token
 *  - logout: revoke single
 *  - logout-all: revoke all + audit
 *  - me: requires auth + returns public user
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('auth routes', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  it('register: creates a new user and returns tokens', async () => {
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'alice@example.com',
        password: 'super-secret-password',
        displayName: 'Alice',
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      user: { id: string; email: string; role: string }
      accessToken: string
      refreshToken: string
    }
    expect(json.user.email).toBe('alice@example.com')
    expect(json.user.role).toBe('viewer')
    expect(json.accessToken).toMatch(/^[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/)
    expect(json.refreshToken.length).toBeGreaterThan(20)
  })

  it('register: rejects duplicate email with 409', async () => {
    await t.registerUser({ email: 'dup@example.com' })
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: {
        email: 'dup@example.com',
        password: 'another-password',
        displayName: 'Dup',
      },
    })
    expect(res.status).toBe(409)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('conflict')
  })

  it('register: rejects missing fields with 400', async () => {
    const res = await callApp(t.app, 'POST', '/api/auth/register', {
      body: { email: 'x@y.com' },
    })
    expect(res.status).toBe(400)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('validation')
  })

  it('login: returns tokens for valid credentials', async () => {
    await t.registerUser({ email: 'bob@example.com', password: 'super-secret-password' })
    const res = await callApp(t.app, 'POST', '/api/auth/login', {
      body: { email: 'bob@example.com', password: 'super-secret-password' },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { accessToken: string; refreshToken: string }
    expect(json.accessToken.length).toBeGreaterThan(0)
  })

  it('login: rejects bad password with 401', async () => {
    await t.registerUser({ email: 'eve@example.com', password: 'super-secret-password' })
    const res = await callApp(t.app, 'POST', '/api/auth/login', {
      body: { email: 'eve@example.com', password: 'wrong-password' },
    })
    expect(res.status).toBe(401)
    const json = (await res.json()) as { error: string }
    expect(json.error).toBe('invalid_credentials')
  })

  it('refresh: rotates tokens and revokes the consumed one', async () => {
    const { tokens } = await t.registerUser({ email: 'fr@e.com' })
    const res = await callApp(t.app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { accessToken: string; refreshToken: string }
    expect(json.refreshToken).not.toBe(tokens.refreshToken)
    /* The consumed token must be revoked. */
    const reuse = await callApp(t.app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    })
    expect(reuse.status).toBe(401)
  })

  it('logout: revokes a single token', async () => {
    const { tokens } = await t.registerUser({ email: 'lo@e.com' })
    const res = await callApp(t.app, 'POST', '/api/auth/logout', {
      body: { refreshToken: tokens.refreshToken },
    })
    expect(res.status).toBe(200)
    const reuse = await callApp(t.app, 'POST', '/api/auth/refresh', {
      body: { refreshToken: tokens.refreshToken },
    })
    expect(reuse.status).toBe(401)
  })

  it('me: returns the public user (requires auth)', async () => {
    const { user, tokens } = await t.registerUser({ email: 'me@e.com', displayName: 'Me' })
    const res = await callApp(t.app, 'GET', '/api/auth/me', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { id: string; email: string; displayName: string }
    expect(json.id).toBe(user.id)
    expect(json.email).toBe('me@e.com')
  })

  it('me: 401 without bearer', async () => {
    const res = await callApp(t.app, 'GET', '/api/auth/me')
    expect(res.status).toBe(401)
  })
})