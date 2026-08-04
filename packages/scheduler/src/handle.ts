/**
 * @cadence/scheduler — SchedulerHandle.
 *
 * The top-level wrapper that combines all three triggers + retry policy.
 * Exposes a single `stop()` for graceful shutdown and a `status()` for
 * health checks. The two adapters (apps/api/adapters/node.ts and
 * cloudflare.ts) instantiate one of these per process.
 */
import type { StorageAdapter } from '@cadence/storage'

import type { TriggerFn } from './index.js'
import { CronTrigger } from './cron-trigger.js'
import { EventTrigger } from './event-trigger.js'
import { WebhookTrigger } from './webhook-trigger.js'
import { RetryPolicy } from './retry-policy.js'

export interface SchedulerHandleOptions {
  readonly storage: StorageAdapter
  readonly triggerFn: TriggerFn
  readonly systemActorId?: string
  readonly cron?: {
    readonly intervalMs?: number
    readonly maxRunMs?: number
  }
  readonly webhook?: {
    readonly dedupTtlMs?: number
  }
  readonly retry?: {
    readonly baseDelayMs?: number
    readonly maxDelayMs?: number
    readonly jitter?: number
  }
}

export interface SchedulerStatus {
  readonly running: boolean
  readonly cron: boolean
  readonly webhookRegistrations: number
  readonly webhookCacheSize: number
  readonly uptimeSeconds: number
}

export class SchedulerHandle {
  readonly cron: CronTrigger
  readonly events: EventTrigger
  readonly webhooks: WebhookTrigger
  readonly retry: RetryPolicy
  private readonly createdAt: number
  private cronStarted = false

  constructor(opts: SchedulerHandleOptions) {
    this.createdAt = Date.now()
    const actor = opts.systemActorId ?? 'system:scheduler'
    this.cron = new CronTrigger({
      triggerFn: opts.triggerFn,
      intervalMs: opts.cron?.intervalMs ?? 1000,
      maxRunMs: opts.cron?.maxRunMs ?? 60_000,
      systemActorId: actor,
    })
    this.events = new EventTrigger({
      triggerFn: opts.triggerFn,
      systemActorId: actor,
    })
    this.webhooks = new WebhookTrigger({
      triggerFn: opts.triggerFn,
      systemActorId: actor,
      dedupTtlMs: opts.webhook?.dedupTtlMs ?? 5 * 60_000,
    })
    this.retry = new RetryPolicy({
      baseDelayMs: opts.retry?.baseDelayMs ?? 100,
      maxDelayMs: opts.retry?.maxDelayMs ?? 60_000,
      jitter: opts.retry?.jitter ?? 0,
    })
  }

  /** Start the cron poller (idempotent). */
  async start(storage: StorageAdapter): Promise<void> {
    if (this.cronStarted) return
    this.cronStarted = true
    void this.cron.start(storage).catch(() => {
      /* swallow */
    })
  }

  async stop(): Promise<void> {
    await this.cron.stop()
    this.cronStarted = false
  }

  isRunning(): boolean {
    return this.cronStarted && this.cron.isRunning()
  }

  status(): SchedulerStatus {
    return {
      running: this.cronStarted,
      cron: this.cronStarted,
      webhookRegistrations: this.webhooks.registrations(),
      webhookCacheSize: this.webhooks.cacheSize(),
      uptimeSeconds: Math.round((Date.now() - this.createdAt) / 1000),
    }
  }
}
