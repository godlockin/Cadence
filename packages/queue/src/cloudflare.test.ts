/**
 * CloudflareQueueAdapter contract tests.
 * No real CF runtime — we feed it a fake binding that records calls.
 */
import { describe, it, expect } from 'vitest'
import type { QueueItem, TaskId, ExecutionId } from '@cadence/domain'
import { CloudflareQueueAdapter, type CloudflareQueueBinding } from './cloudflare'

const TASK_ID = '01HXY0000000000000000000A' as TaskId
const EXEC_ID = '01HXY0000000000000000000B' as ExecutionId

function makeItem(i: number): QueueItem {
  return {
    taskId: TASK_ID,
    executionId: EXEC_ID,
    context: { source: 'cron' },
    enqueuedAt: 1_700_000_000_000 + i,
  }
}

interface FakeBinding extends CloudflareQueueBinding {
  sent: string[]
}

function makeFakeBinding(): FakeBinding {
  const sent: string[] = []
  return {
    sent,
    producer: {
      async send(body: string): Promise<void> {
        sent.push(body)
      },
    },
    consumer: {
      id: { toString: () => 'fake-consumer-id' },
    },
  }
}

describe('CloudflareQueueAdapter', () => {
  it('enqueue calls producer.send with JSON-serialized item', async () => {
    const binding = makeFakeBinding()
    const q = new CloudflareQueueAdapter(binding)
    await q.enqueue(makeItem(1))
    expect(binding.sent).toHaveLength(1)
    expect(JSON.parse(binding.sent[0]!)).toMatchObject({
      taskId: TASK_ID,
      executionId: EXEC_ID,
      enqueuedAt: 1_700_000_000_001,
    })
  })

  it('enqueue forwards producer.send errors', async () => {
    const binding: CloudflareQueueBinding = {
      producer: {
        send(): Promise<void> {
          return Promise.reject(new Error('CF 503'))
        },
      },
      consumer: { id: { toString: () => 'x' } },
    }
    const q = new CloudflareQueueAdapter(binding)
    await expect(q.enqueue(makeItem(1))).rejects.toThrow('CF 503')
  })

  it('dequeue returns null (push-based consumption lives in worker handler)', async () => {
    const q = new CloudflareQueueAdapter(makeFakeBinding())
    expect(await q.dequeue()).toBeNull()
  })

  it('size returns -1 (depth not exposed by CF binding)', async () => {
    const q = new CloudflareQueueAdapter(makeFakeBinding())
    expect(await q.size()).toBe(-1)
  })

  it('round-trips 100 enqueues preserving order via serialized body', async () => {
    const binding = makeFakeBinding()
    const q = new CloudflareQueueAdapter(binding)
    for (let i = 0; i < 100; i++) {
      await q.enqueue(makeItem(i))
    }
    expect(binding.sent).toHaveLength(100)
    const first = JSON.parse(binding.sent[0]!)
    const last = JSON.parse(binding.sent[99]!)
    expect(first.enqueuedAt).toBe(1_700_000_000_000)
    expect(last.enqueuedAt).toBe(1_700_000_000_099)
  })
})
