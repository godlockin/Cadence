/**
 * Fake queue adapter for unit tests. FIFO in-memory.
 */
import type { QueueAdapter, QueueItem } from '@cadence/sinker'

export class FakeQueue implements QueueAdapter {
  private readonly items: QueueItem[] = []

  enqueuedItems(): readonly QueueItem[] {
    return [...this.items]
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.items.push(item)
  }

  async dequeue(): Promise<QueueItem | null> {
    return this.items.shift() ?? null
  }

  async size(): Promise<number> {
    return this.items.length
  }
}
