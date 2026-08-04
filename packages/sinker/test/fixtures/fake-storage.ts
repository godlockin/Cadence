/**
 * Fake storage adapter for unit tests.
 * In-memory task + execution store. Optimistic locking via `version` field.
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
} from '@cadence/sinker'

interface StoredTask extends Task {
  _version: number
}
interface StoredExecution extends Execution {
  _version: number
}

export interface FakeStorageOptions {
  /** groupId -> Set<userId> membership table. */
  groups?: Map<string, Set<string>>
}

export class FakeStorage {
  readonly tasks = new Map<TaskId, StoredTask>()
  readonly executions = new Map<ExecutionId, StoredExecution>()
  readonly groups: Map<string, Set<string>>

  constructor(opts: FakeStorageOptions = {}) {
    this.groups = opts.groups ?? new Map<string, Set<string>>()
  }

  addGroupMember(groupId: string, userId: string): void {
    let set = this.groups.get(groupId)
    if (!set) {
      set = new Set<string>()
      this.groups.set(groupId, set)
    }
    set.add(userId)
  }

  /* The interface shape is structural; we cast `this` to the port. */
  asAdapter() {
    return {
      getTask: (id: TaskId) => this.getTask(id),
      createExecution: (i: NewExecutionInput) => this.createExecution(i),
      patchExecution: (id: ExecutionId, p: ExecutionStatusPatch, ev: number) =>
        this.patchExecution(id, p, ev),
      getExecution: (id: ExecutionId) => this.getExecution(id),
      patchTask: (id: TaskId, p: TaskStatusPatch, ev: number) => this.patchTask(id, p, ev),
      listActiveExecutionsByTask: (id: TaskId) => this.listActiveExecutionsByTask(id),
      isGroupMember: (groupId: string, userId: string) =>
        Promise.resolve(this.groups.get(groupId)?.has(userId) ?? false),
    } as const
  }

  putTask(t: Task): Task {
    const stored: StoredTask = { ...t, _version: 1 }
    this.tasks.set(t.id, stored)
    return t
  }

  async getTask(id: TaskId): Promise<Task | null> {
    const t = this.tasks.get(id)
    if (!t) return null
    const { _version, ...rest } = t
    void _version
    return rest
  }

  async createExecution(input: NewExecutionInput): Promise<Execution> {
    const e: StoredExecution = {
      _version: 1,
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
      createdAt: input.startedAt,
      updatedAt: input.startedAt,
    }
    this.executions.set(e.id, e)
    return this.materialise(e)
  }

  async getExecution(id: ExecutionId): Promise<Execution | null> {
    const e = this.executions.get(id)
    return e ? this.materialise(e) : null
  }

  async patchExecution(
    id: ExecutionId,
    patch: ExecutionStatusPatch,
    expectedVersion: number,
  ): Promise<Execution> {
    const e = this.executions.get(id)
    if (!e) throw new Error(`Execution not found: ${id}`)
    if (e._version !== expectedVersion) {
      throw new Error(`StaleExecutionVersion: expected ${expectedVersion}, got ${e._version}`)
    }
    const next: StoredExecution = {
      ...e,
      ...patch,
      _version: e._version + 1,
      updatedAt: Date.now(),
    }
    this.executions.set(id, next)
    return this.materialise(next)
  }

  async patchTask(
    id: TaskId,
    patch: TaskStatusPatch,
    expectedVersion: number,
  ): Promise<Task> {
    const t = this.tasks.get(id)
    if (!t) throw new Error(`Task not found: ${id}`)
    if (t._version !== expectedVersion) {
      throw new Error(`StaleTaskVersion: expected ${expectedVersion}, got ${t._version}`)
    }
    const next: StoredTask = { ...t, status: patch.status as TaskStatus, _version: t._version + 1, updated_at: Date.now() }
    this.tasks.set(id, next)
    const { _version, ...rest } = next
    void _version
    return rest
  }

  async listActiveExecutionsByTask(taskId: TaskId): Promise<Execution[]> {
    const terminal: ReadonlySet<TaskStatus> = new Set(['success', 'failed', 'cancelled'])
    return [...this.executions.values()]
      .filter((e) => e.taskId === taskId && !terminal.has(e.status))
      .map((e) => this.materialise(e))
  }

  private materialise(e: StoredExecution): Execution {
    const { _version, ...rest } = e
    void _version
    return { ...rest, version: _version }
  }
}
