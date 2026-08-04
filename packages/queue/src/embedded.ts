/**
 * Embedded QueueAdapter — pure in-memory FIFO.
 * Use cases: unit tests, integration tests, single-process development.
 * NOT for production. Data lost on process exit.
 */
import type { QueueAdapter, QueueItem } from '@cadence/domain'

export class EmbeddedQueueAdapter implements QueueAdapter {
  private readonly items: QueueItem[] = []

  async enqueue(item: QueueItem): Promise<void> {
    this.items.push(item)
  }

  async dequeue(): Promise<QueueItem | null> {
    const item = this.items.shift()
    return item ?? null
  }

  async size(): Promise<number> {
    return this.items.length
  }

  /** Test helper — drain everything currently queued. */
  drain(): Promise<QueueItem[]> {
    const snapshot = this.items.splice(0, this.items.length)
    return Promise.resolve(snapshot)
  }

  /** Test helper — peek without consuming. */
  peekAll(): Promise<readonly QueueItem[]> {
    return Promise.resolve([...this.items])
  }
}
