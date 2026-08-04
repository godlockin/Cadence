/**
 * Cloudflare QueueAdapter — wraps CF Queues + Durable Object consumer.
 *
 * Semantics note: CF Queues is push-based. Producers call `binding.producer.send()`,
 * and consumers are wired up via `binding.consumer.batch()` inside a Worker fetch
 * handler. The `enqueue()` method maps to `producer.send()`.
 *
 * `dequeue()` returns null because polling semantics don't apply — actual consumption
 * happens in the Worker handler. `size()` returns -1 (unknown) since CF Queues
 * doesn't expose a depth metric from the binding API.
 */
import type { QueueAdapter, QueueItem } from '@cadence/domain'

/**
 * Minimal CF Queues binding types (avoid pulling `@cloudflare/workers-types`
 * into Node-only consumers — interface kept narrow).
 */
export interface CloudflareQueueBinding {
  /** CF Queue producer — has `.send(body, options?)`. */
  readonly producer: {
    send(body: string, options?: { contentType?: string; delaySeconds?: number }): Promise<void>
  }
  /** Durable Object namespace for the consumer side (typed minimally). */
  readonly consumer: {
    readonly id: { toString(): string }
    readonly name?: string
  }
}

export class CloudflareQueueAdapter implements QueueAdapter {
  constructor(private readonly binding: CloudflareQueueBinding) {}

  async enqueue(item: QueueItem): Promise<void> {
    await this.binding.producer.send(JSON.stringify(item))
  }

  async dequeue(): Promise<QueueItem | null> {
    // CF Queues is push-based; consumption happens in the Worker handler
    // via `binding.consumer.batch()`. Polling semantics don't apply here.
    return null
  }

  async size(): Promise<number> {
    // CF Queues doesn't expose a depth metric from the binding API.
    // -1 signals "unknown" to callers without forcing an HTTP round-trip.
    return -1
  }
}
