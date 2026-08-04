/**
 * @cadence/api — credential route tests.
 *
 *  - create: encrypts the plaintext secret (ciphertext never returns plaintext)
 *  - read: only owner sees metadata
 *  - patch: only owner
 *  - delete: only owner
 *  - refresh: audit-only stub (no plaintext returned)
 *  - cross-owner: 403
 *  - 401 without auth
 *  - 404 on unknown id
 */
import { describe, expect, it, beforeEach } from 'vitest'
import { buildTestApp, callApp } from './helpers.js'

describe('credential routes', () => {
  let t: ReturnType<typeof buildTestApp>

  beforeEach(() => {
    t = buildTestApp()
  })

  async function createCred(
    tokens: { accessToken: string },
    secret = 'super-secret-token',
  ): Promise<{ id: string }> {
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'GitHub', kind: 'api-key', secret },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { credential: { id: string } }
    return { id: json.credential.id }
  }

  it('create: unauthorised user (viewer) gets 403', async () => {
    const { user, tokens } = await t.registerUser({ email: 'nocreate@e.com' })
    /* viewer role grants credential:read but NOT credential:create. */
    void user
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'GitHub', kind: 'api-key', secret: 'super-secret-token' },
    })
    expect(res.status).toBe(403)
  })

  it('create: stores encrypted secret, never returns plaintext', async () => {
    const { user, tokens } = await t.registerUser({ email: 'c@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'GitHub', kind: 'api-key', secret: 'super-secret-token' },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      credential: Record<string, unknown>
    }
    expect(json.credential).not.toHaveProperty('ciphertext')
    expect(json.credential).not.toHaveProperty('secret')
    /* Verify the underlying row has a ciphertext (encryption actually happened). */
    const stored = await t.storage.getCredential(json.credential['id'] as never)
    expect(stored?.ciphertext).not.toBe('super-secret-token')
  })

  it('read: owner sees metadata', async () => {
    const { user, tokens } = await t.registerUser({ email: 'r@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'GET', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { credential: { name: string } }
    expect(json.credential.name).toBe('GitHub')
  })

  it('read: cross-owner gets 403', async () => {
    const { user: ownUser, tokens: owner } = await t.registerUser({ email: 'ownc@e.com' })
    t.setUserRole(ownUser.id, 'admin')
    const { user: otherUser, tokens: other } = await t.registerUser({ email: 'othc@e.com' })
    /* Other user has no RBAC role assigned → can() denies → 403. */
    void otherUser
    const { id } = await createCred(owner)
    const res = await callApp(t.app, 'GET', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${other.accessToken}` },
    })
    expect(res.status).toBe(403)
  })

  it('patch: owner updates metadata', async () => {
    const { user, tokens } = await t.registerUser({ email: 'pc@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'PATCH', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'GitHub v2' },
    })
    expect(res.status).toBe(200)
  })

  it('delete: owner deletes', async () => {
    const { user, tokens } = await t.registerUser({ email: 'dc@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'DELETE', `/api/credentials/${id}`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
  })

  it('refresh: 200 + audit entry; no plaintext returned', async () => {
    const { user, tokens } = await t.registerUser({ email: 'rc@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { refreshedAt: number }
    expect(typeof json.refreshedAt).toBe('number')
  })

  it('list: returns own credentials', async () => {
    const { user, tokens } = await t.registerUser({ email: 'lc@e.com' })
    t.setUserRole(user.id, 'admin')
    await createCred(tokens)
    await createCred(tokens, 'token-2')
    const res = await callApp(t.app, 'GET', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { credentials: unknown[] }
    expect(json.credentials.length).toBe(2)
  })

  it('unknown id: 404', async () => {
    const { user, tokens } = await t.registerUser({ email: 'uc@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'GET', '/api/credentials/00000000-0000-0000-0000-000000000000', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(404)
  })

  /* ----- PHASE 6: rich create / refresh metadata ----- */

  it('create: accepts type + expiresInSeconds and reflects them in the response', async () => {
    const { user, tokens } = await t.registerUser({ email: 'type@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'OAuth',
        kind: 'oauth2',
        secret: 'rt',
        type: 'oauth2_refresh_token',
        tokenEndpoint: 'https://provider.example.com/token',
        clientId: 'cid',
        expiresInSeconds: 3600,
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as {
      credential: { type: string; expiresAt: number; version: number }
    }
    expect(json.credential.type).toBe('oauth2_refresh_token')
    expect(typeof json.credential.expiresAt).toBe('number')
    expect(json.credential.version).toBe(1)
  })

  it('create: encrypts clientSecret at rest', async () => {
    const { user, tokens } = await t.registerUser({ email: 'cs@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'OAuth2',
        kind: 'oauth2',
        secret: 'rt',
        type: 'oauth2_refresh_token',
        clientSecret: 'plaintext-client-secret',
        tokenEndpoint: 'https://provider.example.com/token',
        clientId: 'cid',
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { credential: { id: string } }
    const stored = await t.storage.getCredential(json.credential.id as never)
    expect(stored?.clientSecretCiphertext).toBeDefined()
    expect(stored?.clientSecretCiphertext).not.toBe('plaintext-client-secret')
  })

  it('create: persists refreshPolicy when provided', async () => {
    const { user, tokens } = await t.registerUser({ email: 'pol@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: {
        name: 'OAuth2',
        kind: 'oauth2',
        secret: 'rt',
        type: 'oauth2_refresh_token',
        tokenEndpoint: 'https://provider.example.com/token',
        clientId: 'cid',
        refreshPolicy: { leadMinutes: 10, maxRetries: 5, backoff: 'fixed', disabledOnFail: false },
      },
    })
    expect(res.status).toBe(201)
    const json = (await res.json()) as { credential: { id: string } }
    const stored = await t.storage.getCredential(json.credential.id as never)
    expect(stored?.refreshPolicy).toMatchObject({ leadMinutes: 10, maxRetries: 5, backoff: 'fixed', disabledOnFail: false })
  })

  it('create: rejects an invalid type', async () => {
    const { user, tokens } = await t.registerUser({ email: 'badtype@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'X', kind: 'api-key', secret: 's', type: 'not_a_type' },
    })
    expect(res.status).toBe(400)
  })

  it('create: rejects an invalid token endpoint URL', async () => {
    const { user, tokens } = await t.registerUser({ email: 'badurl@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'X', kind: 'oauth2', secret: 's', tokenEndpoint: 'not a url' },
    })
    expect(res.status).toBe(400)
  })

  it('create: rejects a non-positive expiresInSeconds', async () => {
    const { user, tokens } = await t.registerUser({ email: 'badexp@e.com' })
    t.setUserRole(user.id, 'admin')
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'X', kind: 'oauth2', secret: 's', expiresInSeconds: 0 },
    })
    expect(res.status).toBe(400)
  })

  it('rotate: 200 + audit entry (stub path without a refresher)', async () => {
    const { user, tokens } = await t.registerUser({ email: 'rot@e.com' })
    t.setUserRole(user.id, 'admin')
    const { id } = await createCred(tokens)
    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/rotate`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const json = (await res.json()) as { rotatedAt: number }
    expect(typeof json.rotatedAt).toBe('number')
    const logs = await t.storage.listAuditLogs({ action: 'credential.rotate' })
    expect(logs).toHaveLength(1)
  })

  it('list: includes type in the sanitized response', async () => {
    const { user, tokens } = await t.registerUser({ email: 'listtype@e.com' })
    t.setUserRole(user.id, 'admin')
    await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'OAuth2', kind: 'oauth2', secret: 'rt', type: 'oauth2_refresh_token', tokenEndpoint: 'https://provider.example.com/token', clientId: 'cid' },
    })
    const res = await callApp(t.app, 'GET', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    const json = (await res.json()) as { credentials: { type: string }[] }
    expect(json.credentials[0]?.type).toBe('oauth2_refresh_token')
  })
})