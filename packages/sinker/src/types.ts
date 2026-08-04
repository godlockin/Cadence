/**
 * @cadence/sinker — public types & ports.
 * PHASE 1: contracts for the engine, queue, executors, scheduler, and notifier.
 *
 * NOTE: `QueueAdapter`, `QueueItem`, `TriggerContext`, `TriggerSource` were
 * extracted to @cadence/domain (see `packages/domain/src/queue.ts`) to
 * break the sinker↔queue package cycle. We re-export them here for backward
 * compatibility, but @cadence/domain is the new home.
 */
import type {
  Execution,
  Task,
  TaskId,
  ExecutionId,
  PayloadKind,
  TriggerContext,
} from '@cadence/domain'

/* ---------------- Trigger / Queue re-exports (moved to @cadence/domain) ----------------
 * @deprecated import from '@cadence/domain' instead. These re-exports are kept
 * so existing consumers of @cadence/sinker continue to work during migration.
 */
export type { QueueAdapter, QueueItem, TriggerContext, TriggerSource } from '@cadence/domain'
export { TriggerSourceSchema } from '@cadence/domain'

/* ---------------- Storage (sinker-flavoured view) ---------------- */

/**
 * Subset of the storage surface sinker needs.
 * The real @cadence/storage implementation will conform to this in PHASE 2.
 */
export interface StorageAdapter {
  getTask(id: TaskId): Promise<Task | null>
  createExecution(input: NewExecutionInput): Promise<Execution>
  patchExecution(
    id: ExecutionId,
    patch: ExecutionStatusPatch,
    expectedVersion: number,
  ): Promise<Execution>
  getExecution(id: ExecutionId): Promise<Execution | null>
  patchTask(id: TaskId, patch: TaskStatusPatch, expectedVersion: number): Promise<Task>
  listActiveExecutionsByTask(taskId: TaskId): Promise<Execution[]>
  /**
   * Membership check for IDOR guards. Implementations may return false
   * for unknown groups (fail-closed).
   */
  isGroupMember(groupId: string, userId: string): Promise<boolean>
}

export interface NewExecutionInput {
  readonly id: ExecutionId
  readonly taskId: TaskId
  readonly triggerSource: TriggerContext['source'] | 'retry'
  readonly triggeredBy?: string | null
  readonly retryCount: number
  readonly startedAt: number
  readonly metadata?: Readonly<Record<string, unknown>>
}

export interface ExecutionStatusPatch {
  readonly status: Task['status']
  readonly startedAt?: number | null
  readonly finishedAt?: number | null
  readonly durationMs?: number | null
  readonly errorJson?: string | null
  readonly resultJson?: string | null
  readonly retryCount?: number
}

export interface TaskStatusPatch {
  readonly status: Task['status']
  readonly metadata?: string
}

/* ---------------- Executor / Dispatch events ---------------- */

export type DispatchEventType = 'started' | 'progress' | 'log' | 'result' | 'error' | 'finished'

export interface DispatchEvent {
  readonly type: DispatchEventType
  readonly nodeId?: string
  readonly data?: unknown
  readonly ts: number
}

export interface ExecutorContext {
  readonly task: Task
  readonly execution: Execution
  readonly trigger: TriggerContext
  readonly signal: AbortSignal
  readonly emit: (event: DispatchEvent) => void
}

export interface PayloadHandler<TConfig = unknown> {
  readonly kind: PayloadKind
  /**
   * Validate the parsed payload configuration. Throw on invalid config.
   * Called once per execution; should be cheap.
   */
  validateConfig(raw: unknown): TConfig
  /**
   * Execute the payload. Implementations yield events through the supplied
   * context. Returning early via the AbortSignal MUST be honoured.
   */
  execute(config: TConfig, ctx: ExecutorContext): Promise<void>
}

export interface ExecutorAdapter {
  execute(
    task: Task,
    execution: Execution,
    trigger: TriggerContext,
    signal: AbortSignal,
  ): Promise<void>
}

/* ---------------- Scheduler / Notifier ports ---------------- */

export interface SchedulerAdapter {
  /** re-schedule the next firing of a task. */
  reschedule(task: Task): Promise<void>
  /** remove any scheduled firing for a task. */
  unschedule(taskId: TaskId): Promise<void>
  /** is the task currently scheduled to fire? */
  hasSchedule(taskId: TaskId): Promise<boolean>
}

export interface NotifierAdapter {
  notify(payload: NotifyPayload): Promise<void>
}

export interface NotifyPayload {
  readonly taskId: TaskId
  readonly executionId: ExecutionId
  readonly status: Task['status']
  readonly error?: string
  readonly result?: unknown
  readonly ts: number
}

/* ---------------- Structured logger ---------------- */

export type LogLevel = 'debug' | 'info' | 'warn' | 'error'

export interface Logger {
  debug(event: string, data?: Record<string, unknown>): void
  info(event: string, data?: Record<string, unknown>): void
  warn(event: string, data?: Record<string, unknown>): void
  error(event: string, data?: Record<string, unknown>): void
  child(scope: string): Logger
}

/* ---------------- Errors (declared here, re-exported from ./errors.js) ----------------
 * The single source of truth for security errors is `./errors.js`. We re-export
 * the type-only `ForbiddenError` from errors here ONLY for files that still
 * import it from `./types.js`. New code should import from `./errors.js`
 * (or from the package root) directly.
 *
 * NOTE: previously two `ForbiddenError` classes existed (one here, one in
 * ./errors.js). The one here has been removed to avoid double-definition;
 * callers should now use the version from `./errors.js`.
 */
export { ForbiddenError } from './errors.js'

export class StateTransitionError extends Error {
  constructor(
    public readonly fromState: Task['status'],
    public readonly eventName: string,
    message?: string,
  ) {
    super(message ?? `Illegal state transition: ${fromState} cannot accept event '${eventName}'`)
    this.name = 'StateTransitionError'
  }
}

export class TaskNotFoundError extends Error {
  constructor(public readonly taskId: TaskId) {
    super(`Task not found: ${taskId}`)
    this.name = 'TaskNotFoundError'
  }
}

export class HandlerNotFoundError extends Error {
  constructor(public readonly payloadKind: PayloadKind) {
    super(`No handler registered for payload kind: ${payloadKind}`)
    this.name = 'HandlerNotFoundError'
  }
}

export class PayloadValidationError extends Error {
  constructor(
    public readonly payloadKind: PayloadKind,
    public readonly causeValue: unknown,
  ) {
    super(
      `Payload validation failed for ${payloadKind}: ${
        causeValue instanceof Error ? causeValue.message : String(causeValue)
      }`,
    )
    this.name = 'PayloadValidationError'
  }
}
