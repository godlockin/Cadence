/**
 * Local QueueAdapter — Node.js in-process queue with bounded concurrency.
 *
 * Uses `p-queue` for concurrency control (env: MAX_CONCURRENT_EXECUTIONS, default 4)
 * and `worker_threads` to isolate execution per item. The worker script path is
 * configurable via `workerScript` option (defaults to './worker-script.js').
 *
 * Use cases: local dev, self-hosted node deployment, integration tests
 * that need real concurrency but no cross-process durability.
 */
import { Worker } from 'node:worker_threads'
import PQueue from 'p-queue'
import type { QueueAdapter, QueueItem } from '@cadence/domain'

export interface LocalQueueAdapterOptions {
  /** Path to worker entry script (executed per item). Default: './worker-script.js'. */
  workerScript?: string
  /** Max concurrent worker executions. Default: process.env.MAX_CONCURRENT_EXECUTIONS ?? 4. */
  concurrency?: number
  /** Optional worker data factory — receives the QueueItem. Default: passes item as-is. */
  workerData?: (item: QueueItem) => unknown
}

export class LocalQueueAdapter implements QueueAdapter {
  private readonly pending: QueueItem[] = []
  private readonly pqueue: PQueue
  private readonly workerScript: string
  private readonly workerData: (item: QueueItem) => unknown

  constructor(options: LocalQueueAdapterOptions = {}) {
    const concurrency =
      options.concurrency ??
      (process.env['MAX_CONCURRENT_EXECUTIONS']
        ? Number(process.env['MAX_CONCURRENT_EXECUTIONS'])
        : 4)
    this.pqueue = new PQueue({ concurrency })
    this.workerScript = options.workerScript ?? './worker-script.js'
    this.workerData = options.workerData ?? ((item: QueueItem) => item)
  }

  async enqueue(item: QueueItem): Promise<void> {
    this.pending.push(item)
    void this.consume()
  }

  async dequeue(): Promise<QueueItem | null> {
    return this.pending.shift() ?? null
  }

  async size(): Promise<number> {
    return this.pending.length
  }

  /** Test/admin helper — wait for all currently-queued items to finish executing. */
  async drain(): Promise<void> {
    await this.pqueue.onIdle()
  }

  private async consume(): Promise<void> {
    const item = await this.dequeue()
    if (!item) return
    // Capture per-task rejection so worker failures don't crash the consumer.
    await this.pqueue.add(() => this.runWorker(item)).catch(() => undefined)
  }

  private async runWorker(item: QueueItem): Promise<void> {
    const data = this.workerData(item)
    const worker = new Worker(this.workerScript, { workerData: data })
    await new Promise<void>((resolve, reject) => {
      worker.once('exit', (code) => (code === 0 ? resolve() : reject(new Error(`exit ${code}`))))
      worker.once('error', reject)
    })
  }
}
