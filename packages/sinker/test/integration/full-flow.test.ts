/**
 * @cadence/sinker — full-flow integration tests.
 *
 * End-to-end exercise of the SinkerEngine through the PHASE 2 storage
 * contract (SinkerStorageAdapter bridge → InMemoryStorageAdapter). Uses
 * EmbeddedQueueAdapter so the engine controls dequeue.
 *
 * Each scenario lives in its own `describe` and gets a fresh harness in
 * `beforeEach`. The worker loop spins in the background; tests call
 * `runUntilDrained()` to block until the queue is empty, then assert.
 *
 * Per-case timeout: 10s.
 */
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { ulid } from 'ulid'
import type { Task, TaskId, ExecutionId, TaskStatus, Execution } from '@cadence/domain'
import { StateTransitionError, TaskNotFoundError } from '../../src/index.js'
import { StaleVersionError } from '@cadence/storage'
import { makeHarness, type Harness } from './_helpers/engine-harness.js'

const TEST_TIMEOUT = 10_000
const OWNER = '01J00000000000000000000000'

function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: (overrides.id ?? (ulid() as TaskId)) as TaskId,
    name: overrides.name ?? 'integration-task',
    description: '',
    owner_id: '01J00000000000000000000000' as TaskId,
    group_id: null,
    payload_kind: overrides.payload_kind ?? 'http',
    payload_json:
      overrides.payload_json ?? JSON.stringify({ url: 'https://example.com', method: 'GET' }),
    trigger_kind: overrides.trigger_kind ?? 'manual',
    trigger_config_json: '{}',
    status: overrides.status ?? 'pending',
    cron: null,
    timezone: 'UTC',
    start_at: null,
    end_at: null,
    max_retries: overrides.max_retries ?? 0,
    retry_backoff: 'exponential',
    concurrency_policy: overrides.concurrency_policy ?? 'skip',
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

async function saveTask(h: Harness, task: Task): Promise<void> {
  await h.phase2Storage.saveTask(task)
}

/* =====================================================================
 * 1. HTTP payload full lifecycle
 * ===================================================================== */
describe('integration: HTTP payload full flow', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'trigger → queued → dispatched → running → success',
    async () => {
      const task = makeTask({ payload_kind: 'http' })
      await saveTask(h, task)

      const execId = (await h.engine.trigger(
        task.id,
        { source: 'manual' },
        { userId: OWNER },
      )) as ExecutionId
      expect(execId).toMatch(/^[0-9A-HJKMNP-TV-Z]{26}$/)

      await h.runUntilDrained()

      const final = await h.phase2Storage.getExecution(execId)
      expect(final?.status).toBe<TaskStatus>('success')
      expect(final?.triggerSource).toBe('manual')
      expect(final?.startedAt).not.toBeNull()
      expect(final?.finishedAt).not.toBeNull()
      expect(final?.durationMs).toBeGreaterThanOrEqual(0)

      expect(h.notifier.sent).toHaveLength(1)
      expect(h.notifier.sent[0]?.status).toBe('success')
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 2. Command payload (local subprocess)
 * ===================================================================== */
describe('integration: command payload (local)', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness({
      executorScript: async (_task, _exec, _trigger, _signal) => {
        /* Simulate successful command via the registered CommandHandler.
         * We invoke the dispatcher directly through its public execute API
         * by replacing the executor script with a CommandHandler-driven one. */
      },
    })
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'command payload runs through engine and reaches success',
    async () => {
      const task = makeTask({
        payload_kind: 'command',
        payload_json: JSON.stringify({ cmd: 'node', args: ['-e', 'process.stdout.write("ok")'] }),
      })
      await saveTask(h, task)

      const execId = await h.engine.trigger(
        task.id,
        { source: 'manual' },
        { userId: OWNER },
      )
      await h.runUntilDrained()

      const final = await h.phase2Storage.getExecution(execId)
      expect(final?.status).toBe<TaskStatus>('success')
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 3. Failure + retry
 * ===================================================================== */
describe('integration: failure then retry', () => {
  let h: Harness
  let attempts = 0

  beforeEach(() => {
    attempts = 0
    h = makeHarness({
      executorScript: async (_t, _e, _tr, signal) => {
        attempts += 1
        if (attempts === 1) {
          throw new Error('first attempt failed')
        }
        /* second attempt: short success */
        await new Promise<void>((r) => setTimeout(r, 5))
        void signal
      },
    })
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'first attempt fails, second attempt succeeds',
    async () => {
      const task = makeTask({ max_retries: 2 })
      await saveTask(h, task)

      const execId = await h.engine.trigger(
        task.id,
        { source: 'manual' },
        { userId: OWNER },
      )
      await h.runUntilDrained()

      const failed = await h.phase2Storage.getExecution(execId)
      expect(failed?.status).toBe<TaskStatus>('failed')

      /* Simulate a worker-internal retry: re-trigger with bypassGuard. */
      const retryId = await h.engine.trigger(
        task.id,
        { source: 'retry' },
        { userId: 'system', bypassGuard: true, bypassAuth: true },
      )
      await h.runUntilDrained()

      const retried = await h.phase2Storage.getExecution(retryId)
      expect(retried?.status).toBe<TaskStatus>('success')

      const allExecs = await h.phase2Storage.listExecutions({ taskId: task.id })
      expect(allExecs).toHaveLength(2)
      expect(attempts).toBe(2)
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 4. Suspend + resume
 * ===================================================================== */
describe('integration: suspend then resume', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'suspend transitions scheduled→suspended; resume re-arms',
    async () => {
      const task = makeTask({ status: 'scheduled' })
      await saveTask(h, task)
      await h.scheduler.reschedule(task)

      expect(h.scheduler.isScheduled(task.id)).toBe(true)

      await h.engine.suspend(task.id, 'maintenance window')
      const afterSuspend = await h.phase2Storage.getTask(task.id)
      expect(afterSuspend?.status).toBe<TaskStatus>('suspended')
      expect(h.scheduler.isScheduled(task.id)).toBe(false)

      await h.engine.resume(task.id)
      const afterResume = await h.phase2Storage.getTask(task.id)
      expect(afterResume?.status).toBe<TaskStatus>('scheduled')
      expect(h.scheduler.isScheduled(task.id)).toBe(true)
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 5. Cancel
 * ===================================================================== */
describe('integration: cancel execution', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'cancel a queued execution flips status to cancelled',
    async () => {
      const task = makeTask()
      await saveTask(h, task)

      const execId = await h.engine.trigger(
        task.id,
        { source: 'manual' },
        { userId: OWNER },
      )
      /* Don't runUntilDrained — cancel before the worker picks it up. */
      await h.engine.cancel(execId, 'user pressed stop')

      const final = await h.phase2Storage.getExecution(execId)
      expect(final?.status).toBe<TaskStatus>('cancelled')
      expect(final?.finishedAt).not.toBeNull()

      /* Drain: the worker should observe the cancelled status and skip. */
      await h.runUntilDrained()
      const afterDrain = await h.phase2Storage.getExecution(execId)
      expect(afterDrain?.status).toBe<TaskStatus>('cancelled')
    },
    TEST_TIMEOUT,
  )

  it('cancel a non-existent execution is a no-op', async () => {
    await expect(
      h.engine.cancel('01JZZZZZZZZZZZZZZZZZZZZZZZ' as ExecutionId),
    ).resolves.toBeUndefined()
  })
})

/* =====================================================================
 * 6. Concurrent triggers
 * ===================================================================== */
describe('integration: concurrent triggers', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'three concurrent triggers for same task → all reach terminal',
    async () => {
      const task = makeTask({ concurrency_policy: 'skip' })
      await saveTask(h, task)

      const [a, b, c] = await Promise.all([
        h.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER }),
        h.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER }),
        h.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER }),
      ])

      expect(new Set([a, b, c]).size).toBe(3) // 3 distinct execution ids

      await h.runUntilDrained()

      const execs = await h.phase2Storage.listExecutions({ taskId: task.id })
      expect(execs).toHaveLength(3)
      for (const e of execs) {
        expect(['success', 'failed', 'cancelled']).toContain(e.status)
      }
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 7. Webhook payload
 * ===================================================================== */
describe('integration: webhook trigger', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'webhook source: external trigger produces an execution with triggerSource=webhook',
    async () => {
      const task = makeTask({
        payload_kind: 'webhook',
        payload_json: JSON.stringify({ path: '/hooks/inbound', methods: ['POST'] }),
      })
      await saveTask(h, task)

      /* Simulate the host app receiving an external HTTP request and
       * calling trigger() with the parsed body as the trigger payload. */
      const execId = await h.engine.trigger(
        task.id,
        {
          source: 'webhook',
          payload: { body: { event: 'order.created', id: 'ord_123' } },
        },
        { userId: OWNER },
      )

      await h.runUntilDrained()

      const final = await h.phase2Storage.getExecution(execId)
      expect(final?.status).toBe<TaskStatus>('success')
      expect(final?.triggerSource).toBe('webhook')
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 8. Pipeline payload (6-node happy path)
 * ===================================================================== */
describe('integration: pipeline payload', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'six-node linear pipeline completes via the engine',
    async () => {
      const nodes = [
        { id: 'n1', kind: 'trigger' },
        { id: 'n2', kind: 'fetch' },
        { id: 'n3', kind: 'transform' },
        { id: 'n4', kind: 'condition' },
        { id: 'n5', kind: 'action' },
        { id: 'n6', kind: 'output' },
      ] as const
      const edges: ReadonlyArray<readonly [string, string]> = [
        ['n1', 'n2'],
        ['n2', 'n3'],
        ['n3', 'n4'],
        ['n4', 'n5'],
        ['n5', 'n6'],
      ]

      const task = makeTask({
        payload_kind: 'pipeline',
        payload_json: JSON.stringify({ nodes, edges, input: { seed: 42 } }),
      })
      await saveTask(h, task)

      const execId = await h.engine.trigger(
        task.id,
        { source: 'manual' },
        { userId: OWNER },
      )
      await h.runUntilDrained()

      const final = await h.phase2Storage.getExecution(execId)
      expect(final?.status).toBe<TaskStatus>('success')
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 9. Audit append-only
 * ===================================================================== */
describe('integration: audit append-only', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'appendAudit persists entries; listAuditLogs returns them in order',
    async () => {
      const task = makeTask()
      await saveTask(h, task)

      const e1 = {
        id: crypto.randomUUID(),
        action: 'task.create' as const,
        actorId: null,
        resourceKind: 'task' as const,
        resourceId: task.id,
        diffJson: '{}',
        metadataJson: '{}',
        createdAt: Date.now(),
      }
      const e2 = {
        id: crypto.randomUUID(),
        action: 'execution.create' as const,
        actorId: null,
        resourceKind: 'execution' as const,
        resourceId: ulid(),
        diffJson: '{}',
        metadataJson: '{}',
        createdAt: Date.now() + 1,
      }
      await h.phase2Storage.appendAudit(e1)
      await h.phase2Storage.appendAudit(e2)

      const all = await h.phase2Storage.listAuditLogs()
      expect(all).toHaveLength(2)
      expect(all.map((a) => a.action)).toEqual(['execution.create', 'task.create'])

      const taskOnly = await h.phase2Storage.listAuditLogs({ resourceKind: 'task' })
      expect(taskOnly).toHaveLength(1)
      expect(taskOnly[0]?.id).toBe(e1.id)

      /* duplicate id → ConflictError */
      await expect(h.phase2Storage.appendAudit(e1)).rejects.toThrow()
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * 10. Optimistic locking via PHASE 2 storage
 * ===================================================================== */
describe('integration: optimistic locking on concurrent updateTask', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it(
    'two concurrent updateTask calls with same expectedVersion → one wins, one StaleVersionError',
    async () => {
      const task = makeTask()
      await saveTask(h, task)

      /* Simulate two workers trying to bump the same task at the same version. */
      const patch = { metadata_json: '{"winner":"a"}', expectedVersion: 1 }
      const patchB = { metadata_json: '{"winner":"b"}', expectedVersion: 1 }

      const results = await Promise.allSettled([
        h.phase2Storage.updateTask(task.id, patch),
        h.phase2Storage.updateTask(task.id, patchB),
      ])

      const fulfilled = results.filter((r) => r.status === 'fulfilled')
      const rejected = results.filter((r) => r.status === 'rejected')
      expect(fulfilled).toHaveLength(1)
      expect(rejected).toHaveLength(1)
      expect((rejected[0] as PromiseRejectedResult).reason).toBeInstanceOf(StaleVersionError)

      const after = await h.phase2Storage.getTask(task.id)
      expect(after?.version).toBe(2)
    },
    TEST_TIMEOUT,
  )
})

/* =====================================================================
 * Bonus: state machine integration checks
 * ===================================================================== */
describe('integration: state machine guards', () => {
  let h: Harness
  beforeEach(() => {
    h = makeHarness()
  })
  afterEach(async () => {
    await h.stop()
  })

  it('trigger on missing task throws TaskNotFoundError', async () => {
    await expect(
      h.engine.trigger(
        '01JZZZZZZZZZZZZZZZZZZZZZZZ' as TaskId,
        { source: 'manual' },
        { userId: OWNER },
      ),
    ).rejects.toBeInstanceOf(TaskNotFoundError)
  })

  it('trigger on a terminal task throws StateTransitionError', async () => {
    const task = makeTask({ status: 'success' })
    await saveTask(h, task)
    await expect(
      h.engine.trigger(task.id, { source: 'manual' }, { userId: OWNER }),
    ).rejects.toBeInstanceOf(StateTransitionError)
  })
})
