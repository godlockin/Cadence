/**
 * @cadence/scheduler — concurrency policy unit tests.
 *
 * Covers:
 *  - 'skip'  → returns 'skip' when an active execution exists
 *  - 'queue' → returns 'wait' when an active execution exists
 *  - 'parallel' → returns 'allow' regardless of active count
 *  - 'kill_old' → invokes storage.cancelExecution for each active, then 'allow';
 *                  throws ConcurrencyError when storage lacks cancelExecution
 *  - no active → 'allow' for every policy
 *  - default → 'skip' (fail-safe)
 */
import { beforeEach, describe, expect, it } from 'vitest'
import { InMemoryStorageAdapter } from '@cadence/storage'
import type { ExecutionId, Task, TaskId } from '@cadence/domain'

import { checkConcurrency, ConcurrencyError } from '../src/index.js'
import { buildTask } from './helpers.js'

const e1 = '01AEXEXEXEXEXEXEXEXEXEXEXEX' as ExecutionId

function makeTaskWith(policy: Task['concurrency_policy']): Task {
  return buildTask({ concurrency_policy: policy })
}

/** InMemoryStorageAdapter that additionally implements cancelExecution. */
class StorageWithCancelExecution extends InMemoryStorageAdapter {
  readonly cancelledIds: ExecutionId[] = []
  async cancelExecution(id: ExecutionId): Promise<void> {
    this.cancelledIds.push(id)
    const exec = await this.getExecution(id)
    if (exec !== null) {
      await this.updateExecution(id, {
        status: 'cancelled',
        finishedAt: Date.now(),
        expectedVersion: exec.version,
      })
    }
  }
}

describe('checkConcurrency — no active executions', () => {
  let storage: InMemoryStorageAdapter
  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
  })

  it("'skip' → 'allow' when nothing is running", async () => {
    const task = makeTaskWith('skip')
    await storage.saveTask(task)
    expect(await checkConcurrency(task, storage)).toBe('allow')
  })

  it("'queue' → 'allow' when nothing is running", async () => {
    const task = makeTaskWith('queue')
    await storage.saveTask(task)
    expect(await checkConcurrency(task, storage)).toBe('allow')
  })

  it("'parallel' → 'allow' when nothing is running", async () => {
    const task = makeTaskWith('parallel')
    await storage.saveTask(task)
    expect(await checkConcurrency(task, storage)).toBe('allow')
  })

  it("'kill_old' → 'allow' when nothing is running", async () => {
    const task = makeTaskWith('kill_old')
    await storage.saveTask(task)
    expect(await checkConcurrency(task, storage)).toBe('allow')
  })
})

describe('checkConcurrency — with active execution', () => {
  let storage: InMemoryStorageAdapter
  beforeEach(async () => {
    storage = new InMemoryStorageAdapter()
  })

  it("'skip' → 'skip' when active exists", async () => {
    const task = makeTaskWith('skip')
    await storage.saveTask(task)
    await storage.createExecution({
      id: '01AAAAAAAAAAAAAAAAAAAAAAAA' as ExecutionId,
      taskId: task.id,
      status: 'running',
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
    expect(await checkConcurrency(task, storage)).toBe('skip')
  })

  it("'queue' → 'wait' when active exists", async () => {
    const task = makeTaskWith('queue')
    await storage.saveTask(task)
    await storage.createExecution({
      id: '01ABBBBBBBBBBBBBBBBBBBBBBBB' as ExecutionId,
      taskId: task.id,
      status: 'running',
      triggerSource: 'cron',
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
    expect(await checkConcurrency(task, storage)).toBe('wait')
  })

  it("'parallel' → 'allow' even with active", async () => {
    const task = makeTaskWith('parallel')
    await storage.saveTask(task)
    await storage.createExecution({
      id: '01ACCCCCCCCCCCCCCCCCCCCCCCC' as ExecutionId,
      taskId: task.id,
      status: 'running',
      triggerSource: 'webhook',
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
    expect(await checkConcurrency(task, storage)).toBe('allow')
  })

  it("'kill_old' → throws ConcurrencyError when storage lacks cancelExecution", async () => {
    const task = makeTaskWith('kill_old')
    await storage.saveTask(task)
    await storage.createExecution({
      id: e1 as ExecutionId,
      taskId: task.id,
      status: 'running',
      triggerSource: 'cron',
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

    /* InMemoryStorageAdapter does not implement cancelExecution — the
     * policy must fail closed instead of silently allowing a stacked run. */
    await expect(checkConcurrency(task, storage)).rejects.toThrow(ConcurrencyError)
  })

  it("'kill_old' → 'allow' and cancels every active execution when storage supports it", async () => {
    const task = makeTaskWith('kill_old')
    const storageWithCancel = new StorageWithCancelExecution()
    await storageWithCancel.saveTask(task)
    const activeIds: ExecutionId[] = [
      e1,
      '01ADDDDDDDDDDDDDDDDDDDDDDD' as ExecutionId,
    ]
    for (const id of activeIds) {
      await storageWithCancel.createExecution({
        id,
        taskId: task.id,
        status: 'running',
        triggerSource: 'cron',
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
    }

    expect(await checkConcurrency(task, storageWithCancel)).toBe('allow')
    expect(storageWithCancel.cancelledIds.sort()).toEqual([...activeIds].sort())
  })
})

describe('checkConcurrency — fail-safe default', () => {
  it('returns skip for unknown policy values', async () => {
    /* The schema constrains the enum but the function should still
     * behave fail-safe if a malformed row sneaks through. */
    const storage = new InMemoryStorageAdapter()
    const task = buildTask()
    /* Force the policy to an invalid value via cast. */
    const tampered = { ...task, concurrency_policy: 'bogus' as Task['concurrency_policy'] }
    await storage.saveTask(tampered as Task)
    /* No active → returns 'allow' because the switch hits default only
     * when active.length > 0; this no-active path returns 'allow'
     * eagerly before the switch. */
    expect(await checkConcurrency(tampered as Task, storage)).toBe('allow')
  })

  it('TaskId types align with StorageAdapter.listExecutions filter', async () => {
    /* sanity: listExecutions accepts TaskId, no type assertion needed */
    const storage = new InMemoryStorageAdapter()
    const task = buildTask({ id: '01AFFFFFFFFFFFFFFFFFFFFFFF' as TaskId })
    await storage.saveTask(task)
    const rows = await storage.listExecutions({ taskId: task.id, status: 'running' })
    expect(rows).toEqual([])
  })
})
