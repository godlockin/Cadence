/**
 * @cadence/sinker — edge case unit tests.
 *
 * Covers:
 *  - TaskSchema name: 200 chars (max) → accepted
 *  - TaskSchema name: 201 chars → rejected
 *  - TaskSchema name: empty → rejected
 *  - TaskSchema description: 2000 chars (max) → accepted
 *  - TaskSchema description: 2001 chars → rejected
 *  - TaskSchema description: null → accepted
 *  - payload_json: 100KB → accepted by schema
 *  - payload_json: 1MB → accepted by schema (TEXT boundary)
 *  - SinkerEngine.trigger() empty userId → TypeError
 *  - SinkerEngine.trigger() unknown task → TaskNotFoundError
 *  - SinkerEngine.cancel() unknown exec → idempotent (no throw)
 *  - SinkerEngine.cancel() terminal exec → idempotent (no throw)
 */
import { describe, expect, it } from 'vitest'
import { ulid } from 'ulid'
import type { TaskId } from '@cadence/domain'
import { TaskSchema } from '@cadence/domain'
import { SinkerEngine, BufferedLogger } from '../src/index.js'
import { FakeQueue } from './fixtures/fake-queue.js'
import { FakeScheduler } from './fixtures/fake-scheduler.js'
import { FakeNotifier } from './fixtures/fake-notifier.js'
import { FakeExecutor } from './fixtures/fake-executor.js'
import { PayloadDispatcher } from '../src/dispatcher.js'
import { FakeStorage } from './fixtures/fake-storage.js'
import { InMemoryStorageAdapter } from '@cadence/storage'

/* --------------------------------------------------------------- */
/* TaskSchema — string length boundaries                            */
/* --------------------------------------------------------------- */

describe('TaskSchema — string length boundaries', () => {
  /** Minimal required fields for TaskSchema.parse() */
  const BASE = () => ({
    id: ulid(),
    name: 'default',
    owner_id: ulid(),
    group_id: null,
    payload_kind: 'http' as const,
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
    tags: [] as string[],
    notifications_json: null,
    metadata_json: '{}',
    version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  })

  it('name 200 chars (max) → accepted', () => {
    expect(() => TaskSchema.parse(BASE())).not.toThrow()
    expect(() => TaskSchema.parse({ ...BASE(), name: 'a'.repeat(200) })).not.toThrow()
  })

  it('name 201 chars → rejected', () => {
    expect(() => TaskSchema.parse({ ...BASE(), name: 'a'.repeat(201) })).toThrow()
  })

  it('name empty string → rejected', () => {
    expect(() => TaskSchema.parse({ ...BASE(), name: '' })).toThrow()
  })

  it('description 2000 chars (max) → accepted', () => {
    expect(() => TaskSchema.parse({ ...BASE(), description: 'x'.repeat(2000) })).not.toThrow()
  })

  it('description 2001 chars → rejected', () => {
    expect(() => TaskSchema.parse({ ...BASE(), description: 'x'.repeat(2001) })).toThrow()
  })

  it('description null → accepted', () => {
    expect(() => TaskSchema.parse({ ...BASE(), description: null })).not.toThrow()
  })
})

/* --------------------------------------------------------------- */
/* Payload size edge cases                                           */
/* --------------------------------------------------------------- */

describe('payload_json — size edge cases', () => {
  const BASE = () => ({
    id: ulid(),
    name: 'payload-test',
    owner_id: ulid(),
    group_id: null,
    payload_kind: 'http' as const,
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
    tags: [] as string[],
    notifications_json: null,
    metadata_json: '{}',
    version: 1,
    created_at: Date.now(),
    updated_at: Date.now(),
    deleted_at: null,
  })

  it('100KB payload_json → accepted by schema', () => {
    const bigPayload = JSON.stringify({ data: 'x'.repeat(100_000) })
    expect(() => TaskSchema.parse({ ...BASE(), payload_json: bigPayload })).not.toThrow()
  })

  it('1MB payload_json → accepted by schema (TEXT boundary)', () => {
    const mbPayload = JSON.stringify({ data: 'x'.repeat(1_000_000) })
    expect(() => TaskSchema.parse({ ...BASE(), payload_json: mbPayload })).not.toThrow()
  })

  it('InMemoryStorageAdapter stores 1MB payload_json', async () => {
    const storage = new InMemoryStorageAdapter()
    const mbPayload = JSON.stringify({ data: 'x'.repeat(1_000_000) })
    const taskId = ulid() as TaskId
    const task = {
      id: taskId,
      name: 'mb-payload',
      description: null,
      owner_id: ulid(),
      group_id: null,
      payload_kind: 'http' as const,
      payload_json: mbPayload,
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
      tags: [] as string[],
      notifications_json: null,
      metadata_json: '{}',
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    }
    await storage.saveTask(task)
    const retrieved = await storage.getTask(taskId)
    expect(retrieved?.payload_json.length).toBe(mbPayload.length)
  })
})

/* --------------------------------------------------------------- */
/* SinkerEngine — error handling edge cases                         */
/* --------------------------------------------------------------- */

function buildEngine(storageAdapter: ReturnType<FakeStorage['asAdapter']>) {
  const dispatcher = new PayloadDispatcher({ logger: new BufferedLogger() })
  return new SinkerEngine({
    storage: storageAdapter,
    queue: new FakeQueue(),
    executor: new FakeExecutor(),
    scheduler: new FakeScheduler(),
    notifier: new FakeNotifier(),
    logger: new BufferedLogger(),
    dispatcher,
    runtime: 'local',
  })
}

describe('SinkerEngine.trigger — error handling', () => {
  it('empty userId string → TypeError', async () => {
    const storage = new FakeStorage()
    const engine = buildEngine(storage.asAdapter())

    storage.putTask({
      id: ulid() as TaskId,
      name: 'test',
      description: null,
      owner_id: 'owner-1',
      group_id: null,
      payload_kind: 'http' as const,
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
      tags: [] as string[],
      notifications_json: null,
      metadata_json: '{}',
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    })

    await expect(
      engine.trigger(
        ulid() as TaskId,
        { source: 'manual', triggeredBy: 'user', payload: {} },
        { userId: '' },
      ),
    ).rejects.toBeInstanceOf(TypeError)
  })

  it('unknown taskId → TaskNotFoundError', async () => {
    const storage = new FakeStorage()
    const engine = buildEngine(storage.asAdapter())

    await expect(
      engine.trigger(
        ulid() as TaskId,
        { source: 'manual', triggeredBy: 'user', payload: {} },
        { userId: 'user-1' },
      ),
    ).rejects.toThrow('not found')
  })
})

describe('SinkerEngine.cancel — idempotency', () => {
  it('cancel() unknown executionId → no throw (idempotent)', async () => {
    const storage = new FakeStorage()
    const engine = buildEngine(storage.asAdapter())

    await expect(engine.cancel(ulid() as Parameters<typeof engine.cancel>[0])).resolves
      .toBeUndefined()
  })

  it('cancel() terminal execution → no throw (idempotent)', async () => {
    const storage = new FakeStorage()
    const engine = buildEngine(storage.asAdapter())
    const taskId = ulid() as TaskId
    const execId = ulid() as Parameters<typeof engine.cancel>[0]

    storage.putTask({
      id: taskId,
      name: 'test',
      description: null,
      owner_id: 'owner-1',
      group_id: null,
      payload_kind: 'http' as const,
      payload_json: '{}',
      trigger_kind: 'manual' as const,
      trigger_config_json: '{}',
      status: 'success' as const,
      cron: null,
      timezone: 'UTC',
      start_at: null,
      end_at: null,
      max_retries: 0,
      retry_backoff: 'exponential' as const,
      concurrency_policy: 'skip' as const,
      jitter_ms: 0,
      timeout_ms: 30_000,
      tags: [] as string[],
      notifications_json: null,
      metadata_json: '{}',
      version: 1,
      created_at: Date.now(),
      updated_at: Date.now(),
      deleted_at: null,
    })

    // FakeStorage.createExecution signature: NewExecutionInput
    storage.createExecution({
      id: execId,
      taskId,
      triggerSource: 'manual',
      triggeredBy: null,
      startedAt: Date.now() - 5000,
      finishedAt: Date.now(),
      durationMs: 5000,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: null,
    })

    // Idempotent — terminal state cancel is a no-op
    await expect(engine.cancel(execId)).resolves.toBeUndefined()
  })
})
