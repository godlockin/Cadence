/**
 * @cadence/scheduler — EventTrigger.
 *
 * In-process pub/sub: tasks subscribe to topics (encoded in `trigger_config_json`)
 * via storage rows. `publish(topic, payload)` resolves the subscriptions and
 * triggers every matching task in parallel.
 *
 * No durable queue — purely Node-side. The Webhook and Cron triggers follow
 * the same rules; durable retry/back-pressure belong to the queue layer.
 */
import type { StorageAdapter } from '@cadence/storage'
import type { Task, TriggerContext } from '@cadence/domain'

import type { TriggerFn } from './index.js'
import { triggerTask, type TriggerOutcome } from './trigger.js'

export interface EventTriggerOptions {
  readonly triggerFn: TriggerFn
  readonly systemActorId?: string
}

export class EventTrigger {
  private readonly triggerFn: TriggerFn
  private readonly systemActorId: string

  constructor(opts: EventTriggerOptions) {
    this.triggerFn = opts.triggerFn
    this.systemActorId = opts.systemActorId ?? 'system:event'
  }

  /**
   * Publish an event: every task whose `trigger_config_json` carries a
   * matching `topic` is fired in parallel.
   */
  async publish(
    storage: StorageAdapter,
    topic: string,
    payload: Record<string, unknown>,
  ): Promise<TriggerOutcome[]> {
    if (typeof topic !== 'string' || topic.length === 0) {
      throw new TypeError('EventTrigger.publish: topic must be a non-empty string')
    }
    const candidates = await storage.listTasks({
      triggerKind: 'event',
      status: 'scheduled',
    })
    const matched: Task[] = []
    for (const t of candidates) {
      const cfg = parseTopic(t)
      if (cfg === topic) matched.push(t)
    }
    return await Promise.all(
      matched.map((task) => {
        const ctx: TriggerContext = {
          source: 'event',
          triggeredBy: this.systemActorId,
          payload: { topic, ...payload },
        }
        return triggerTask(storage, this.triggerFn, task.id, ctx, this.systemActorId)
      }),
    )
  }
}

/** Extract the topic from a Task's `trigger_config_json`. */
export function parseTopic(task: Task): string | null {
  if (task.trigger_kind !== 'event') return null
  try {
    const raw = JSON.parse(task.trigger_config_json) as unknown
    if (raw !== null && typeof raw === 'object') {
      const obj = raw as Record<string, unknown>
      if (typeof obj['topic'] === 'string') return obj['topic']
    }
  } catch {
    /* malformed */
  }
  return null
}
