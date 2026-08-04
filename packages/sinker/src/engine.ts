/**
 * @cadence/sinker — SinkerEngine.
 *
 * The single point of orchestration. Owns the task lifecycle (state machine),
 * the queue handoff, the worker loop, and the executor dispatch.
 *
 * Design rules:
 *   - trigger() is non-blocking: it persists an Execution row, enqueues,
 *     and returns. The worker loop does the actual execution.
 *   - State transitions are validated through state-machine.ts. The engine
 *     only writes the *target* state; it never re-derives a transition
 *     inside a single method (idempotency = retry-safety).
 *   - cancel() is best-effort: it marks the AbortSignal aborted; the
 *     running handler decides how to stop. The state transition is only
 *     committed after the worker observes the signal and writes back.
 */
import { ulid } from 'ulid'
import type { Execution, Task, TaskId, ExecutionId, TaskStatus } from '@cadence/domain'
import type { QueueAdapter, QueueItem, TriggerContext } from '@cadence/domain'
import { ForbiddenError } from './errors.js'
import type {
  ExecutorAdapter,
  Logger,
  NotifierAdapter,
  SchedulerAdapter,
  StorageAdapter,
} from './types.js'
import { TaskNotFoundError, StateTransitionError } from './types.js'
import { nextState, isTerminal } from './state-machine.js'
import type { PayloadDispatcher } from './dispatcher.js'

export interface SinkerDeps {
  readonly storage: StorageAdapter
  readonly queue: QueueAdapter
  readonly executor: ExecutorAdapter
  readonly scheduler: SchedulerAdapter
  readonly notifier: NotifierAdapter
  readonly logger: Logger
  readonly dispatcher: PayloadDispatcher
  /** runtime: 'local' (Node) or 'cloudflare'. Defaults to auto-detect. */
  readonly runtime?: Runtime
}

export type Runtime = 'local' | 'cloudflare'

function detectRuntime(): Runtime {
  if (
    typeof globalThis !== 'undefined' &&
    (globalThis as { WebSocketPair?: unknown }).WebSocketPair !== undefined
  ) {
    return 'cloudflare'
  }
  return 'local'
}

export interface TriggerOptions {
  /**
   * REQUIRED: identifies the actor that wants to trigger the task.
   * Used by the IDOR guard (assertCanTrigger). System triggers (cron,
   * webhooks fired by the platform itself) MUST set `bypassGuard: true`.
   */
  readonly userId: string
  readonly now?: number
  /** Bypass state-machine validation. Use ONLY for retries from inside the worker. */
  readonly bypassGuard?: boolean
  /** Bypass IDOR/owner guard. System-only (cron, internal webhook fan-out). */
  readonly bypassAuth?: boolean
}

export interface EngineStatus {
  readonly task: Task
  readonly active: readonly Execution[]
  readonly scheduled: boolean
}

export class SinkerEngine {
  private readonly logger: Logger
  private readonly runtime: Runtime

  constructor(private readonly deps: SinkerDeps) {
    this.logger = deps.logger.child('engine')
    this.runtime = deps.runtime ?? detectRuntime()
  }

  /* ------------------------------------------------------------- */
  /*  Public API                                                   */
  /* ------------------------------------------------------------- */

  /**
   * Trigger a task. Non-blocking. Returns the new ExecutionId immediately
   * after the row is persisted and the queue item is enqueued.
   *
   * Throws ForbiddenError if the userId is not the task owner, a member
   * of the task's group, or a system actor (bypassAuth).
   */
  async trigger(taskId: TaskId, ctx: TriggerContext, opts: TriggerOptions): Promise<ExecutionId> {
    if (typeof opts.userId !== 'string' || opts.userId.length === 0) {
      throw new TypeError('trigger(): opts.userId is required')
    }
    const task = await this.deps.storage.getTask(taskId)
    if (!task) throw new TaskNotFoundError(taskId)

    if (!opts.bypassGuard) {
      this.assertCanTrigger(task)
    }
    if (!opts.bypassAuth) {
      await this.assertCanTriggerAuth(task, opts.userId)
    }

    const now = opts.now ?? Date.now()
    const executionId = ulid() as ExecutionId

    await this.deps.storage.createExecution({
      id: executionId,
      taskId,
      triggerSource: ctx.source,
      triggeredBy: opts.userId,
      retryCount: 0,
      startedAt: now,
      metadata: ctx.payload,
    })

    const item: QueueItem = {
      taskId,
      executionId,
      context: ctx,
      enqueuedAt: now,
    }
    await this.deps.queue.enqueue(item)

    this.logger.info('trigger.enqueued', {
      taskId,
      executionId,
      source: ctx.source,
      queueSize: await this.deps.queue.size(),
    })

    return executionId
  }

  /**
   * Suspend a task. Currently running executions are allowed to finish;
   * future triggers will be rejected until resume().
   */
  async suspend(taskId: TaskId, reason: string): Promise<void> {
    const task = await this.deps.storage.getTask(taskId)
    if (!task) throw new TaskNotFoundError(taskId)

    const target = nextState(task.status, 'suspend')
    const updated = await this.deps.storage.patchTask(
      taskId,
      { status: target, metadata: JSON.stringify({ suspendReason: reason, at: Date.now() }) },
      task.version,
    )

    await this.deps.scheduler.unschedule(taskId)
    this.logger.info('task.suspended', { taskId, from: task.status, to: updated.status, reason })
  }

  /**
   * Resume a suspended task. Re-arms the schedule and triggers one manual
   * firing immediately (matching the user's "resume" semantics).
   */
  async resume(taskId: TaskId): Promise<ExecutionId | null> {
    const task = await this.deps.storage.getTask(taskId)
    if (!task) throw new TaskNotFoundError(taskId)

    const target = nextState(task.status, 'resume')
    const updated = await this.deps.storage.patchTask(taskId, { status: target }, task.version)

    await this.deps.scheduler.reschedule(updated)

    this.logger.info('task.resumed', { taskId, from: task.status, to: updated.status })
    return null
  }

  /**
   * Cancel a single execution. Marks the AbortController for that
   * execution (if any) and writes the cancellation into the row.
   * Idempotent: cancelling an already-terminal execution is a no-op.
   */
  async cancel(executionId: ExecutionId, reason = 'cancelled by user'): Promise<void> {
    const execution = await this.deps.storage.getExecution(executionId)
    if (!execution) {
      this.logger.warn('cancel.unknown_execution', { executionId })
      return
    }
    if (isTerminal(execution.status)) {
      this.logger.info('cancel.noop_terminal', { executionId, status: execution.status })
      return
    }

    /* Abort in-flight work if we own the AbortController. */
    this.abortExecution(executionId)

    try {
      const target = nextState(execution.status, 'cancel')
      await this.deps.storage.patchExecution(
        executionId,
        {
          status: target,
          finishedAt: Date.now(),
          errorJson: JSON.stringify({ message: reason }),
        },
        execution.version,
      )
      this.logger.info('execution.cancelled', { executionId, reason })
    } catch (err) {
      if (err instanceof StateTransitionError) {
        /* The worker already finalised; that's fine, swallow. */
        this.logger.info('cancel.worker_finalised', { executionId })
        return
      }
      throw err
    }
  }

  /**
   * Read the current status of a task, including any active executions.
   */
  async status(taskId: TaskId): Promise<EngineStatus> {
    const task = await this.deps.storage.getTask(taskId)
    if (!task) throw new TaskNotFoundError(taskId)
    const active = await this.deps.storage.listActiveExecutionsByTask(taskId)
    const scheduled = await this.deps.scheduler.hasSchedule(taskId)
    return { task, active, scheduled }
  }

  /* ------------------------------------------------------------- */
  /*  Worker loop                                                  */
  /* ------------------------------------------------------------- */

  /**
   * Polling worker. Pulls one queue item, drives it through dispatched ->
   * running -> terminal, and writes back the final status. Aborts cleanly
   * when `signal` is triggered.
   */
  async workerLoop(workerId: string, signal: AbortSignal): Promise<void> {
    const log = this.logger.child(`worker.${workerId}`)
    log.info('worker.start', { runtime: this.runtime })

    while (!signal.aborted) {
      const item = await this.deps.queue.dequeue()
      if (!item) {
        /* idle backoff */
        await sleep(50, signal)
        continue
      }

      try {
        await this.runOne(item, signal)
      } catch (err: unknown) {
        const message = err instanceof Error ? err.message : String(err)
        log.error('worker.item_failed', { executionId: item.executionId, error: message })
        await this.recordTerminal(item, 'failed', { message })
      }
    }

    log.info('worker.stop')
  }

  /* ------------------------------------------------------------- */
  /*  Internals                                                    */
  /* ------------------------------------------------------------- */

  private async runOne(item: QueueItem, parentSignal: AbortSignal): Promise<void> {
    const log = this.logger.child(`exec.${item.executionId}`)

    const execution = await this.deps.storage.getExecution(item.executionId)
    if (!execution) {
      log.warn('runOne.missing_execution', { executionId: item.executionId })
      return
    }
    if (isTerminal(execution.status)) {
      log.info('runOne.skip_terminal', { status: execution.status })
      return
    }

    /* queued -> dispatched -> running */
    await this.transitionExecution(execution, 'dispatch')
    const dispatched = await this.deps.storage.getExecution(item.executionId)
    if (!dispatched) return
    await this.transitionExecution(dispatched, 'start')
    const running = await this.deps.storage.getExecution(item.executionId)
    if (!running) return

    const task = await this.deps.storage.getTask(item.taskId)
    if (!task) {
      await this.recordTerminal(item, 'failed', { message: `Task disappeared: ${item.taskId}` })
      return
    }

    const controller = new AbortController()
    this.activeControllers.set(item.executionId, controller)
    const onParentAbort = () => controller.abort(parentSignal.reason)
    parentSignal.addEventListener('abort', onParentAbort, { once: true })

    try {
      await this.deps.executor.execute(task, running, item.context, controller.signal)
      await this.recordTerminal(item, 'success')
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      const aborted = controller.signal.aborted
      const target: TaskStatus = aborted ? 'cancelled' : 'failed'
      log.info('runOne.error', { aborted, message, target })
      await this.recordTerminal(item, target, { message, aborted })
    } finally {
      parentSignal.removeEventListener('abort', onParentAbort)
      this.activeControllers.delete(item.executionId)
    }
  }

  private async transitionExecution(
    execution: Execution,
    event: 'dispatch' | 'start',
  ): Promise<void> {
    /* These are the two intermediate steps the engine performs. The state
     * machine guarantees the from-state, so we apply it unconditionally. */
    const map: Record<typeof event, TaskStatus> = {
      dispatch: 'dispatched',
      start: 'running',
    }
    const target = map[event]
    await this.deps.storage.patchExecution(
      execution.id,
      event === 'start' ? { status: target, startedAt: Date.now() } : { status: target },
      execution.version,
    )
  }

  private async recordTerminal(
    item: QueueItem,
    target: Extract<TaskStatus, 'success' | 'failed' | 'cancelled'>,
    error?: { message: string; aborted?: boolean },
  ): Promise<void> {
    const execution = await this.deps.storage.getExecution(item.executionId)
    if (!execution) return
    const finishedAt = Date.now()
    const durationMs = execution.startedAt ? finishedAt - execution.startedAt : null
    await this.deps.storage.patchExecution(
      item.executionId,
      {
        status: target,
        finishedAt,
        durationMs,
        errorJson: error ? JSON.stringify(error) : null,
        resultJson: target === 'success' ? (execution.resultJson ?? null) : null,
      },
      execution.version,
    )
    await this.deps.notifier.notify({
      taskId: item.taskId,
      executionId: item.executionId,
      status: target,
      error: error?.message,
      ts: finishedAt,
    })
  }

  private assertCanTrigger(task: Task): void {
    /* The state machine would throw; we pre-check to give a clearer error. */
    const allowed: readonly TaskStatus[] = ['pending', 'scheduled', 'suspended']
    if (!allowed.includes(task.status)) {
      throw new StateTransitionError(
        task.status,
        'enqueue',
        `Task ${task.id} cannot be triggered in status '${task.status}'`,
      )
    }
  }

  private async assertCanTriggerAuth(task: Task, userId: string): Promise<void> {
    /* Owner check. We compare the userId (string) against the stored
     * owner_id. The task schema uses TaskId (ULID) for owner_id; we do
     * a plain string compare because both sides are coerced to string
     * at the trigger boundary. */
    if (String(task.owner_id) === userId) return

    if (task.group_id !== null && task.group_id !== undefined) {
      const isMember = await this.deps.storage.isGroupMember(String(task.group_id), userId)
      if (isMember) return
    }

    this.logger.warn('trigger.forbidden', {
      taskId: task.id,
      userId,
      ownerId: task.owner_id,
      groupId: task.group_id,
    })
    throw new ForbiddenError(userId, task.id)
  }

  private readonly activeControllers = new Map<ExecutionId, AbortController>()

  private abortExecution(executionId: ExecutionId): void {
    const c = this.activeControllers.get(executionId)
    if (c) c.abort('cancelled')
  }
}

function sleep(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise<void>((resolve) => {
    if (signal.aborted) return resolve()
    const id = setTimeout(resolve, ms)
    const onAbort = () => {
      clearTimeout(id)
      resolve()
    }
    signal.addEventListener('abort', onAbort, { once: true })
  })
}
