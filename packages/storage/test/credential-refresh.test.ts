/**
 * @cadence/storage — PHASE 6 credential-refresh storage tests.
 *
 * Exercises the distributed-lock ledger, failure counter, disable path,
 * and task↔credential dependency across all three adapters.
 */
import { describe, expect, it } from 'vitest'
import type { Credential, CredentialId, Task, TaskId } from '@cadence/domain'
import {
  ConflictError,
  InMemoryStorageAdapter,
  SqliteStorageAdapter,
  D1StorageAdapter,
} from '../src/index.js'
import { ulid } from './ulid.js'
import Database from 'better-sqlite3'
import { makeD1Mock } from './d1.test.js'

function makeRichCredential(overrides: Partial<Credential> = {}): Credential {
  const now = Date.now()
  return {
    id: crypto.randomUUID(),
    ownerId: crypto.randomUUID(),
    name: 'oauth',
    kind: 'oauth2',
    type: 'oauth2_refresh_token',
    ciphertext: 'ct',
    iv: 'iv',
    authTag: 'tag',
    keyId: 'v1',
    clientSecretCiphertext: 'csct',
    clientSecretIv: 'csiv',
    clientSecretAuthTag: 'cstag',
    tokenEndpoint: 'https://provider.example.com/token',
    clientId: 'cid',
    expiresAt: now - 60_000,
    lastRefreshedAt: now - 3_600_000,
    consecutiveFailures: 0,
    disabledAt: null,
    refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
    version: 1,
    createdAt: new Date(now - 86_400_000).toISOString(),
    updatedAt: now - 3_600_000,
    ...overrides,
  }
}

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: ulid() as TaskId,
    name: 't',
    description: '',
    owner_id: ulid() as TaskId,
    group_id: null,
    payload_kind: 'http',
    payload_json: '{}',
    trigger_kind: 'manual',
    trigger_config_json: '{}',
    status: 'pending',
    cron: null,
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
    created_at: now,
    updated_at: now,
    deleted_at: null,
    ...overrides,
  }
}

async function inMemory(): Promise<InMemoryStorageAdapter> {
  return new InMemoryStorageAdapter()
}
async function sqlite(): Promise<SqliteStorageAdapter> {
  const db = new Database(':memory:')
  db.pragma('foreign_keys = ON')
  const s = new SqliteStorageAdapter(db)
  await s.migrate()
  return s
}
async function d1(): Promise<D1StorageAdapter> {
  const s = new D1StorageAdapter(makeD1Mock())
  await s.migrate()
  return s
}

type AdapterFactory = () => Promise<InMemoryStorageAdapter | SqliteStorageAdapter | D1StorageAdapter>

const factories: { label: string; make: AdapterFactory }[] = [
  { label: 'InMemory', make: inMemory },
  { label: 'Sqlite', make: sqlite },
  { label: 'D1', make: d1 },
]

for (const { label, make } of factories) {
  describe(`credential refresh storage — ${label}`, () => {
    it('listCredentials filters by expiresBefore', async () => {
      const s = await make()
      const due = makeRichCredential({ expiresAt: Date.now() - 60_000 })
      const notDue = makeRichCredential({ expiresAt: Date.now() + 3_600_000 })
      await s.saveCredential(due)
      await s.saveCredential(notDue)
      const rows = await s.listCredentials({ expiresBefore: Date.now() + 5 * 60_000 })
      expect(rows.map((r) => r.id)).toEqual([due.id])
    })

    it('listCredentials filters by type and disabled', async () => {
      const s = await make()
      const oauth = makeRichCredential()
      const staticCred = makeRichCredential({ type: 'static_token' })
      const disabled = makeRichCredential({ disabledAt: Date.now() })
      await s.saveCredential(oauth)
      await s.saveCredential(staticCred)
      await s.saveCredential(disabled)
      expect(await s.listCredentials({ type: 'oauth2_refresh_token' })).toHaveLength(2)
      expect(await s.listCredentials({ disabled: true })).toHaveLength(1)
      expect(await s.listCredentials({ disabled: false })).toHaveLength(2)
    })

    it('createRefreshJob rejects a second running job (distributed lock)', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      await s.createRefreshJob({ id: 'job-1', credId: cred.id as CredentialId, status: 'running', startedAt: Date.now(), finishedAt: null })
      await expect(
        s.createRefreshJob({ id: 'job-2', credId: cred.id as CredentialId, status: 'running', startedAt: Date.now(), finishedAt: null }),
      ).rejects.toBeInstanceOf(ConflictError)
      expect(await s.listRunningRefreshJobs(cred.id as CredentialId)).toHaveLength(1)
    })

    it('completeRefreshJob releases the lock', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      await s.createRefreshJob({ id: 'job-1', credId: cred.id as CredentialId, status: 'running', startedAt: Date.now(), finishedAt: null })
      await s.completeRefreshJob(cred.id as CredentialId, 'ok')
      expect(await s.listRunningRefreshJobs(cred.id as CredentialId)).toHaveLength(0)
    })

    it('recordRefreshFailure increments the consecutive counter', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      expect(await s.recordRefreshFailure(cred.id as CredentialId)).toBe(1)
      expect(await s.recordRefreshFailure(cred.id as CredentialId)).toBe(2)
      expect(await s.countConsecutiveRefreshFailures(cred.id as CredentialId)).toBe(2)
    })

    it('disableCredential sets disabledAt idempotently', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      await s.disableCredential(cred.id as CredentialId)
      const stored = await s.getCredential(cred.id as CredentialId)
      expect(stored?.disabledAt).toBeTypeOf('number')
      const first = stored?.disabledAt
      await s.disableCredential(cred.id as CredentialId)
      expect((await s.getCredential(cred.id as CredentialId))?.disabledAt).toBe(first)
    })

    it('listTasksByCredential returns linked tasks', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      const task = makeTask()
      await s.saveTask(task)
      await s.attachCredentialToTask(task.id, cred.id as CredentialId)
      const tasks = await s.listTasksByCredential(cred.id as CredentialId)
      expect(tasks.map((t) => t.id)).toEqual([task.id])
    })

    it('round-trips rich credential fields', async () => {
      const s = await make()
      const cred = makeRichCredential()
      await s.saveCredential(cred)
      const stored = await s.getCredential(cred.id as CredentialId)
      expect(stored).toMatchObject({
        type: 'oauth2_refresh_token',
        keyId: 'v1',
        tokenEndpoint: 'https://provider.example.com/token',
        clientId: 'cid',
        version: 1,
        refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
      })
      expect(stored?.expiresAt).toBeTypeOf('number')
      expect(stored?.clientSecretCiphertext).toBe('csct')
    })
  })
}
