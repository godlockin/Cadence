/**
 * @cadence/scheduler — ManualTrigger.
 *
 * The "human" fire path: an authenticated caller asks the engine to fire a
 * specific task right now. Authorisation happens OUTSIDE the scheduler via
 * `apps/api` (Hono RBAC middleware). ManualTrigger only validates the task
 * exists + is not terminal and forwards to the injected trigger function.
 *
 *   const mt = new ManualTrigger({ triggerFn })
 *   const eid = await mt.fire(storage, taskId, { userId, payload })
 *
 * The userId is forwarded as `triggeredBy` so audit/notification layers
 * can attribute the fire.
 */
import { randomUUID } from 'node:crypto'
import type {
  AuditAction,
  AuditLog,
  ExecutionId,
  Task,
  TaskId,
  TaskStatus,
  TriggerContext,
} from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

import type { TriggerFn } from './index.js'

/* Manually-triggered tasks run through the normal queue, so even a manual
 * click leaves an audit trail. The actor here is the real userId (not the
 * system actor). */
const MANUAL_AUDIT_ACTION: AuditAction = 'task.triggered_manually'

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['success', 'cancelled'])

export interface ManualTriggerOptions {
  readonly triggerFn: TriggerFn
}

export interface ManualFireResult {
  readonly taskId: TaskId
  readonly executionId: ExecutionId | null
  readonly reason: 'fired' | 'task_not_found' | 'terminal_state'
}

export class ManualTrigger {
  private readonly triggerFn: TriggerFn

  constructor(opts: ManualTriggerOptions) {
    this.triggerFn = opts.triggerFn
  }

  /**
   * Fire a single task synchronously to the trigger pipeline.
   * The caller has already authorised `userId` to trigger `taskId`.
   */
  async fire(
    storage: StorageAdapter,
    taskId: TaskId,
    opts: { readonly userId: string; readonly payload?: Record<string, unknown> },
  ): Promise<ManualFireResult> {
    if (typeof opts.userId !== 'string' || opts.userId.length === 0) {
      throw new TypeError('ManualTrigger.fire: userId is required')
    }

    const task: Task | null = await storage.getTask(taskId)
    if (task === null) {
      return { taskId, executionId: null, reason: 'task_not_found' }
    }
    if (TERMINAL.has(task.status)) {
      return { taskId, executionId: null, reason: 'terminal_state' }
    }

    const ctx: TriggerContext = {
      source: 'manual',
      triggeredBy: opts.userId,
      payload: opts.payload,
    }

    const executionId = await this.triggerFn(taskId, ctx, {
      userId: opts.userId,
      bypassGuard: false,
      bypassAuth: false,
    })

    /* Best-effort audit — never blocks the firing path. */
    const ts = Date.now()
    const auditEntry: AuditLog = {
      id: randomUUID(),
      action: MANUAL_AUDIT_ACTION,
      actorId: null /* could be a userId but AuditLog wants UUID */,
      resourceKind: 'task',
      resourceId: taskId,
      diffJson: JSON.stringify({ executionId, source: 'manual' }),
      metadataJson: JSON.stringify({ userId: opts.userId, ts }),
      createdAt: ts,
    }
    try {
      await storage.appendAudit(auditEntry)
    } catch {
      /* swallow */
    }

    return executionId !== null
      ? { taskId, executionId, reason: 'fired' }
      : { taskId, executionId: null, reason: 'fired' }
  }
}
