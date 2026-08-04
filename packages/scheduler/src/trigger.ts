/**
 * @cadence/scheduler — single entry point used by every trigger
 * (cron / event / webhook / manual).
 *
 * Responsibilities:
 *  - evaluate `Task.concurrency_policy` against active executions and skip
 *    the new trigger if policy is 'skip' and an execution is already running
 *  - emit audit entries (`task.triggered_via_*`, ...)
 *
 * This module is intentionally PURE-IO: it takes a `now()` clock for tests.
 */
import { randomUUID } from 'node:crypto'
import type {
  AuditAction,
  AuditLog,
  ExecutionId,
  TaskId,
  TaskStatus,
  TriggerContext,
} from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

import type { TriggerFn } from './index.js'

export type TriggerReason =
  'fired' | 'skipped_concurrency' | 'skipped_terminal_state' | 'task_not_found'

export interface TriggerOutcome {
  readonly taskId: TaskId
  readonly reason: TriggerReason
  readonly executionId: ExecutionId | null
  /** active executions at the time of the call (for tests/observability) */
  readonly activeCount: number
}

/** Audit action that corresponds to a given TriggerContext.source. */
export function auditActionForTrigger(source: TriggerContext['source']): AuditAction {
  switch (source) {
    case 'cron':
      return 'task.triggered_via_cron'
    case 'webhook':
      return 'task.triggered_via_webhook'
    case 'event':
      return 'task.triggered_via_event'
    case 'manual':
      return 'task.triggered_manually'
    default:
      return 'task.triggered_manually'
  }
}

const TERMINAL: ReadonlySet<TaskStatus> = new Set(['success', 'cancelled'])

/**
 * Try to fire a task. Resolves concurrency policy in-line. Records an
 * audit entry regardless of outcome. Does NOT mutate task.status.
 */
export async function triggerTask(
  storage: StorageAdapter,
  triggerFn: TriggerFn,
  taskId: TaskId,
  ctx: TriggerContext,
  systemActorId: string,
  options: {
    now?: () => number
  } = {},
): Promise<TriggerOutcome> {
  const now = options.now ?? (() => Date.now())
  const task = await storage.getTask(taskId)
  if (task === null) {
    return { taskId, reason: 'task_not_found', executionId: null, activeCount: 0 }
  }

  /* Terminal task guard — manual / event / webhook may still try to
   * fire a cancelled or successful task; don't enqueue. */
  if (TERMINAL.has(task.status)) {
    await appendAuditSafe(storage, {
      id: randomUUID(),
      action: 'execution.create',
      actorId: null,
      resourceKind: 'task',
      resourceId: taskId,
      diffJson: JSON.stringify({ skipped: true, reason: 'terminal_state', source: ctx.source }),
      metadataJson: '{}',
      createdAt: now(),
    })
    return { taskId, reason: 'skipped_terminal_state', executionId: null, activeCount: 0 }
  }

  /* Concurrency policy evaluation. */
  let activeCount = 0
  if (task.concurrency_policy === 'skip') {
    const active = await storage.listExecutions({ taskId, status: 'running' })
    activeCount = active.length
    if (active.length > 0) {
      await appendAuditSafe(storage, {
        id: randomUUID(),
        action: 'task.concurrency_skipped',
        actorId: null,
        resourceKind: 'task',
        resourceId: taskId,
        diffJson: JSON.stringify({
          skipped: true,
          reason: 'concurrency_skip',
          source: ctx.source,
          activeIds: active.map((e) => e.id),
        }),
        metadataJson: '{}',
        createdAt: now(),
      })
      return { taskId, reason: 'skipped_concurrency', executionId: null, activeCount }
    }
  }

  const executionId = await triggerFn(taskId, ctx, {
    userId: systemActorId,
    bypassGuard: true,
    bypassAuth: true,
  })

  if (executionId !== null) {
    await appendAuditSafe(storage, {
      id: randomUUID(),
      action: auditActionForTrigger(ctx.source),
      actorId: null,
      resourceKind: 'task',
      resourceId: taskId,
      diffJson: JSON.stringify({
        executionId,
        source: ctx.source,
        ts: now(),
      }),
      metadataJson: '{}',
      createdAt: now(),
    })
  }

  return {
    taskId,
    reason: executionId !== null ? 'fired' : 'skipped_concurrency',
    executionId,
    activeCount,
  }
}

async function appendAuditSafe(storage: StorageAdapter, entry: AuditLog): Promise<void> {
  try {
    await storage.appendAudit(entry)
  } catch {
    /* best-effort: audit MUST NOT block trigger flow */
  }
}
