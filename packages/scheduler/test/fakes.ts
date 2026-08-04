/**
 * @cadence/scheduler — test fakes.
 *
 * `FakeSinker` is a stand-in for the real `SinkerEngine`. It records every
 * `trigger()` call so integration tests can verify the scheduler dispatched
 * the right tasks with the right context.
 *
 * It also implements the smallest possible surface to drive real `Execution`
 * lifecycle, including the `status`/`concurrency_policy` semantics.
 */
import { ulid } from 'ulid'
import type {
  ExecutionId,
  ExecutionTriggerSource,
  Task,
  TaskId,
  TaskStatus,
  TriggerContext,
} from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

import type { TriggerFn, TriggerOptions } from '../src/index.js'

export interface TriggerRecord {
  readonly taskId: TaskId
  readonly ctx: TriggerContext
  readonly opts: TriggerOptions
  readonly ts: number
  readonly executionId: ExecutionId
}

export class FakeSinker {
  readonly records: TriggerRecord[] = []
  readonly executionsById = new Map<ExecutionId, TaskId>()
  /** Counter for retries per task. */
  readonly failures: Map<string, number> = new Map()
  /** If set, the Nth trigger attempt for a task fails. Used by retry tests. */
  failAttemptsFor: Map<TaskId, number> | null = null

  /** Build a `TriggerFn` that captures calls + returns execution ids. */
  asTriggerFn(): TriggerFn {
    return async (
      taskId: TaskId,
      ctx: TriggerContext,
      opts: TriggerOptions,
    ): Promise<ExecutionId | null> => {
      const id = ulid() as ExecutionId
      this.records.push({ taskId, ctx, opts, ts: Date.now(), executionId: id })
      this.executionsById.set(id, taskId)
      return id
    }
  }

  /** A triggerFn that fails on attempt N for a given task. */
  flakyTriggerFn(tasksToTrack: readonly TaskId[]): TriggerFn {
    return async (
      taskId: TaskId,
      ctx: TriggerContext,
      opts: TriggerOptions,
    ): Promise<ExecutionId | null> => {
      if (!tasksToTrack.includes(taskId)) {
        // Always-succeed path for other tasks
        return this.asTriggerFn()(taskId, ctx, opts)
      }
      const attempt = (this.failures.get(taskId) ?? 0) + 1
      this.failures.set(taskId, attempt)
      // Always record (so we can count attempts) but throw on `failAttempts`
      const id = ulid() as ExecutionId
      this.records.push({ taskId, ctx, opts, ts: Date.now(), executionId: id })
      this.executionsById.set(id, taskId)
      if (this.failAttemptsFor?.get(taskId) === attempt) {
        throw new Error(`fake failure (attempt ${String(attempt)})`)
      }
      return id
    }
  }

  reset(): void {
    this.records.length = 0
    this.executionsById.clear()
    this.failures.clear()
    this.failAttemptsFor = null
  }

  /** Count of records for a given task. */
  countFor(taskId: TaskId): number {
    return this.records.filter((r) => r.taskId === taskId).length
  }
}
