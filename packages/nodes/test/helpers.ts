/**
 * @cadence/nodes — test helpers.
 */
import type { Execution, Task, TriggerContext } from '@cadence/domain'
import type { NodeContext } from '../src/types.js'

export function makeExecution(overrides: Partial<Execution> = {}): Execution {
  const now = Date.now()
  return {
    id: '01JCCCCCCCCCCCCCCCCCCCCCCC',
    taskId: '01JBBBBBBBBBBBBBBBBBBBBBBB',
    status: 'running',
    triggerSource: 'manual',
    triggeredBy: null,
    startedAt: now,
    finishedAt: null,
    durationMs: null,
    retryCount: 0,
    errorJson: null,
    resultJson: null,
    idempotencyKey: null,
    version: 1,
    createdAt: now,
    updatedAt: now,
    ...overrides,
  }
}

export function makeTask(overrides: Partial<Task> = {}): Task {
  const now = Date.now()
  return {
    id: '01JAAAAAAAAAAAAAAAAAAAAAAA',
    name: 'test-task',
    description: '',
    owner_id: '01J00000000000000000000000',
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

export interface MakeContextOptions {
  readonly signal?: AbortSignal
  readonly trigger?: Partial<TriggerContext>
  readonly execution?: Partial<Execution>
}

export function makeContext(opts: MakeContextOptions = {}): {
  ctx: NodeContext
  events: { type: string; data?: unknown; ts: number }[]
} {
  const events: { type: string; data?: unknown; ts: number }[] = []
  const task = makeTask()
  const execution = makeExecution(opts.execution)
  const trigger: TriggerContext = { source: 'manual', ...opts.trigger }
  const ctx: NodeContext = {
    task,
    execution,
    trigger,
    signal: opts.signal ?? new AbortController().signal,
    emit: (e) => events.push({ type: e.type, data: e.data, ts: e.ts }),
  }
  return { ctx, events }
}

/** Last `result` event's data. */
export function lastResult(events: { type: string; data?: unknown }[]): unknown {
  const results = events.filter((e) => e.type === 'result')
  const last = results[results.length - 1]
  return last?.data
}

export function resultTypes(events: { type: string }[]): string[] {
  return events.filter((e) => e.type === 'result').map((e) => e.type)
}
