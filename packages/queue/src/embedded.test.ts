/**
 * EmbeddedQueueAdapter unit tests.
 */
import { describe, it, expect } from 'vitest'
import type { QueueItem, TaskId, ExecutionId } from '@cadence/domain'
import { EmbeddedQueueAdapter } from './embedded'

const TASK_ID = '01HXY0000000000000000000A' as TaskId
const EXEC_ID = '01HXY0000000000000000000B' as ExecutionId

function makeItem(i: number): QueueItem {
  return {
    taskId: TASK_ID,
    executionId: EXEC_ID,
    context: { source: 'manual' },
    enqueuedAt: 1_700_000_000_000 + i,
  }
}

describe('EmbeddedQueueAdapter', () => {
  it('enqueue + dequeue returns FIFO order', async () => {
    const q = new EmbeddedQueueAdapter()
    await q.enqueue(makeItem(1))
    await q.enqueue(makeItem(2))
    await q.enqueue(makeItem(3))

    const a = await q.dequeue()
    const b = await q.dequeue()
    const c = await q.dequeue()
    expect(a?.enqueuedAt).toBe(1_700_000_000_001)
    expect(b?.enqueuedAt).toBe(1_700_000_000_002)
    expect(c?.enqueuedAt).toBe(1_700_000_000_003)
  })

  it('size tracks pending count', async () => {
    const q = new EmbeddedQueueAdapter()
    expect(await q.size()).toBe(0)
    await q.enqueue(makeItem(1))
    await q.enqueue(makeItem(2))
    expect(await q.size()).toBe(2)
    await q.dequeue()
    expect(await q.size()).toBe(1)
  })

  it('dequeue returns null when empty', async () => {
    const q = new EmbeddedQueueAdapter()
    expect(await q.dequeue()).toBeNull()
  })

  it('drain returns all items and empties queue', async () => {
    const q = new EmbeddedQueueAdapter()
    await q.enqueue(makeItem(1))
    await q.enqueue(makeItem(2))

    const drained = await q.drain()
    expect(drained).toHaveLength(2)
    expect(await q.size()).toBe(0)
    expect(await q.dequeue()).toBeNull()
  })

  it('peekAll returns snapshot without consuming', async () => {
    const q = new EmbeddedQueueAdapter()
    await q.enqueue(makeItem(1))
    await q.enqueue(makeItem(2))

    const peek = await q.peekAll()
    expect(peek).toHaveLength(2)
    expect(await q.size()).toBe(2)
  })

  it('handles 100 concurrent enqueues correctly', async () => {
    const q = new EmbeddedQueueAdapter()
    await Promise.all(Array.from({ length: 100 }, (_, i) => q.enqueue(makeItem(i))))
    expect(await q.size()).toBe(100)

    let consumed = 0
    while ((await q.dequeue()) !== null) consumed++
    expect(consumed).toBe(100)
    expect(await q.size()).toBe(0)
  })
})
