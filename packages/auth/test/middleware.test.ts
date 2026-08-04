/**
 * @cadence/auth — Hono middleware tests.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { Hono } from 'hono'
import { InMemoryStorageAdapter } from '@cadence/storage'
import {
  AuthError,
  BUILTIN_ROLE_PERMISSIONS,
  createJwtSigner,
  ExpiredTokenError,
  ForbiddenError,
  hashPassword,
  requireAuth,
  requirePermission,
  UnauthorizedError,
} from '../src/index.js'
import { UserSchema } from '@cadence/domain'
import { ulid as makeUlid } from './ulid.js'
import type { User } from '@cadence/domain'

const SECRET = 'middleware-test-secret-very-long'

async function makeUser(storage: InMemoryStorageAdapter): Promise<User> {
  const u = UserSchema.parse({
    id: crypto.randomUUID(),
    email: `mw-${Math.random().toString(36).slice(2, 8)}@example.com`,
    displayName: 'MW User',
    role: 'editor',
    passwordHash: await hashPassword('hunter2'),
    isActive: true,
    isSuperadmin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await storage.saveUser(u)
  return u
}

describe('Hono middleware', () => {
  let storage: InMemoryStorageAdapter
  let app: Hono
  let user: User

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
    user = await makeUser(storage)
    storage.setUserRole(user.id, BUILTIN_ROLE_PERMISSIONS.viewer)
    const jwt = createJwtSigner(SECRET)
    app = new Hono()
    app.onError((err, c) => {
      if (err instanceof AuthError) {
        const status: 401 | 403 = err instanceof ForbiddenError ? 403 : 401
        return c.json({ code: err.code, message: err.message }, status)
      }
      throw err
    })
    app.use('/protected', requireAuth(jwt, storage))
    app.get('/protected', (c) => c.json({ ok: true, userId: c.get('userId') }))
    app.use(
      '/read',
      requireAuth(jwt, storage),
      requirePermission('pipeline:read'),
    )
    app.get('/read', (c) => c.json({ ok: true }))
    app.use(
      '/admin-only',
      requireAuth(jwt, storage),
      requirePermission('pipeline:delete'),
    )
    app.get('/admin-only', (c) => c.json({ ok: true }))
  })

  it('rejects requests with no Authorization header', async () => {
    const res = await app.request('/protected')
    expect(res.status).toBe(401)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('unauthorized')
  })

  it('rejects requests with a non-bearer scheme', async () => {
    const res = await app.request('/protected', { headers: { authorization: 'Basic abc' } })
    expect(res.status).toBe(401)
  })

  it('rejects an empty bearer token', async () => {
    const res = await app.request('/protected', { headers: { authorization: 'Bearer ' } })
    expect(res.status).toBe(401)
  })

  it('rejects a token signed with the wrong secret', async () => {
    const other = createJwtSigner('a-different-very-long-secret')
    const { token } = await other.signAccessToken(makeUlid() as unknown as User['id'])
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  it('accepts a valid bearer token and populates context', async () => {
    const jwt = createJwtSigner(SECRET)
    const { token } = await jwt.signAccessToken(user.id)
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; userId: string }
    expect(body.userId).toBe(user.id)
  })

  it('rejects a token for a deleted user', async () => {
    const jwt = createJwtSigner(SECRET)
    const ghostId = crypto.randomUUID() as unknown as User['id']
    const { token } = await jwt.signAccessToken(ghostId)
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  it('rejects an inactive user even with a valid token', async () => {
    const jwt = createJwtSigner(SECRET)
    await storage.saveUser({ ...user, isActive: false })
    const { token } = await jwt.signAccessToken(user.id)
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })

  it('requirePermission grants a viewer read access', async () => {
    const jwt = createJwtSigner(SECRET)
    const { token } = await jwt.signAccessToken(user.id)
    const res = await app.request('/read', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })

  it('requirePermission forbids a viewer from delete', async () => {
    const jwt = createJwtSigner(SECRET)
    const { token } = await jwt.signAccessToken(user.id)
    const res = await app.request('/admin-only', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(403)
    const body = (await res.json()) as { code: string }
    expect(body.code).toBe('forbidden')
  })

  it('superadmin passes requirePermission without role wiring', async () => {
    const godUser = UserSchema.parse({
      id: crypto.randomUUID(),
      email: `god-${Math.random().toString(36).slice(2, 8)}@example.com`,
      displayName: 'God',
      role: 'owner',
      passwordHash: 'x',
      isActive: true,
      isSuperadmin: true,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    await storage.saveUser(godUser)
    const jwt = createJwtSigner(SECRET)
    const { token } = await jwt.signAccessToken(godUser.id)
    const res = await app.request('/admin-only', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(200)
  })

  it('rejects an expired token via requireAuth', async () => {
    const jwt = createJwtSigner(SECRET)
    const { token } = await jwt.signAccessToken(user.id, { ttlSeconds: -1 })
    const res = await app.request('/protected', { headers: { authorization: `Bearer ${token}` } })
    expect(res.status).toBe(401)
  })
})

// silence "unused" warnings for re-imported helpers
void UnauthorizedError
void ForbiddenError
void ExpiredTokenError
