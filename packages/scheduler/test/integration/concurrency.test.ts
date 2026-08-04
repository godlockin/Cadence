/**
 * @cadence/scheduler — Task.concurrency_policy integration tests.
 */
import { beforeEach, describe, expect, it } from 'vitest'
import type { Execution, ExecutionId, TaskId } from '@cadence/domain'
import { InMemoryStorageAdapter } from '@cadence/storage'
import { triggerTask, type TriggerFn } from '../../src/index.js'
import { FakeSinker } from '../fakes.js'
import { buildTask, persistTask } from '../helpers.js'

/** Helper: persist a fake "running" execution for a task. */
async function persistRunningExecution(
  storage: InMemoryStorageAdapter,
  taskId: TaskId,
): Promise<Execution> {
  const eid = ('01HZZZRUN0000000000000' + Date.now().toString(16).slice(-6)) as ExecutionId
  const exec: Execution = {
    id: eid,
    taskId,
    status: 'running',
    triggerSource: 'manual',
    triggeredBy: null,
    startedAt: Date.now(),
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    version: 1,
    createdAt: Date.now(),
    updatedAt: Date.now(),
  }
  await storage.createExecution(exec)
  return exec
}

describe('Task.concurrency_policy (e2e)', () => {
  let storage: InMemoryStorageAdapter
  let sinker: FakeSinker
  let triggerFn: TriggerFn

  beforeEach(() => {
    storage = new InMemoryStorageAdapter()
    sinker = new FakeSinker()
    triggerFn = sinker.asTriggerFn()
  })

  it("policy='skip' → second trigger while one is running is skipped", async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'manual', concurrency_policy: 'skip' }),
    )
    /* Inject one running execution. */
    await persistRunningExecution(storage, task.id)

    const out = await triggerTask(
      storage,
      triggerFn,
      task.id,
      { source: 'manual', triggeredBy: 'system' },
      'system',
    )
    expect(out.reason).toBe('skipped_concurrency')
    expect(out.activeCount).toBe(1)
    expect(sinker.countFor(task.id)).toBe(0)

    /* Audit log records `task.concurrency_skipped`. */
    const audit = await storage.listAuditLogs({ resourceKind: 'task' })
    const skipped = audit.filter((a) => a.action === 'task.concurrency_skipped')
    expect(skipped.length).toBeGreaterThan(0)
  })

  it("policy='parallel' → both triggers fire (no skip)", async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'manual', concurrency_policy: 'parallel' }),
    )
    await persistRunningExecution(storage, task.id)

    const out1 = await triggerTask(
      storage,
      triggerFn,
      task.id,
      { source: 'manual', triggeredBy: 'system' },
      'system',
    )
    const out2 = await triggerTask(
      storage,
      triggerFn,
      task.id,
      { source: 'manual', triggeredBy: 'system' },
      'system',
    )
    expect(out1.reason).toBe('fired')
    expect(out2.reason).toBe('fired')
    expect(sinker.countFor(task.id)).toBe(2)
  })

  it("policy='queue' → second trigger still fires (downstream queues)", async () => {
    /* The scheduler's responsibility is per-policy semantics:
     * - skip:     don't enqueue (skip→outcome=skipped_concurrency)
     * - parallel: enqueue anyway
     * - queue:    enqueue anyway, rely on queue for back-pressure
     * - kill_old: enqueue, abort in-flight (engine layer)
     *
     * For the scheduler, all of the latter three behave the same way:
     * they pass through to the triggerFn. */
    for (const policy of ['queue', 'parallel', 'kill_old'] as const) {
      sinker.reset()
      const localStorage = new InMemoryStorageAdapter()
      const task = await persistTask(
        localStorage,
        buildTask({ trigger_kind: 'manual', concurrency_policy: policy }),
      )
      await persistRunningExecution(localStorage, task.id)

      const out = await triggerTask(
        localStorage,
        sinker.asTriggerFn(),
        task.id,
        { source: 'manual', triggeredBy: 'system' },
        'system',
      )
      expect(out.reason).toBe('fired')
    }
  })

  it("policy='skip' fires cleanly when NO execution is running", async () => {
    const task = await persistTask(
      storage,
      buildTask({ trigger_kind: 'manual', concurrency_policy: 'skip' }),
    )
    const out = await triggerTask(
      storage,
      triggerFn,
      task.id,
      { source: 'manual', triggeredBy: 'system' },
      'system',
    )
    expect(out.reason).toBe('fired')
    expect(sinker.countFor(task.id)).toBe(1)
  })
})
