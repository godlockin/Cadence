/**
 * @cadence/scheduler — WebhookTrigger.
 *
 * Maps opaque tokens to task IDs, dedups by SHA-256(token + body).
 *
 *   const wh = new WebhookTrigger({ triggerFn, systemActorId })
 *   const token = wh.register(taskId)
 *   ...
 *   await wh.fire(storage, token, { foo: 'bar' })  // returns TaskNotFound on unknown token
 *
 * Idempotency:
 *  - `idempotencyKey` is computed as `sha256(token + JSON.stringify(body))`.
 *  - First call wins. Subsequent calls with the same key return the SAME
 *    execution ID (HTTP 200 with the existing id) — never a fresh enqueue.
 *
 * Test notes:
 *  - TTL defaults to 5 minutes (typical).
 *  - The dedup store is in-memory; in production this should be Redis/Durable
 *    Objects storage for cross-isolate consistency.
 */
import { createHash } from 'node:crypto'
import type { ExecutionId, Task, TaskId, TriggerContext } from '@cadence/domain'
import type { StorageAdapter } from '@cadence/storage'

import type { TriggerFn } from './index.js'
import { triggerTask, type TriggerOutcome } from './trigger.js'

export interface WebhookTriggerOptions {
  readonly triggerFn: TriggerFn
  readonly systemActorId?: string
  readonly dedupTtlMs?: number
  readonly now?: () => number
}

export interface WebhookFireOutcome {
  readonly outcome: TriggerOutcome
  readonly idempotencyKey: string
  readonly deduplicated: boolean
}

interface DedupEntry {
  readonly executionId: ExecutionId
  readonly expiresAt: number
}

export class WebhookTrigger {
  private readonly triggerFn: TriggerFn
  private readonly systemActorId: string
  private readonly now: () => number
  private readonly dedupTtlMs: number
  private readonly tokenMap: Map<string, TaskId> = new Map()
  private readonly dedup: Map<string, DedupEntry> = new Map()

  constructor(opts: WebhookTriggerOptions) {
    this.triggerFn = opts.triggerFn
    this.systemActorId = opts.systemActorId ?? 'system:webhook'
    this.now = opts.now ?? (() => Date.now())
    this.dedupTtlMs = opts.dedupTtlMs ?? 5 * 60_000
  }

  /** Register a webhook for the given task and return its token. */
  register(taskId: TaskId, token?: string): string {
    const tk = token ?? randomToken()
    this.tokenMap.set(tk, taskId)
    return tk
  }

  /** Manually remove a webhook registration. */
  unregister(token: string): boolean {
    return this.tokenMap.delete(token)
  }

  /** Lookup only — does NOT mutate. */
  async resolve(storage: StorageAdapter, token: string): Promise<Task | null> {
    const tid = this.tokenMap.get(token)
    if (tid === undefined) return null
    return await storage.getTask(tid)
  }

  /** Compute the idempotency key for (token, body). */
  static idempotencyKey(token: string, body: unknown): string {
    const json = typeof body === 'string' ? body : JSON.stringify(body ?? {})
    return createHash('sha256').update(`${token}:${json}`).digest('hex')
  }

  /**
   * Fire a webhook. Returns 404 semantics via `outcome.reason === 'task_not_found'`.
   * Duplicate idempotency keys within the TTL return the original executionId.
   */
  async fire(storage: StorageAdapter, token: string, body: unknown): Promise<WebhookFireOutcome> {
    const idemKey = WebhookTrigger.idempotencyKey(token, body)

    /* Fast path: known duplicate -> replay the existing execution id. */
    const cached = this.dedup.get(idemKey)
    if (cached !== undefined && cached.expiresAt > this.now()) {
      const taskId = this.tokenMap.get(token) ?? ('' as TaskId)
      return {
        outcome: {
          taskId,
          reason: 'fired',
          executionId: cached.executionId,
          activeCount: 0,
        },
        idempotencyKey: idemKey,
        deduplicated: true,
      }
    }

    const taskId = this.tokenMap.get(token)
    if (taskId === undefined) {
      return {
        outcome: {
          taskId: '' as TaskId,
          reason: 'task_not_found',
          executionId: null,
          activeCount: 0,
        },
        idempotencyKey: idemKey,
        deduplicated: false,
      }
    }

    const ctx: TriggerContext = {
      source: 'webhook',
      triggeredBy: this.systemActorId,
      idempotencyKey: idemKey,
      payload:
        typeof body === 'object' && body !== null
          ? (body as Record<string, unknown>)
          : { raw: body },
    }

    const outcome = await triggerTask(storage, this.triggerFn, taskId, ctx, this.systemActorId, {
      now: this.now,
    })

    if (outcome.executionId !== null) {
      this.dedup.set(idemKey, {
        executionId: outcome.executionId,
        expiresAt: this.now() + this.dedupTtlMs,
      })
    }

    return {
      outcome,
      idempotencyKey: idemKey,
      deduplicated: false,
    }
  }

  /** Test helper — purge expired entries. */
  prune(now: number = this.now()): number {
    let removed = 0
    for (const [k, v] of this.dedup.entries()) {
      if (v.expiresAt <= now) {
        this.dedup.delete(k)
        removed++
      }
    }
    return removed
  }

  /** For tests — registered count. */
  registrations(): number {
    return this.tokenMap.size
  }

  /** For tests — dedup cache size. */
  cacheSize(): number {
    return this.dedup.size
  }
}

function randomToken(): string {
  return Math.random().toString(36).slice(2, 10) + Math.random().toString(36).slice(2, 10)
}
