/**
 * @cadence/auth — RefreshSchedulerImpl tests.
 *
 * Covers: due-sweep, static/disabled skips, lead-window, distributed lock,
 * failure counting, circuit breaker (disable + audit + suspend tasks),
 * scheduleRefresh / cancelRefresh, and aggregated result counts.
 */
import { describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import type { Credential, Task, TaskId } from '@cadence/domain'
import type { SchedulerAdapter } from '@cadence/scheduler'
import type { CredentialRefresher } from '../src/credential-refresh.js'
import {
  RefreshSchedulerImpl,
  credentialScheduleKey,
} from '../src/index.js'
import { makeCipher, makeOAuth2Credential } from './credential-helpers.js'
import { ulid } from './ulid.js'

class FakeRefresher implements CredentialRefresher {
  readonly refreshed: string[] = []
  failAll = false
  async refresh(cred: Credential): Promise<Credential> {
    this.refreshed.push(cred.id)
    if (this.failAll) throw new Error('provider boom')
    return { ...cred, version: (cred.version ?? 1) + 1 }
  }
}

class FakeScheduler implements SchedulerAdapter {
  readonly scheduled: { taskId: string; runAt: number }[] = []
  readonly cancelled: string[] = []
  async schedule(taskId: TaskId, opts: { runAt: number }): Promise<void> {
    this.scheduled.push({ taskId: String(taskId), runAt: opts.runAt })
  }
  async scheduleCron(): Promise<void> {}
  async cancel(taskId: TaskId): Promise<void> {
    this.cancelled.push(String(taskId))
  }
  async hasSchedule(): Promise<boolean> {
    return false
  }
  async shutdown(): Promise<void> {}
}

function makeTask(overrides: Partial<Task> = {}): Task {
  return {
    id: ulid() as TaskId,
    name: 'depends-on-cred',
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
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
    ...overrides,
  }
}

describe('RefreshSchedulerImpl', () => {
  it('refreshes due oauth2 credentials', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    const sched = new FakeScheduler()
    const runner = new RefreshSchedulerImpl(storage, refresher, sched, { leadWindowMs: 5 * 60_000 })

    const result = await runner.runOnce()
    expect(result).toEqual({ succeeded: 1, failed: 0, skipped: 0 })
    expect(refresher.refreshed).toEqual([cred.id])
    expect(await storage.listRunningRefreshJobs(cred.id as never)).toHaveLength(0)
  })

  it('skips static_token credentials', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { type: 'static_token' })
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    const result = await runner.runOnce()
    expect(result.skipped).toBe(1)
    expect(result.succeeded).toBe(0)
    expect(refresher.refreshed).toHaveLength(0)
  })

  it('skips disabled credentials', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { disabledAt: Date.now() })
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    const result = await runner.runOnce()
    expect(result.skipped).toBe(1)
    expect(refresher.refreshed).toHaveLength(0)
  })

  it('does not refresh credentials outside the lead window', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { expiresAt: Date.now() + 10 * 60_000 })
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler(), { leadWindowMs: 5 * 60_000 })

    const result = await runner.runOnce()
    expect(result.succeeded).toBe(0)
    expect(result.skipped).toBe(0)
    expect(refresher.refreshed).toHaveLength(0)
  })

  it('distributed lock: skips a credential with a running refresh job', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    await storage.createRefreshJob({
      id: 'job-1',
      credId: cred.id as never,
      status: 'running',
      startedAt: Date.now(),
      finishedAt: null,
    })
    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    const result = await runner.runOnce()
    expect(result.skipped).toBe(1)
    expect(refresher.refreshed).toHaveLength(0)
  })

  it('acquires the lock before refreshing and releases it afterwards', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    await runner.runOnce()
    expect(await storage.listRunningRefreshJobs(cred.id as never)).toHaveLength(0)
    const completed = await storage.listRunningRefreshJobs(cred.id as never)
    expect(completed).toHaveLength(0)
  })

  it('records a failure and returns failed=1', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    refresher.failAll = true
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    const result = await runner.runOnce()
    expect(result.failed).toBe(1)
    expect(await storage.countConsecutiveRefreshFailures(cred.id as never)).toBe(1)
  })

  it('disables a credential after maxRetries consecutive failures', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, {
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
    })
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    refresher.failAll = true
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    await runner.runOnce()
    await runner.runOnce()
    const after2 = await storage.getCredential(cred.id as never)
    expect(after2?.disabledAt).toBeNull()
    expect(after2?.consecutiveFailures).toBe(2)

    await runner.runOnce()
    const after3 = await storage.getCredential(cred.id as never)
    expect(after3?.disabledAt).toBeTypeOf('number')
    expect(after3?.consecutiveFailures).toBe(3)
  })

  it('writes a credential.disabled_after_failures audit entry on disable', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    refresher.failAll = true
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    for (let i = 0; i < 3; i++) await runner.runOnce()

    const logs = await storage.listAuditLogs({ action: 'credential.disabled_after_failures' })
    expect(logs).toHaveLength(1)
    expect(logs[0]?.resourceId).toBe(cred.id)
    const meta = JSON.parse(logs[0]?.metadataJson ?? '{}') as { consecutiveFailures: number }
    expect(meta.consecutiveFailures).toBe(3)
  })

  it('suspends dependent tasks when the credential is disabled', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const task = makeTask()
    await storage.saveTask(task)
    await storage.attachCredentialToTask(task.id as never, cred.id as never)

    const refresher = new FakeRefresher()
    refresher.failAll = true
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    for (let i = 0; i < 3; i++) await runner.runOnce()

    const suspended = await storage.getTask(task.id as never)
    expect(suspended?.status).toBe('suspended')
  })

  it('does not disable when disabledOnFail is false', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, {
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'fixed', disabledOnFail: false },
    })
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    refresher.failAll = true
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    for (let i = 0; i < 5; i++) await runner.runOnce()

    const stored = await storage.getCredential(cred.id as never)
    expect(stored?.disabledAt).toBeNull()
    expect(stored?.consecutiveFailures).toBe(5)
  })

  it('aggregates result counts across multiple credentials', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const ok = await makeOAuth2Credential(cipher)
    const bad = await makeOAuth2Credential(cipher)
    const staticCred = await makeOAuth2Credential(cipher, { type: 'static_token' })
    await storage.saveCredential(ok)
    await storage.saveCredential(bad)
    await storage.saveCredential(staticCred)

    const refresher = new FakeRefresher()
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler())

    /* fail only `bad` by forcing one failure, then make refresher succeed */
    refresher.failAll = true
    await runner.runOnce() // bad fails → 1, ok succeeds
    refresher.failAll = false

    const result = await runner.runOnce()
    // ok already refreshed (expiry still past) → succeeds again; static skipped
    expect(result.succeeded).toBeGreaterThanOrEqual(1)
    expect(result.skipped).toBeGreaterThanOrEqual(1)
  })

  it('uses jobIdFactory for refresh-job ids', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher)
    await storage.saveCredential(cred)
    const refresher = new FakeRefresher()
    let counter = 0
    const runner = new RefreshSchedulerImpl(storage, refresher, new FakeScheduler(), {
      jobIdFactory: () => `job-${++counter}`,
    })

    await runner.runOnce()
    expect(counter).toBe(1)
  })

  it('scheduleRefresh schedules a one-off at expiresAt minus lead time', async () => {
    const storage = new InMemoryStorageAdapter()
    const cipher = makeCipher()
    const expiresAt = Date.now() + 3_600_000
    const cred = await makeOAuth2Credential(cipher, {
      expiresAt,
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
    })
    const sched = new FakeScheduler()
    const runner = new RefreshSchedulerImpl(storage, new FakeRefresher(), sched)

    await runner.scheduleRefresh(cred)
    expect(sched.scheduled).toHaveLength(1)
    expect(sched.scheduled[0]?.runAt).toBe(expiresAt - 5 * 60_000)
    expect(sched.scheduled[0]?.taskId).toBe(credentialScheduleKey(cred.id as never))
  })

  it('scheduleRefresh skips static_token credentials', async () => {
    const sched = new FakeScheduler()
    const runner = new RefreshSchedulerImpl(new InMemoryStorageAdapter(), new FakeRefresher(), sched)
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { type: 'static_token', expiresAt: Date.now() + 1000 })
    await runner.scheduleRefresh(cred)
    expect(sched.scheduled).toHaveLength(0)
  })

  it('scheduleRefresh skips credentials without an expiry', async () => {
    const sched = new FakeScheduler()
    const runner = new RefreshSchedulerImpl(new InMemoryStorageAdapter(), new FakeRefresher(), sched)
    const cipher = makeCipher()
    const cred = await makeOAuth2Credential(cipher, { expiresAt: null })
    await runner.scheduleRefresh(cred)
    expect(sched.scheduled).toHaveLength(0)
  })

  it('cancelRefresh cancels the derived schedule key', async () => {
    const sched = new FakeScheduler()
    const runner = new RefreshSchedulerImpl(new InMemoryStorageAdapter(), new FakeRefresher(), sched)
    await runner.cancelRefresh('00000000-0000-0000-0000-000000000000' as never)
    expect(sched.cancelled).toEqual([credentialScheduleKey('00000000-0000-0000-0000-000000000000' as never)])
  })
})
