/**
 * @cadence/api — inbound webhook routes.
 *
 *   POST /api/webhooks/:token/trigger
 *
 * The `:token` is matched against the `trigger_config_json` of a webhook
 * task. If found, we spawn an Execution row (source='webhook') and
 * return its id.
 *
 * Idempotency:
 *   - Clients may include `Idempotency-Key` header.
 *   - If the same key is replayed within the dedup window (24h), the
 *     SAME executionId is returned. Otherwise a new execution is spawned.
 *   - Without a key, every call fires a new execution.
 *
 * Audit: every trigger (incl. dedup hits) appends an `execution.create`
 * row with the `via: 'webhook'`, `idempotencyKey`, and `replay: true|false`
 * flags.
 */
import { ulid } from 'ulid'
import { createHash } from 'node:crypto'
import { Hono } from 'hono'
import { z } from 'zod'
import type { Execution, ExecutionId, Task } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'
import { NotFoundError } from '@cadence/storage'
import type { AppEnv } from '../app.js'
import { writeAudit } from '../app.js'

const TriggerBody = z
  .object({
    payload: z.record(z.unknown()).optional(),
  })
  .default({ payload: {} })

const IDEMPOTENCY_WINDOW_MS = 24 * 60 * 60 * 1000 // 24h

export interface MountWebhookDeps {
  readonly storage: StorageAdapter
}

interface IdempotencyCacheEntry {
  readonly executionId: ExecutionId
  readonly expiresAt: number
  readonly taskId: string
}

/** Find a webhook task whose trigger_config_json contains the token. */
async function findWebhookTask(storage: StorageAdapter, token: string): Promise<Task | null> {
  const all = await storage.listTasks({ triggerKind: 'webhook' })
  for (const t of all) {
    try {
      const parsed = JSON.parse(t.trigger_config_json) as unknown
      if (parsed !== null && typeof parsed === 'object') {
        const obj = parsed as Record<string, unknown>
        if (obj['token'] === token) return t
      }
    } catch {
      /* malformed config → skip */
    }
  }
  return null
}

/**
 * Module-scoped dedup cache. In production this should be Redis / DO
 * storage for cross-isolate consistency. For single-node deployment
 * this in-process Map is sufficient.
 */
const DEDUP_CACHE = new Map<string, IdempotencyCacheEntry>()

function computeIdempotencyKey(token: string, body: unknown, hdrKey: string | null): string {
  if (typeof hdrKey === 'string' && hdrKey.length > 0) {
    /* Client-supplied key takes precedence; deterministic. */
    return createHash('sha256').update(`${token}:${hdrKey}`).digest('hex')
  }
  /* Otherwise derive sha256(token + body). */
  const json = typeof body === 'string' ? body : JSON.stringify(body ?? {})
  return createHash('sha256').update(`${token}:${json}`).digest('hex')
}

export function _pruneDedupCache(now: number = Date.now()): number {
  let removed = 0
  for (const [k, v] of DEDUP_CACHE.entries()) {
    if (v.expiresAt <= now) {
      DEDUP_CACHE.delete(k)
      removed++
    }
  }
  return removed
}

export function _dedupCacheSize(): number {
  return DEDUP_CACHE.size
}

export function mountWebhookRoutes(deps: MountWebhookDeps): Hono<AppEnv> {
  const { storage } = deps
  const r = new Hono<AppEnv>()

  r.post('/:token/trigger', async (c) => {
    const token = c.req.param('token')
    if (typeof token !== 'string' || token.length < 8) {
      throw new NotFoundError('Webhook', token ?? '')
    }
    const task = await findWebhookTask(storage, token)
    if (task === null) throw new NotFoundError('Webhook', token)
    const raw = (await c.req.json().catch(() => ({}))) as unknown
    const body = TriggerBody.parse(raw)
    const hdrKey = c.req.header('Idempotency-Key') ?? null
    const idempotencyKey = computeIdempotencyKey(token, body, hdrKey)
    const now = Date.now()

    /* Dedup fast-path. */
    const cached = DEDUP_CACHE.get(idempotencyKey)
    if (cached !== undefined && cached.expiresAt > now) {
      await writeAudit(storage, {
        action: 'execution.create',
        actorId: null,
        resourceKind: 'execution',
        resourceId: cached.executionId,
        diff: {
          taskId: cached.taskId,
          via: 'webhook',
          replay: true,
          idempotencyKey,
        },
      })
      return c.json({ executionId: cached.executionId, taskId: cached.taskId, replay: true }, 200)
    }

    const executionId = ulid() as ExecutionId
    const execution: Execution = {
      id: executionId,
      taskId: task.id,
      status: 'queued',
      triggerSource: 'webhook',
      triggeredBy: null,
      startedAt: now,
      finishedAt: null,
      durationMs: null,
      retryCount: 0,
      errorJson: null,
      resultJson: null,
      idempotencyKey,
      version: 1,
      createdAt: now,
      updatedAt: now,
    }
    await storage.createExecution(execution)
    DEDUP_CACHE.set(idempotencyKey, {
      executionId,
      expiresAt: now + IDEMPOTENCY_WINDOW_MS,
      taskId: task.id,
    })
    await writeAudit(storage, {
      action: 'execution.create',
      actorId: null,
      resourceKind: 'execution',
      resourceId: executionId,
      diff: {
        taskId: task.id,
        via: 'webhook',
        replay: false,
        payload: body.payload ?? {},
        idempotencyKey,
      },
    })
    return c.json({ executionId, taskId: task.id, replay: false }, 202)
  })

  return r
}
