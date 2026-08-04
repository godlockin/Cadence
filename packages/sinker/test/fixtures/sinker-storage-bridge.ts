/**
 * @cadence/sinker — PHASE 1 → PHASE 2 StorageAdapter bridge.
 *
 * PHASE 1 (sinker) was designed against a lean port:
 *   getTask, createExecution(NewExecutionInput),
 *   patchExecution(id, ExecutionStatusPatch, expectedVersion),
 *   getExecution, patchTask(id, TaskStatusPatch, expectedVersion),
 *   listActiveExecutionsByTask
 *
 * PHASE 2 (storage) ships a richer StorageAdapter contract:
 *   getTask, listTasks, saveTask, updateTask (TaskPatch with expectedVersion),
 *   getExecution, listExecutions, createExecution(Execution), updateExecution (ExecutionPatch),
 *   appendAudit, listAuditLogs, ...
 *
 * SinkerStorageAdapter is the boundary: it implements the PHASE 1 port by
 * delegating to the PHASE 2 storage. Optimistic locking semantics
 * (StaleVersionError) are preserved.
 *
 *   new SinkerStorageAdapter(phase2Storage) → implements SinkerEngine's
 *   StorageAdapter port.
 */
import type {
  Execution,
  ExecutionId,
  NewExecutionInput,
  ExecutionStatusPatch,
  Task,
  TaskId,
  TaskStatus,
  TaskStatusPatch,
} from '../src/index.js'
import type { StorageAdapter as Phase2Storage, TaskPatch, ExecutionPatch, GroupId, UserId } from '@cadence/storage'
import { StaleVersionError } from '@cadence/storage'

/* PHASE 1 port — what SinkerEngine actually calls. */
export interface SinkerStoragePort {
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
  isGroupMember(groupId: string, userId: string): Promise<boolean>
}

const TERMINAL_STATUSES: ReadonlySet<TaskStatus> = new Set(['success', 'failed', 'cancelled'])

export class SinkerStorageAdapter implements SinkerStoragePort {
  constructor(private readonly inner: Phase2Storage) {}

  async getTask(id: TaskId): Promise<Task | null> {
    return this.inner.getTask(id)
  }

  async createExecution(input: NewExecutionInput): Promise<Execution> {
    const now = Date.now()
    const execution: Execution = {
      id: input.id,
      taskId: input.taskId,
      status: 'queued',
      triggerSource: input.triggerSource,
      triggeredBy: input.triggeredBy ?? null,
      startedAt: input.startedAt,
      finishedAt: null,
      durationMs: null,
      retryCount: input.retryCount,
      errorJson: null,
      resultJson: null,
      idempotencyKey: null,
      version: 1,
      createdAt: input.startedAt ?? now,
      updatedAt: now,
    }
    await this.inner.createExecution(execution)
    return execution
  }

  async getExecution(id: ExecutionId): Promise<Execution | null> {
    return this.inner.getExecution(id)
  }

  async patchExecution(
    id: ExecutionId,
    patch: ExecutionStatusPatch,
    expectedVersion: number,
  ): Promise<Execution> {
    const fullPatch: ExecutionPatch = {
      ...patch,
      expectedVersion,
    }
    try {
      return await this.inner.updateExecution(id, fullPatch)
    } catch (err: unknown) {
      /* PHASE 2 surface uses StaleVersionError; SinkerEngine reads `name`. */
      if (err instanceof StaleVersionError) {
        throw new StaleVersionError(err.resource, err.expected, err.actual)
      }
      throw err
    }
  }

  async patchTask(
    id: TaskId,
    patch: TaskStatusPatch,
    expectedVersion: number,
  ): Promise<Task> {
    const fullPatch: TaskPatch = {
      ...(patch.status !== undefined ? { status: patch.status } : {}),
      ...(patch.metadata !== undefined ? { metadata_json: patch.metadata } : {}),
      expectedVersion,
    }
    try {
      return await this.inner.updateTask(id, fullPatch)
    } catch (err: unknown) {
      if (err instanceof StaleVersionError) {
        throw new StaleVersionError(err.resource, err.expected, err.actual)
      }
      throw err
    }
  }

  async listActiveExecutionsByTask(taskId: TaskId): Promise<Execution[]> {
    const all = await this.inner.listExecutions({ taskId })
    return all.filter((e) => !TERMINAL_STATUSES.has(e.status))
  }

  async isGroupMember(groupId: string, userId: string): Promise<boolean> {
    return this.inner.isGroupMember(groupId as GroupId, userId as UserId)
  }
}
