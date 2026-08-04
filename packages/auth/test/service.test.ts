/**
 * @cadence/auth — AuthService end-to-end tests.
 *
 * Drives the full login / refresh / logout loop against an in-memory
 * storage, asserting audit entries + token rotation.
 */
import { describe, it, expect, beforeEach } from 'vitest'
import { randomUUID } from 'node:crypto'
import { InMemoryStorageAdapter } from '@cadence/storage'
import {
  AuthService,
  createJwtSigner,
  hashPassword,
  InvalidCredentialsError,
  InvalidRefreshTokenError,
  sanitizeUser,
} from '../src/index.js'
import { ulid as makeUlid } from './ulid.js'
import type { User } from '@cadence/domain'
import { UserSchema } from '@cadence/domain'

const SECRET = 'a-very-long-test-secret-string'

async function makeActiveUser(storage: InMemoryStorageAdapter, password: string): Promise<User> {
  const hash = await hashPassword(password)
  const u = UserSchema.parse({
    id: crypto.randomUUID(),
    email: `${Math.random().toString(36).slice(2, 10)}@example.com`,
    displayName: 'Test User',
    role: 'editor',
    passwordHash: hash,
    isActive: true,
    isSuperadmin: false,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
  })
  await storage.saveUser(u)
  return u
}

describe('AuthService', () => {
  let storage: InMemoryStorageAdapter
  let svc: AuthService
  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    svc = new AuthService({ storage, jwt: createJwtSigner(SECRET) })
  })

  it('login returns user + tokens for a known credential', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const out = await svc.login({ email: u.email, password: 'hunter2', userAgent: 'jest', ip: '127.0.0.1' })
    expect(out.user.email).toBe(u.email)
    expect(out.user.id).toBe(u.id)
    expect(out.user.passwordHash).toBeUndefined() // sanitised
    expect(out.accessToken.split('.').length).toBe(3)
    expect(out.refreshToken).toContain('.')
    expect(out.expiresIn).toBe(15 * 60)
  })

  it('login rejects wrong password with InvalidCredentialsError', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    await expect(svc.login({ email: u.email, password: 'WRONG' })).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('login rejects unknown email with InvalidCredentialsError', async () => {
    await expect(svc.login({ email: 'ghost@example.com', password: 'whatever' })).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('login rejects inactive user even with right password', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    await storage.saveUser({ ...u, isActive: false })
    await expect(svc.login({ email: u.email, password: 'hunter2' })).rejects.toBeInstanceOf(InvalidCredentialsError)
  })

  it('login writes an audit entry on success', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    await svc.login({ email: u.email, password: 'hunter2', ip: '10.0.0.1' })
    const audit = await storage.listAuditLogs()
    expect(audit.length).toBe(1)
    expect(audit[0]!.action).toBe('auth.login_success')
    expect(audit[0]!.actorId).toBe(u.id)
    expect(audit[0]!.resourceKind).toBe('auth')
  })

  it('login writes an audit entry on failure', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    await svc.login({ email: u.email, password: 'WRONG' }).catch(() => undefined)
    const audit = await storage.listAuditLogs()
    expect(audit.length).toBe(1)
    expect(audit[0]!.action).toBe('auth.login_failed')
    expect(audit[0]!.actorId).toBe(u.id)
  })

  it('refresh rotates tokens (old token becomes invalid)', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const first = await svc.login({ email: u.email, password: 'hunter2' })
    const second = await svc.refresh(first.refreshToken)
    expect(second.refreshToken).not.toBe(first.refreshToken)
    expect(second.accessToken).not.toBe(first.accessToken)
    // Old token now rejected.
    await expect(svc.refresh(first.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })

  it('refresh rejects an unknown token', async () => {
    await expect(svc.refresh('not.a.real.token')).rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })

  it('refresh rejects an expired token', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const first = await svc.login({ email: u.email, password: 'hunter2' })
    // Reach into storage and force the token to be expired.
    const stored = (await storage.listUserRefreshTokens(u.id))[0]!
    // Note: revoke + recreate with a past expiry is not supported; instead
    // we mutate the row through storage and re-insert via create. For this
    // test we just verify the code path: rewrite expiresAt via a helper.
    // The adapter doesn't expose mutators, so we drop it and re-add.
    await storage.revokeRefreshToken(stored.tokenHash)
    const { generateRefreshToken, buildRefreshTokenRecord } = await import('../src/index.js')
    const t = generateRefreshToken()
    await storage.createRefreshToken(
      buildRefreshTokenRecord({
        userId: u.id,
        token: t.token,
        hash: t.hash,
        id: t.id,
        ttlMs: -1000, // already expired
      }),
    )
    await expect(svc.refresh(t.token)).rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })

  it('refresh writes an audit entry', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const first = await svc.login({ email: u.email, password: 'hunter2' })
    await svc.refresh(first.refreshToken)
    const audit = await storage.listAuditLogs()
    const refreshes = audit.filter((a) => a.action === 'auth.refresh')
    expect(refreshes.length).toBe(1)
    expect(refreshes[0]!.actorId).toBe(u.id)
  })

  it('logout revokes a single token', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const first = await svc.login({ email: u.email, password: 'hunter2' })
    await svc.logout(first.refreshToken)
    await expect(svc.refresh(first.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError)
    const audit = await storage.listAuditLogs()
    expect(audit.some((a) => a.action === 'auth.logout')).toBe(true)
  })

  it('logoutAllDevices revokes every token for a user', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const a = await svc.login({ email: u.email, password: 'hunter2' })
    const b = await svc.login({ email: u.email, password: 'hunter2' })
    const removed = await svc.logoutAllDevices(u.id)
    expect(removed).toBe(2)
    await expect(svc.refresh(a.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError)
    await expect(svc.refresh(b.refreshToken)).rejects.toBeInstanceOf(InvalidRefreshTokenError)
  })

  it('does not leak passwordHash on the returned user', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const out = await svc.login({ email: u.email, password: 'hunter2' })
    expect((out.user as unknown as { passwordHash?: string }).passwordHash).toBeUndefined()
    expect(sanitizeUser(u).passwordHash).toBeUndefined()
  })

  it('sanitizeUser keeps public fields only', () => {
    const u = UserSchema.parse({
      id: randomUUID(),
      email: 'x@example.com',
      displayName: 'X',
      role: 'admin',
      passwordHash: 'secret',
      isActive: true,
      isSuperadmin: false,
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
    })
    const pub = sanitizeUser(u)
    expect(pub).toEqual({
      id: u.id,
      email: u.email,
      displayName: u.displayName,
      role: 'admin',
      isActive: true,
      isSuperadmin: false,
      mustChangePassword: false,
    })
  })

  it('handles concurrent logins from the same user', async () => {
    const u = await makeActiveUser(storage, 'hunter2')
    const tokens = await Promise.all([
      svc.login({ email: u.email, password: 'hunter2' }),
      svc.login({ email: u.email, password: 'hunter2' }),
      svc.login({ email: u.email, password: 'hunter2' }),
    ])
    expect(new Set(tokens.map((t) => t.refreshToken)).size).toBe(3)
    const all = await storage.listUserRefreshTokens(u.id)
    expect(all.length).toBe(3)
  })
})
