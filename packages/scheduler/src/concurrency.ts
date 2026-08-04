/**
 * @cadence/scheduler — concurrency policy.
 *
 * Decide whether a *new* firing of `task` should be allowed to enqueue,
 * skipped, or queued-then-waited. Caller (the trigger function) reads the
 * decision and acts accordingly:
 *
 *   'allow'  → enqueue the new execution
 *   'skip'   → drop the trigger, record an audit row
 *   'wait'   → the caller SHOULD block until an active execution finishes;
 *               in production that means the request stalls on a Promise
 *               derived from the running execution. For the V1 scheduler we
 *               surface 'wait' as "enqueue anyway" because the queue layer
 *               already enforces FIFO.
 *
 * The four strategies per Task.concurrency_policy:
 *  - 'skip'      → if any active execution, skip
 *  - 'queue'     → if active, wait
 *  - 'parallel'  → always allow (multiple in-flight)
 *  - 'kill_old'  → cancel every active execution, then allow
 */
import type { ExecutionId, Task } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

export type ConcurrencyDecision = 'allow' | 'skip' | 'wait'

/**
 * Thrown when a task's `concurrency_policy` is 'kill_old' but the bound
 * StorageAdapter does not implement `cancelExecution`. Fail-closed by
 * design: silently allowing a new execution while old ones still run
 * defeats the point of the policy, so callers must surface this as a
 * misconfiguration rather than degrade.
 */
export class ConcurrencyError extends Error {
  constructor(message: string) {
    super(message)
    this.name = 'ConcurrencyError'
  }
}

export async function checkConcurrency(
  task: Task,
  storage: StorageAdapter,
): Promise<ConcurrencyDecision> {
  const active = await storage.listExecutions({ taskId: task.id, status: 'running' })
  if (active.length === 0) return 'allow'

  switch (task.concurrency_policy) {
    case 'skip':
      return 'skip'
    case 'queue':
      return 'wait'
    case 'parallel':
      return 'allow'
    case 'kill_old': {
      /* 'kill_old' is only well-defined when the storage can actually cancel
       * running executions. If it cannot, fail loudly instead of silently
       * allowing the new execution to stack on top of the stale ones. */
      if (!('cancelExecution' in storage)) {
        throw new ConcurrencyError(
          `concurrency_policy 'kill_old' is not supported: storage adapter ` +
            `does not implement cancelExecution (task ${String(task.id)})`,
        )
      }
      const cancellable = storage as unknown as {
        cancelExecution: (id: ExecutionId) => Promise<void>
      }
      for (const exec of active) {
        await cancellable.cancelExecution(exec.id)
      }
      return 'allow'
    }
    default:
      return 'skip' /* fail-safe default */
  }
}
