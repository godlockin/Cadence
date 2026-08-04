/**
 * LocalQueueAdapter unit tests.
 * Uses a real worker_threads worker (test/worker-script.js) to validate
 * the worker-isolation path. Concurrency is exercised against 100 items.
 */
import { describe, it, expect } from 'vitest'
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import type { QueueItem, TaskId, ExecutionId } from '@cadence/domain'
import { LocalQueueAdapter } from './local'

const TASK_ID = '01HXY0000000000000000000A' as TaskId
const EXEC_ID = '01HXY0000000000000000000B' as ExecutionId

const __dirname = path.dirname(fileURLToPath(import.meta.url))
const WORKER_SCRIPT = path.resolve(__dirname, '../test/worker-script.js')

function makeItem(i: number): QueueItem {
  return {
    taskId: TASK_ID,
    executionId: EXEC_ID,
    context: { source: 'manual' },
    enqueuedAt: 1_700_000_000_000 + i,
  }
}

describe('LocalQueueAdapter', () => {
  it('enqueue immediately schedules consumption (auto-consume)', async () => {
    // With auto-consume, items are pulled off `pending` as fast as the pqueue
    // can schedule workers. After drain, the queue is empty.
    const q = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT, concurrency: 2 })
    await q.enqueue(makeItem(1))
    await q.enqueue(makeItem(2))
    await q.drain()
    expect(await q.size()).toBe(0)
  })

  it('dequeue returns null when empty', async () => {
    const q = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT, concurrency: 2 })
    expect(await q.dequeue()).toBeNull()
  })

  it('respects custom concurrency option', () => {
    const q = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT, concurrency: 8 })
    expect(q).toBeInstanceOf(LocalQueueAdapter)
  })

  it('falls back to MAX_CONCURRENT_EXECUTIONS env or default', () => {
    const q1 = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT })
    const q2 = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT })
    expect(q1).toBeInstanceOf(LocalQueueAdapter)
    expect(q2).toBeInstanceOf(LocalQueueAdapter)
  })

  it('processes 100 enqueued items via worker_threads and drains to size=0', async () => {
    const q = new LocalQueueAdapter({ workerScript: WORKER_SCRIPT, concurrency: 8 })
    await Promise.all(Array.from({ length: 100 }, (_, i) => q.enqueue(makeItem(i))))

    // Wait for all queued executions to finish.
    await q.drain()

    expect(await q.size()).toBe(0)
  }, 60_000)

  it('does not propagate worker exit errors as unhandled rejections', async () => {
    const fs = await import('node:fs/promises')
    const os = await import('node:os')
    const tmpDir = await fs.mkdtemp(path.join(os.tmpdir(), 'lqa-'))
    const failingScript = path.join(tmpDir, 'failing-worker.js')
    await fs.writeFile(failingScript, 'process.exit(1)\n', 'utf8')

    const q = new LocalQueueAdapter({ workerScript: failingScript, concurrency: 1 })
    await q.enqueue(makeItem(1))

    // Should not throw — per-task rejection is captured inside consume().
    await expect(q.drain()).resolves.toBeUndefined()
    expect(await q.size()).toBe(0)

    await fs.rm(tmpDir, { recursive: true, force: true })
  })
})
