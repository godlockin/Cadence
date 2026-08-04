/**
 * @cadence/api — credential refresh integration (PHASE 6).
 *
 * End-to-end: create an OAuth2 credential through the API, refresh it via
 * the wired `OAuth2Refresher`, and drive the scheduler to the disable path.
 */
import { describe, expect, it } from 'vitest'
import type { Hono } from 'hono'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { createApp, type AppEnv, type CreateAppDeps } from '../src/index.js'
import {
  AuthService,
  BUILTIN_ROLE_PERMISSIONS,
  createCredentialCipher,
  createJwtSigner,
  OAuth2Refresher,
  RefreshSchedulerImpl,
  type CredentialRefresher,
  type LookupFn,
} from '@cadence/auth'
import { EmbeddedSchedulerAdapter } from '@cadence/scheduler'
import type { Task, TaskId } from '@cadence/domain'
import { ulid } from 'ulid'
import { callApp, TEST_ENCRYPTION_KEY, TEST_JWT_SECRET } from './helpers.js'

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), { status, headers: { 'content-type': 'application/json' } })
}

function okFetch(): typeof fetch {
  return ((_input: RequestInfo | URL) => Promise.resolve(jsonResponse({ access_token: 'at-new', refresh_token: 'rt-new', expires_in: 3600 }))) as typeof fetch
}

function failingFetch(): typeof fetch {
  return ((_input: RequestInfo | URL) => Promise.resolve(jsonResponse({ error: 'invalid_grant' }, 400))) as typeof fetch
}

/** Public IPv4 so the SSRF guard's DNS re-check passes for fake endpoints. */
const publicDnsLookup: LookupFn = async () => [{ address: '93.184.216.34', family: 4 }]

interface RefreshApp {
  app: Hono<AppEnv>
  storage: InMemoryStorageAdapter
  refresher: CredentialRefresher
  auth: AuthService
  jwt: ReturnType<typeof createJwtSigner>
  deps: CreateAppDeps
  registerUser(opts?: { email?: string }): Promise<{ user: { id: string }; tokens: { accessToken: string } }>
}

function buildRefreshApp(fetchFn: typeof fetch = okFetch()): RefreshApp {
  const storage = new InMemoryStorageAdapter()
  const jwt = createJwtSigner(TEST_JWT_SECRET)
  const auth = new AuthService({ storage, jwt })
  const cipher = createCredentialCipher(TEST_ENCRYPTION_KEY)
  const refresher = new OAuth2Refresher(cipher, storage, undefined, { dnsLookup: publicDnsLookup, fetchFn })
  const deps: CreateAppDeps = { storage, auth, jwt, encryptionKey: TEST_ENCRYPTION_KEY, credentialRefresher: refresher }
  const app = createApp(deps)

  async function registerUser(opts: { email?: string } = {}): Promise<{ user: { id: string }; tokens: { accessToken: string } }> {
    const email = opts.email ?? `u${Math.random().toString(36).slice(2, 8)}@example.com`
    const out = await auth.register({ email, password: 'super-secret-password', displayName: 'Test', role: 'viewer' })
    return { user: { id: out.user.id }, tokens: { accessToken: out.accessToken } }
  }

  return { app, storage, refresher, auth, jwt, deps, registerUser }
}

function grantAdmin(t: RefreshApp, userId: string): void {
  t.storage.setUserRole(userId as never, BUILTIN_ROLE_PERMISSIONS['admin'])
}

async function createOAuth2Credential(t: RefreshApp, accessToken: string, overrides: Record<string, unknown> = {}): Promise<{ id: string }> {
  const res = await callApp(t.app, 'POST', '/api/credentials', {
    headers: { authorization: `Bearer ${accessToken}` },
    body: {
      name: 'GitHub',
      kind: 'oauth2',
      secret: 'refresh-token-original',
      type: 'oauth2_refresh_token',
      clientSecret: 'client-secret',
      tokenEndpoint: 'https://provider.example.com/oauth/token',
      clientId: 'client-123',
      expiresInSeconds: 3600,
      ...overrides,
    },
  })
  expect(res.status).toBe(201)
  const json = (await res.json()) as { credential: { id: string } }
  return { id: json.credential.id }
}

describe('credential refresh integration', () => {
  it('create → refresh → new token persisted with bumped version', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken)

    const before = await t.storage.getCredential(id as never)
    expect(before?.type).toBe('oauth2_refresh_token')
    expect(before?.version).toBe(1)

    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: number }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(2)

    const after = await t.storage.getCredential(id as never)
    expect(after?.version).toBe(2)
    expect(after?.lastRefreshedAt).toBeTypeOf('number')
    /* The refreshed secret re-encrypts to a different ciphertext. */
    expect(after?.ciphertext).not.toBe(before?.ciphertext)
  })

  it('refresh records a credential.refresh audit entry with outcome ok', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken)

    await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    const logs = await t.storage.listAuditLogs({ action: 'credential.refresh' })
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0]?.metadataJson ?? '{}')).toMatchObject({ outcome: 'ok' })
  })

  it('refresh of a non-oauth2 credential is a no-op stub (no error)', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const res = await callApp(t.app, 'POST', '/api/credentials', {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
      body: { name: 'API key', kind: 'api-key', secret: 'sk-123' },
    })
    const { credential } = (await res.json()) as { credential: { id: string } }

    const refresh = await callApp(t.app, 'POST', `/api/credentials/${credential.id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(refresh.status).toBe(200)
  })

  it('rotate force-rotates and writes an audit entry', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken)

    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/rotate`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(200)
    const body = (await res.json()) as { ok: boolean; version: number }
    expect(body.ok).toBe(true)
    expect(body.version).toBe(2)

    const logs = await t.storage.listAuditLogs({ action: 'credential.rotate' })
    expect(logs).toHaveLength(1)
  })

  it('refresh failure returns 502 and audits outcome failed', async () => {
    const t = buildRefreshApp(failingFetch())
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken)

    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(502)
    const logs = await t.storage.listAuditLogs({ action: 'credential.refresh' })
    expect(logs).toHaveLength(1)
    expect(JSON.parse(logs[0]?.metadataJson ?? '{}')).toMatchObject({ outcome: 'failed' })
  })

  it('refresh of a disabled credential returns 423', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken)
    await t.storage.disableCredential(id as never)

    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(423)
  })

  it('refresh of a credential with a blocked (SSRF) endpoint returns 422', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    const { id } = await createOAuth2Credential(t, tokens.accessToken, {
      tokenEndpoint: 'http://169.254.169.254/latest/meta-data',
    })

    const res = await callApp(t.app, 'POST', `/api/credentials/${id}/refresh`, {
      headers: { authorization: `Bearer ${tokens.accessToken}` },
    })
    expect(res.status).toBe(422)
    const body = (await res.json()) as { error: string }
    expect(body.error).toBe('ssrf_blocked')
  })

  it('scheduler disables the credential after 3 failures and suspends dependent tasks', async () => {
    const t = buildRefreshApp(failingFetch())
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    /* Expiring within the scheduler's 5-min lead window so it is due. */
    const { id } = await createOAuth2Credential(t, tokens.accessToken, { expiresInSeconds: 1 })

    /* A dependent task tied to the credential. */
    const task: Task = {
      id: ulid() as TaskId,
      name: 'uses-github',
      description: '',
      owner_id: user.id as TaskId,
      group_id: null,
      payload_kind: 'http',
      payload_json: '{}',
      trigger_kind: 'cron',
      trigger_config_json: '{"cron":"0 0 * * *"}',
      status: 'pending',
      cron: '0 0 * * *',
      timezone: 'UTC',
      start_at: null,
      end_at: null,
      max_retries: 0,
      retry_backoff: 'exponential',
      concurrency_policy: 'skip',
      jitter_ms: 0,
      timeout_ms: 30_000,
      tags: [],
      notifications_json: null,
      metadata_json: '{}',
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    }
    await t.storage.saveTask(task)
    await t.storage.attachCredentialToTask(task.id, id as never)

    const refreshScheduler = new RefreshSchedulerImpl(
      t.storage,
      t.refresher,
      new EmbeddedSchedulerAdapter(),
    )

    await refreshScheduler.runOnce()
    await refreshScheduler.runOnce()
    const after2 = await t.storage.getCredential(id as never)
    expect(after2?.disabledAt).toBeNull()

    await refreshScheduler.runOnce()
    const after3 = await t.storage.getCredential(id as never)
    expect(after3?.disabledAt).toBeTypeOf('number')
    expect(after3?.consecutiveFailures).toBe(3)

    const suspended = await t.storage.getTask(task.id)
    expect(suspended?.status).toBe('suspended')

    const logs = await t.storage.listAuditLogs({ action: 'credential.disabled_after_failures' })
    expect(logs).toHaveLength(1)
  })

  it('distributed lock prevents double refresh in the same sweep', async () => {
    const t = buildRefreshApp()
    const { user, tokens } = await t.registerUser()
    grantAdmin(t, user.id)
    /* Due within the lead window so the sweep considers it. */
    const { id } = await createOAuth2Credential(t, tokens.accessToken, { expiresInSeconds: 1 })

    /* Simulate another process already refreshing. */
    await t.storage.createRefreshJob({
      id: 'external-job',
      credId: id as never,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
    })

    const refreshScheduler = new RefreshSchedulerImpl(t.storage, t.refresher, new EmbeddedSchedulerAdapter())
    const result = await refreshScheduler.runOnce()
    expect(result.skipped).toBe(1)
    expect(result.succeeded).toBe(0)

    const stored = await t.storage.getCredential(id as never)
    expect(stored?.version).toBe(1)
  })
})
