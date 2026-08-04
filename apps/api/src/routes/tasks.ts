/**
 * @cadence/api — task + execution routes.
 *
 *   GET    /api/tasks                          — list with filters
 *   POST   /api/tasks                          — create
 *   GET    /api/tasks/:id                      — read
 *   PATCH  /api/tasks/:id                      — update (optimistic lock)
 *   DELETE /api/tasks/:id                      — soft delete
 *   POST   /api/tasks/:id/trigger              — trigger (owner / pipeline:trigger)
 *   POST   /api/tasks/:id/suspend              — owner / pipeline:update
 *   POST   /api/tasks/:id/resume               — owner / pipeline:update
 *   POST   /api/tasks/:id/cancel               — cancel active execution(s)
 *
 *   GET    /api/executions                     — list with filters
 *   GET    /api/executions/:id                 — read
 *   GET    /api/executions/:id/stream          — SSE (currently noop stub)
 */
import { ulid } from 'ulid'
import { Hono } from 'hono'
import { z } from 'zod'
import { requireAuth, requirePermission } from '@cadence/auth'
import type { JwtSigner } from '@cadence/auth'
import type {
  Execution,
  ExecutionId,
  ExecutionPatch,
  Task,
  TaskId,
  TaskPatch,
  TaskStatus,
  UserId,
} from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import { ConflictError, NotFoundError, StaleVersionError } from '@cadence/storage'
import type { AppEnv } from '../app.js'
import { writeAudit } from '../app.js'
import { loadAndAuthorize } from '../lib/ownership.js'

/* ----------------------------- Schemas ----------------------------- */

const PayloadKindEnum = z.enum(['pipeline', 'command', 'http', 'script', 'webhook'])
const TriggerKindEnum = z.enum(['cron', 'manual', 'webhook', 'event'])
const TaskStatusEnum = z.enum([
  'pending',
  'scheduled',
  'queued',
  'dispatched',
  'running',
  'success',
  'failed',
  'cancelled',
  'suspended',
])

const CreateTaskBody = z.object({
  name: z.string().min(1).max(200),
  description: z.string().max(2000).optional(),
  groupId: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .nullable()
    .optional(),
  payloadKind: PayloadKindEnum,
  payload: z.unknown().default({}),
  triggerKind: TriggerKindEnum,
  triggerConfig: z.unknown().default({}),
  cron: z.string().nullable().optional(),
  timezone: z.string().default('UTC'),
  startAt: z.number().int().nullable().optional(),
  endAt: z.number().int().nullable().optional(),
  maxRetries: z.number().int().min(0).default(0),
  retryBackoff: z.enum(['fixed', 'exponential']).default('exponential'),
  concurrencyPolicy: z.enum(['skip', 'queue', 'parallel', 'kill_old']).default('skip'),
  jitterMs: z.number().int().min(0).default(0),
  timeoutMs: z.number().int().min(100).default(30000),
  tags: z.array(z.string()).default([]),
  metadata: z.record(z.unknown()).default({}),
})

const PatchTaskBody = z.object({
  name: z.string().min(1).max(200).optional(),
  description: z.string().max(2000).optional(),
  groupId: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .nullable()
    .optional(),
  payloadKind: PayloadKindEnum.optional(),
  payload: z.unknown().optional(),
  triggerKind: TriggerKindEnum.optional(),
  triggerConfig: z.unknown().optional(),
  status: TaskStatusEnum.optional(),
  cron: z.string().nullable().optional(),
  timezone: z.string().optional(),
  startAt: z.number().int().nullable().optional(),
  endAt: z.number().int().nullable().optional(),
  maxRetries: z.number().int().min(0).optional(),
  retryBackoff: z.enum(['fixed', 'exponential']).optional(),
  concurrencyPolicy: z.enum(['skip', 'queue', 'parallel', 'kill_old']).optional(),
  jitterMs: z.number().int().min(0).optional(),
  timeoutMs: z.number().int().min(100).optional(),
  tags: z.array(z.string()).optional(),
  metadata: z.record(z.unknown()).optional(),
  expectedVersion: z.number().int(),
})

const TriggerBody = z.object({
  payload: z.record(z.unknown()).optional(),
  idempotencyKey: z.string().min(1).optional(),
})

const TaskFilterQuery = z.object({
  status: TaskStatusEnum.optional(),
  payloadKind: PayloadKindEnum.optional(),
  triggerKind: TriggerKindEnum.optional(),
  tag: z.string().optional(),
  q: z.string().optional(),
  limit: z.coerce.number().int().min(0).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
  includeDeleted: z.coerce.boolean().optional(),
})

const ExecutionFilterQuery = z.object({
  taskId: z
    .string()
    .regex(/^[0-9A-HJKMNP-TV-Z]{26}$/)
    .optional(),
  status: TaskStatusEnum.optional(),
  from: z.coerce.number().int().optional(),
  to: z.coerce.number().int().optional(),
  limit: z.coerce.number().int().min(0).max(500).optional(),
  offset: z.coerce.number().int().min(0).optional(),
})

/* ----------------------------- Helpers ------------------------------ */

function toTaskResponse(t: Task): Record<string, unknown> {
  return {
    id: t.id,
    name: t.name,
    description: t.description,
    ownerId: t.owner_id,
    groupId: t.group_id,
    payloadKind: t.payload_kind,
    payload: safeParse(t.payload_json),
    triggerKind: t.trigger_kind,
    triggerConfig: safeParse(t.trigger_config_json),
    status: t.status,
    cron: t.cron,
    timezone: t.timezone,
    startAt: t.start_at,
    endAt: t.end_at,
    maxRetries: t.max_retries,
    retryBackoff: t.retry_backoff,
    concurrencyPolicy: t.concurrency_policy,
    jitterMs: t.jitter_ms,
    timeoutMs: t.timeout_ms,
    tags: t.tags,
    metadata: safeParse(t.metadata_json),
    version: t.version,
    createdAt: t.created_at,
    updatedAt: t.updated_at,
    deletedAt: t.deleted_at,
  }
}

function toExecutionResponse(e: Execution): Record<string, unknown> {
  return {
    id: e.id,
    taskId: e.taskId,
    status: e.status,
    triggerSource: e.triggerSource,
    triggeredBy: e.triggeredBy,
    startedAt: e.startedAt,
    finishedAt: e.finishedAt,
    durationMs: e.durationMs,
    retryCount: e.retryCount,
    error: e.errorJson === null ? null : safeParse(e.errorJson),
    result: e.resultJson === null ? null : safeParse(e.resultJson),
    version: e.version,
    createdAt: e.createdAt,
    updatedAt: e.updatedAt,
  }
}

function safeParse(s: string): unknown {
  try {
    return JSON.parse(s)
  } catch {
    return s
  }
}

/* ------------------------------------------------------------------ */
/* Tasks                                                              */
/* ------------------------------------------------------------------ */

export interface MountTasksDeps {
  readonly storage: StorageAdapter
  readonly jwt: JwtSigner
}

export function mountTasksRoutes(deps: MountTasksDeps): Hono<AppEnv> {
  const { storage, jwt } = deps
  const r = new Hono<AppEnv>()
  const auth = requireAuth(jwt, storage)

  /* GET /api/tasks — scope to own/group by default; superadmin sees all */
  r.get('/', auth, async (c) => {
    const user = c.get('user')
    const url = new URL(c.req.url)
    const parsed = TaskFilterQuery.parse({
      status: url.searchParams.get('status') ?? undefined,
      payloadKind: url.searchParams.get('payloadKind') ?? undefined,
      triggerKind: url.searchParams.get('triggerKind') ?? undefined,
      tag: url.searchParams.get('tag') ?? undefined,
      q: url.searchParams.get('q') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
      includeDeleted: url.searchParams.get('includeDeleted') ?? undefined,
    })
    const filter: Parameters<StorageAdapter['listTasks']>[0] = {}
    if (parsed.status !== undefined) filter.status = parsed.status
    if (parsed.payloadKind !== undefined) filter.payloadKind = parsed.payloadKind
    if (parsed.triggerKind !== undefined) filter.triggerKind = parsed.triggerKind
    if (parsed.tag !== undefined) filter.tags = [parsed.tag as never]
    if (parsed.q !== undefined) filter.q = parsed.q
    if (parsed.limit !== undefined) filter.limit = parsed.limit
    if (parsed.offset !== undefined) filter.offset = parsed.offset
    if (parsed.includeDeleted !== undefined) filter.includeDeleted = parsed.includeDeleted
    /* Non-superadmin → scope to own tasks only.
     * Full group-scoped visibility requires RBAC group membership resolution
     * (PHASE 3+ work). For now, the guard prevents cross-tenant task listing. */
    if (!user.isSuperadmin) {
      ;(filter as Record<string, unknown>)['ownerId'] = user.id
    }
    const tasks = await storage.listTasks(filter)
    return c.json({ tasks: tasks.map(toTaskResponse) })
  })

  /* POST /api/tasks */
  r.post('/', auth, requirePermission('pipeline:create', undefined, storage), async (c) => {
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = CreateTaskBody.parse(raw)
    const id = ulid() as TaskId
    const now = Date.now()
    const ownerId = c.get('user').id
    const task: Task = {
      id,
      name: body.name,
      description: body.description,
      owner_id: ownerId as unknown as TaskId,
      group_id: (body.groupId ?? null) as TaskId | null,
      payload_kind: body.payloadKind,
      payload_json: JSON.stringify(body.payload ?? {}),
      trigger_kind: body.triggerKind,
      trigger_config_json: JSON.stringify(body.triggerConfig ?? {}),
      status: 'pending',
      cron: body.cron ?? null,
      timezone: body.timezone,
      start_at: body.startAt ?? null,
      end_at: body.endAt ?? null,
      max_retries: body.maxRetries,
      retry_backoff: body.retryBackoff,
      concurrency_policy: body.concurrencyPolicy,
      jitter_ms: body.jitterMs,
      timeout_ms: body.timeoutMs,
      tags: body.tags,
      notifications_json: null,
      metadata_json: JSON.stringify(body.metadata ?? {}),
      version: 1,
      created_at: now,
      updated_at: now,
      deleted_at: null,
    }
    try {
      await storage.saveTask(task)
    } catch (err: unknown) {
      if (err instanceof ConflictError) throw err
      throw err
    }
    await writeAudit(storage, {
      action: 'task.create',
      actorId: ownerId,
      resourceKind: 'task',
      resourceId: id,
      diff: { name: body.name, payloadKind: body.payloadKind },
    })
    return c.json({ task: toTaskResponse(task) }, 201)
  })

  /* GET /api/tasks/:id — owner / group member / admin */
  r.get('/:id', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const task = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:read',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    /* Soft-deleted tasks are treated as not found at the API boundary. */
    if (task.deleted_at !== null) throw new NotFoundError('Task', id)
    return c.json({ task: toTaskResponse(task) })
  })

  /* PATCH /api/tasks/:id — owner or admin */
  r.patch('/:id', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = PatchTaskBody.parse(raw)
    /* loadAndAuthorize throws 404/403 if the task is missing or the
     * caller cannot update it; we don't otherwise need the task
     * entity here (the patch only references the id). */
    await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:update',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    const user = c.get('user')
    const patch: TaskPatch = {
      ...(body.name !== undefined ? { name: body.name } : {}),
      ...(body.description !== undefined ? { description: body.description } : {}),
      ...(body.groupId !== undefined ? { group_id: body.groupId as TaskId | null } : {}),
      ...(body.payloadKind !== undefined ? { payload_kind: body.payloadKind } : {}),
      ...(body.payload !== undefined ? { payload_json: JSON.stringify(body.payload) } : {}),
      ...(body.triggerKind !== undefined ? { trigger_kind: body.triggerKind } : {}),
      ...(body.triggerConfig !== undefined
        ? { trigger_config_json: JSON.stringify(body.triggerConfig) }
        : {}),
      ...(body.status !== undefined ? { status: body.status } : {}),
      ...(body.cron !== undefined ? { cron: body.cron } : {}),
      ...(body.timezone !== undefined ? { timezone: body.timezone } : {}),
      ...(body.startAt !== undefined ? { start_at: body.startAt } : {}),
      ...(body.endAt !== undefined ? { end_at: body.endAt } : {}),
      ...(body.maxRetries !== undefined ? { max_retries: body.maxRetries } : {}),
      ...(body.retryBackoff !== undefined ? { retry_backoff: body.retryBackoff } : {}),
      ...(body.concurrencyPolicy !== undefined
        ? { concurrency_policy: body.concurrencyPolicy }
        : {}),
      ...(body.jitterMs !== undefined ? { jitter_ms: body.jitterMs } : {}),
      ...(body.timeoutMs !== undefined ? { timeout_ms: body.timeoutMs } : {}),
      ...(body.tags !== undefined ? { tags: body.tags } : {}),
      ...(body.metadata !== undefined ? { metadata_json: JSON.stringify(body.metadata) } : {}),
      expectedVersion: body.expectedVersion,
    }
    try {
      const updated = await storage.updateTask(id, patch)
      await writeAudit(storage, {
        action: 'task.update',
        actorId: user.id,
        resourceKind: 'task',
        resourceId: id,
        diff: patch as unknown as Record<string, unknown>,
      })
      return c.json({ task: toTaskResponse(updated) })
    } catch (err: unknown) {
      if (err instanceof StaleVersionError) throw err
      throw err
    }
  })

  /* DELETE /api/tasks/:id — owner or admin */
  r.delete('/:id', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const task = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:delete',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    try {
      await storage.deleteTask(id, task.version)
    } catch (err: unknown) {
      if (err instanceof StaleVersionError) throw err
      throw err
    }
    await writeAudit(storage, {
      action: 'task.delete',
      actorId: c.get('user').id,
      resourceKind: 'task',
      resourceId: id,
    })
    return c.json({ ok: true })
  })

  /* POST /api/tasks/:id/trigger — owner / group member / admin */
  r.post('/:id/trigger', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = TriggerBody.parse(raw)
    const task = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:trigger',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    const user = c.get('user')
    const executionId = ulid() as ExecutionId
    const now = Date.now()
    const execution: Execution = {
      id: executionId,
      taskId: task.id,
      status: 'queued',
      triggerSource: 'manual',
      triggeredBy: user.id,
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey: body.idempotencyKey ?? null,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await storage.createExecution(execution)
    await writeAudit(storage, {
      action: 'execution.create',
      actorId: user.id,
      resourceKind: 'execution',
      resourceId: executionId,
      diff: { taskId: id },
    })
    return c.json({ executionId }, 202)
  })

  /* POST /api/tasks/:id/suspend — owner / group member / admin */
  r.post('/:id/suspend', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const task = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:update',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    try {
      const updated = await storage.updateTask(id, {
        status: 'suspended',
        expectedVersion: task.version,
      })
      await writeAudit(storage, {
        action: 'task.update',
        actorId: c.get('user').id,
        resourceKind: 'task',
        resourceId: id,
        diff: { status: 'suspended' },
      })
      return c.json({ task: toTaskResponse(updated) })
    } catch (err: unknown) {
      if (err instanceof StaleVersionError) throw err
      throw err
    }
  })

  /* POST /api/tasks/:id/resume — owner / group member / admin */
  r.post('/:id/resume', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    const task = await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:update',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    try {
      const updated = await storage.updateTask(id, {
        status: 'pending',
        expectedVersion: task.version,
      })
      await writeAudit(storage, {
        action: 'task.update',
        actorId: c.get('user').id,
        resourceKind: 'task',
        resourceId: id,
        diff: { status: 'pending' },
      })
      return c.json({ task: toTaskResponse(updated) })
    } catch (err: unknown) {
      if (err instanceof StaleVersionError) throw err
      throw err
    }
  })

  /* POST /api/tasks/:id/cancel — owner / group member / admin */
  r.post('/:id/cancel', auth, async (c) => {
    const id = c.req.param('id') as TaskId
    await loadAndAuthorize(
      c,
      id,
      (rid) => storage.getTask(rid as TaskId),
      'pipeline:update',
      (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
    )
    const active = (await storage.listExecutions({ taskId: id })).filter(
      (e) => e.status !== 'success' && e.status !== 'failed' && e.status !== 'cancelled',
    )
    let count = 0
    for (const e of active) {
      const patch: ExecutionPatch = {
        status: 'cancelled',
        finishedAt: Date.now(),
        expectedVersion: e.version,
      }
      await storage.updateExecution(e.id, patch)
      await writeAudit(storage, {
        action: 'execution.cancel',
        actorId: c.get('user').id,
        resourceKind: 'execution',
        resourceId: e.id,
      })
      count += 1
    }
    return c.json({ cancelled: count })
  })

  return r
}

/* ------------------------------------------------------------------ */
/* Executions                                                         */
/* ------------------------------------------------------------------ */

export function mountExecutionsRoutes(deps: MountTasksDeps): Hono<AppEnv> {
  const { storage, jwt } = deps
  const r = new Hono<AppEnv>()
  const auth = requireAuth(jwt, storage)

  /* GET /api/executions — scope to user's own tasks by default */
  r.get('/', auth, requirePermission('pipeline:read', undefined, storage), async (c) => {
    const user = c.get('user')
    const url = new URL(c.req.url)
    const parsed = ExecutionFilterQuery.parse({
      taskId: url.searchParams.get('taskId') ?? undefined,
      status: url.searchParams.get('status') ?? undefined,
      from: url.searchParams.get('from') ?? undefined,
      to: url.searchParams.get('to') ?? undefined,
      limit: url.searchParams.get('limit') ?? undefined,
      offset: url.searchParams.get('offset') ?? undefined,
    })
    const filter: Parameters<StorageAdapter['listExecutions']>[0] = {}
    if (parsed.taskId !== undefined) filter.taskId = parsed.taskId
    if (parsed.status !== undefined) filter.status = parsed.status as TaskStatus
    if (parsed.from !== undefined) filter.from = parsed.from
    if (parsed.to !== undefined) filter.to = parsed.to
    if (parsed.limit !== undefined) filter.limit = parsed.limit
    if (parsed.offset !== undefined) filter.offset = parsed.offset
    /* Non-superadmin: scope to tasks owned by the current user */
    if (!user.isSuperadmin) {
      const userTasks = await storage.listTasks({
        ownerId: user.id as unknown as string,
      } as Parameters<StorageAdapter['listTasks']>[0])
      const accessibleIds = userTasks.map((t: Task) => t.id)
      if (accessibleIds.length === 0) return c.json({ executions: [] })
      if (filter.taskId !== undefined) {
        if (!accessibleIds.includes(filter.taskId)) return c.json({ executions: [] })
      } else {
        /* Merge user's accessible taskIds into filter range */
        ;(filter as Record<string, unknown>)['taskIds'] = accessibleIds
      }
    }
    const all = await storage.listExecutions(filter)
    return c.json({ executions: all.map(toExecutionResponse) })
  })

  /* GET /api/executions/:id — read */
  r.get('/:id', auth, async (c) => {
    const id = c.req.param('id') as ExecutionId
    const execution = await storage.getExecution(id)
    if (execution === null) throw new NotFoundError('Execution', id)
    /* IDOR: execution visibility follows the parent task. */
    const task = await storage.getTask(execution.taskId)
    if (task !== null) {
      await loadAndAuthorize(
        c,
        String(execution.taskId),
        (rid) => storage.getTask(rid as TaskId),
        'pipeline:read',
        (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
      )
    }
    return c.json({ execution: toExecutionResponse(execution) })
  })

  /* GET /api/executions/:id/stream — SSE (noop stub for PHASE 3) */
  r.get('/:id/stream', auth, async (c) => {
    const id = c.req.param('id') as ExecutionId
    const execution = await storage.getExecution(id)
    if (execution === null) throw new NotFoundError('Execution', id)
    /* IDOR: stream follows parent task visibility. */
    const task = await storage.getTask(execution.taskId)
    if (task !== null) {
      await loadAndAuthorize(
        c,
        String(execution.taskId),
        (rid) => storage.getTask(rid as TaskId),
        'pipeline:read',
        (t) => ({ ownerId: t.owner_id as unknown as UserId, groupId: t.group_id }),
      )
    }
    /* Emit a single heartbeat and close. Real streaming lands when the
     * SSE bus is wired up in PHASE 5. */
    const stream = new ReadableStream<Uint8Array>({
      start(controller) {
        const payload = `event: snapshot\ndata: ${JSON.stringify(toExecutionResponse(execution))}\n\n`
        controller.enqueue(new TextEncoder().encode(payload))
        controller.close()
      },
    })
    return new Response(stream, {
      headers: {
        'content-type': 'text/event-stream',
        'cache-control': 'no-cache',
        connection: 'keep-alive',
      },
    })
  })

  return r
}

export const mountTaskRoutes = {
  tasks: mountTasksRoutes,
  executions: mountExecutionsRoutes,
}
