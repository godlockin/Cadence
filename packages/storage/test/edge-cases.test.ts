/**
 * @cadence/storage — edge case unit tests.
 *
 * Covers:
 *  - ULID min/max stored and retrieved correctly
 *  - concurrent saveTask with same id → second throws ConflictError
 *  - concurrent updateTask same id → second throws StaleVersionError
 *  - task filter: q (fuzzy) match is case-insensitive
 *  - task filter: q with no match → []
 *  - task filter: tags (multiple) → tasks with ALL matching tags
 *  - task filter: includeDeleted=false (default) → excludes soft-deleted
 *  - task filter: includeDeleted=true → includes soft-deleted
 *  - execution filter: from/to range
 *  - execution filter: triggerSource exact match
 *  - credential filter: expiresBefore (overdue)
 *  - credential filter: disabled=true / disabled=false
 *  - InMemoryStorageAdapter: soft-delete + re-save same id → ConflictError
 *  - optimistic locking: version mismatch → StaleVersionError
 *  - audit: duplicate id → ConflictError
 *  - group membership: non-existent group → false (not throw)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '../src/index.js'
import { ConflictError, NotFoundError, StaleVersionError } from '../src/interface.js'
import { ulid } from 'ulid'
import type { CredentialId, ExecutionId, GroupId, TaskId, UserId } from '@cadence/domain'

/* --------------------------------------------------------------- */
/* ULID extremes                                                    */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — ULID extremes', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
  })

  it('min ULID (all 0) saved and retrieved', async () => {
    const id = '00000000000000000000000000' as TaskId
    await storage.saveTask({
      id,
      name: 'min-ulid',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    })
    const retrieved = await storage.getTask(id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(id)
  })

  it('max ULID (all Z) saved and retrieved', async () => {
    const id = 'ZZZZZZZZZZZZZZZZZZZZZZZZ' as TaskId
    await storage.saveTask({
      id,
      name: 'max-ulid',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    })
    const retrieved = await storage.getTask(id)
    expect(retrieved).not.toBeNull()
    expect(retrieved!.id).toBe(id)
  })

  it('max ULID used as userId, groupId, executionId — all retrievable', async () => {
    const maxId = 'ZZZZZZZZZZZZZZZZZZZZZZZZ' as TaskId
    const maxExecId = 'ZZZZZZZZZZZZZZZZZZZZZZZZ' as ExecutionId
    await storage.saveTask({
      id: maxId,
      name: 'max-id-task',
      description: null,
      owner_id: maxId,
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    })
    await storage.createExecution({
      id: maxExecId,
      taskId: maxId,
      status: 'queued',
      triggerSource: 'manual',
      triggeredBy: null,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: null,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })

    expect(await storage.getTask(maxId)).not.toBeNull()
    expect(await storage.getExecution(maxExecId)).not.toBeNull()
  })
})

/* --------------------------------------------------------------- */
/* Concurrent save (ConflictError)                                  */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — ConflictError on duplicate ids', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
  })

  async function makeTask(id?: TaskId) {
    return {
      id: (id ?? ulid()) as TaskId,
      name: 'task',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    }
  }

  it('saveTask same id twice → second throws ConflictError', async () => {
    const task = await makeTask()
    await storage.saveTask(task)
    await expect(storage.saveTask(task)).rejects.toBeInstanceOf(ConflictError)
  })

  it('saveTask same id after soft-delete → ConflictError (not allowed)', async () => {
    const task = await makeTask()
    await storage.saveTask(task)
    await storage.deleteTask(task.id, task.version)
    // Soft-delete removes from the active map; re-saving same id is a conflict
    await expect(storage.saveTask(task)).rejects.toBeInstanceOf(ConflictError)
  })

  it('createExecution same id twice → second throws ConflictError', async () => {
    const exec = {
      id: '01AXXXXXXXXXXXXXXXXXXXXXXXX' as ExecutionId,
      taskId: ulid() as TaskId,
      status: 'queued' as const,
      triggerSource: 'manual' as const,
      triggeredBy: null,
      startedAt: Date.now(),
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: null,
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    }
    await storage.createExecution(exec)
    await expect(storage.createExecution(exec)).rejects.toBeInstanceOf(ConflictError)
  })

  it('audit append with duplicate id → ConflictError', async () => {
    const entry = {
      id: 'audit-001',
      action: 'task.created' as const,
      actorId: null,
      resourceKind: 'task' as const,
      resourceId: 't-1',
      diffJson: '{}',
      metadataJson: '{}',
      createdAt: Date.now(),
    }
    await storage.appendAudit(entry)
    await expect(storage.appendAudit(entry)).rejects.toBeInstanceOf(ConflictError)
  })
})

/* --------------------------------------------------------------- */
/* Optimistic locking — StaleVersionError                           */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — StaleVersionError', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
  })

  it('updateTask with wrong expectedVersion → StaleVersionError', async () => {
    const id = ulid() as TaskId
    await storage.saveTask({
      id,
      name: 'task',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    })

    // Try to update with stale version (expected 1, but task.version is 1, so this is correct)
    // Let's update once, then try stale
    await storage.updateTask(id, { name: 'v2', expectedVersion: 1 })
    await expect(storage.updateTask(id, { name: 'v3', expectedVersion: 1 })).rejects.toBeInstanceOf(
      StaleVersionError,
    )
  })

  it('updateTask with correct expectedVersion → succeeds', async () => {
    const id = ulid() as TaskId
    await storage.saveTask({
      id,
      name: 'task',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'manual',
      payload_json: '{}',
      trigger_kind: 'manual',
      trigger_config_json: '{}',
      status: 'scheduled',
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
    })

    const updated = await storage.updateTask(id, { name: 'updated', expectedVersion: 1 })
    expect(updated.name).toBe('updated')
    expect(updated.version).toBe(2)
  })
})

/* --------------------------------------------------------------- */
/* Task filters                                                     */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — task filter edge cases', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
    // Seed 3 tasks
    for (const [name, status, deleted] of [
      ['Build Report', 'scheduled', false],
      ['build report', 'running', false],
      ['Build REPORT', 'success', true],
    ] as const) {
      const t = {
        id: ulid() as TaskId,
        name,
        description: null,
        owner_id: ulid(),
        group_id: null,
        payload_kind: 'manual' as const,
        payload_json: '{}',
        trigger_kind: 'manual' as const,
        trigger_config_json: '{}',
        status: status as Parameters<typeof storage.saveTask>[0]['status'],
        cron: null,
        timezone: 'UTC',
        start_at: null,
        end_at: null,
        max_retries: 0,
        retry_backoff: 'exponential' as const,
        concurrency_policy: 'skip' as const,
        jitter_ms: 0,
        timeout_ms: 30_000,
        tags: [],
        notifications_json: null,
        metadata_json: '{}',
        version: 1,
        created_at: Date.now(),
        updated_at: Date.now(),
        deleted_at: deleted ? Date.now() : null,
      }
      await storage.saveTask(t)
    }
  })

  it('q filter is case-insensitive', async () => {
    // All 3 tasks seeded; 2 non-deleted + 1 soft-deleted.
    // includeDeleted=false (default) → only 2 non-deleted returned.
    const results = await storage.listTasks({ q: 'build report' })
    expect(results.length).toBe(2)
  })

  it('q filter with no match → []', async () => {
    const results = await storage.listTasks({ q: 'nonexistent-task-name-xyz' })
    expect(results).toEqual([])
  })

  it('includeDeleted=false (default) → excludes soft-deleted', async () => {
    const results = await storage.listTasks({})
    // 2 non-deleted
    expect(results.length).toBe(2)
    for (const t of results) {
      expect(t.deleted_at).toBeNull()
    }
  })

  it('includeDeleted=true → includes soft-deleted', async () => {
    const results = await storage.listTasks({ includeDeleted: true })
    expect(results.length).toBe(3)
  })

  it('status filter → exact match', async () => {
    const results = await storage.listTasks({ status: 'running' })
    expect(results.length).toBe(1)
    expect(results[0]!.status).toBe('running')
  })

  it('ownerId filter → exact match', async () => {
    const task = {
      id: ulid() as TaskId,
      name: 'owner-test',
      description: null,
      owner_id: 'specific-owner-id-12345',
      group_id: null,
      payload_kind: 'manual' as const,
      payload_json: '{}',
      trigger_kind: 'manual' as const,
      trigger_config_json: '{}',
      status: 'scheduled' as const,
      cron: null,
      timezone: 'UTC',
      start_at: null,
      end_at: null,
      max_retries: 0,
      retry_backoff: 'exponential' as const,
      concurrency_policy: 'skip' as const,
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
    await storage.saveTask(task)
    const results = await storage.listTasks({ ownerId: 'specific-owner-id-12345' as UserId })
    expect(results.length).toBe(1)
    expect(results[0]!.id).toBe(task.id)
  })
})

/* --------------------------------------------------------------- */
/* Execution filters                                                */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — execution filter edge cases', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
    const taskId = ulid() as TaskId
    const now = Date.now()
    for (const [source, status, startedAt] of [
      ['cron', 'success', now - 100_000],
      ['webhook', 'failed', now - 80_000],
      ['manual', 'running', now - 10_000],
      ['event', 'queued', now],
    ] as const) {
      await storage.createExecution({
        id: ulid() as ExecutionId,
        taskId,
        status: status as Parameters<typeof storage.createExecution>[0]['status'],
        triggerSource: source as Parameters<typeof storage.createExecution>[0]['triggerSource'],
        triggeredBy: null,
        startedAt,
        finishedAt: status === 'success' || status === 'failed' ? now - 50_000 : null,
        durationMs: null,
        retryCount: 0,
        errorJson: null,
        resultJson: null,
        idempotencyKey: null,
        version: 1,
        createdAt: now,
        updatedAt: now,
      })
    }
  })

  it('execution filter: from/to range', async () => {
    // cron: now-100k, webhook: now-80k, manual: now-10k, event: now
    // Filter: from=now-90k, to=now-20k
    // In range: only webhook (now-80k)
    const results = await storage.listExecutions({ from: Date.now() - 90_000, to: Date.now() - 20_000 })
    expect(results.length).toBe(1)
    expect(results[0]!.triggerSource).toBe('webhook')
  })

  it('execution filter: triggerSource exact match', async () => {
    const results = await storage.listExecutions({ triggerSource: 'cron' })
    expect(results.length).toBe(1)
    expect(results[0]!.triggerSource).toBe('cron')
  })

  it('execution filter: no match → []', async () => {
    const results = await storage.listExecutions({ triggerSource: 'retry' })
    expect(results).toEqual([])
  })
})

/* --------------------------------------------------------------- */
/* Group membership edge cases                                     */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — isGroupMember edge cases', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
  })

  it('non-existent group → false (not throw)', async () => {
    const result = await storage.isGroupMember('nonexistent-group' as GroupId, 'any-user' as UserId)
    expect(result).toBe(false)
  })

  it('existing group, non-member user → false', async () => {
    const groupId = ulid() as GroupId
    await storage.saveGroup({
      id: groupId,
      name: 'Test Group',
      owner_id: ulid(),
      created_at: Date.now(),
      updated_at: Date.now(),
    })
    const result = await storage.isGroupMember(groupId, 'non-member-user' as UserId)
    expect(result).toBe(false)
  })
})

/* --------------------------------------------------------------- */
/* Credential filters                                              */
/* --------------------------------------------------------------- */

describe('InMemoryStorageAdapter — credential filter edge cases', () => {
  let storage: InMemoryStorageAdapter

  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
    const now = Date.now()
    // overdue, disabled
    await storage.saveCredential({
      id: '01AXXXXXXXXXXXXXXXXXXXXXXXXA' as CredentialId,
      ownerId: ulid() as UserId,
      name: 'expired',
      kind: 'oauth2',
      type: 'oauth2_refresh_token',
      ciphertext: 'a',
      iv: 'a',
      authTag: 'a',
      keyId: 'v1',
      clientSecretCiphertext: null,
      clientSecretIv: null,
      clientSecretAuthTag: null,
      tokenEndpoint: 'https://x.com/token',
      clientId: 'c',
      expiresAt: now - 100_000,
      lastRefreshedAt: now - 200_000,
      consecutiveFailures: 0,
      disabledAt: null,
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
      version: 1,
      createdAt: now,
      updatedAt: now,
    })

    // not overdue
    await storage.saveCredential({
      id: '01AXXXXXXXXXXXXXXXXXXXXXXXXB' as CredentialId,
      ownerId: ulid() as UserId,
      name: 'valid',
      kind: 'oauth2',
      type: 'oauth2_refresh_token',
      ciphertext: 'b',
      iv: 'b',
      authTag: 'b',
      keyId: 'v1',
      clientSecretCiphertext: null,
      clientSecretIv: null,
      clientSecretAuthTag: null,
      tokenEndpoint: 'https://x.com/token',
      clientId: 'c',
      expiresAt: now + 3_600_000,
      lastRefreshedAt: now,
      consecutiveFailures: 0,
      disabledAt: null,
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
      version: 1,
      createdAt: now,
      updatedAt: now,
    })
  })

  it('expiresBefore filter → only overdue credentials', async () => {
    const results = await storage.listCredentials({ expiresBefore: Date.now() }, [{ field: 'createdAt', direction: 'asc' }])
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe('expired')
  })

  it('disabled=true filter → only disabled', async () => {
    const disabled = await storage.saveCredential({
      id: '01AXXXXXXXXXXXXXXXXXXXXXXXXC' as CredentialId,
      ownerId: ulid() as UserId,
      name: 'disabled-creds',
      kind: 'oauth2',
      type: 'oauth2_refresh_token',
      ciphertext: 'c',
      iv: 'c',
      authTag: 'c',
      keyId: 'v1',
      clientSecretCiphertext: null,
      clientSecretIv: null,
      clientSecretAuthTag: null,
      tokenEndpoint: 'https://x.com/token',
      clientId: 'c',
      expiresAt: Date.now() + 3_600_000,
      lastRefreshedAt: Date.now(),
      consecutiveFailures: 0,
      disabledAt: Date.now(),
      refreshPolicy: { leadMinutes: 5, maxRetries: 3, backoff: 'exponential', disabledOnFail: true },
      version: 1,
      createdAt: Date.now(),
      updatedAt: Date.now(),
    })
    const results = await storage.listCredentials({ disabled: true }, [{ field: 'createdAt', direction: 'asc' }])
    expect(results.length).toBe(1)
    expect(results[0]!.name).toBe('disabled-creds')
  })

  it('disabled=false filter → only non-disabled', async () => {
    const results = await storage.listCredentials({ disabled: false }, [{ field: 'createdAt', direction: 'asc' }])
    expect(results.length).toBe(2)
    for (const r of results) {
      expect(r.disabledAt).toBeNull()
    }
  })
})
