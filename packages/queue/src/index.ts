/**
 * @cadence/queue — QueueAdapter port + adapter implementations.
 *
 * Adapters:
 *   - EmbeddedQueueAdapter  pure in-memory FIFO (tests, dev)
 *   - LocalQueueAdapter     Node.js with bounded concurrency + worker_threads
 *   - CloudflareQueueAdapter CF Queues producer (push-based consumer lives in worker handler)
 *
 * Use `createQueueAdapter(env)` to select via config.
 *
 * NOTE: `QueueAdapter` and `QueueItem` were extracted from @cadence/sinker
 * into @cadence/domain (single source of truth). We re-export them here
 * for convenience; the canonical home is @cadence/domain.
 */
export type { QueueAdapter, QueueItem } from '@cadence/domain'

export { EmbeddedQueueAdapter } from './embedded'
export { LocalQueueAdapter, type LocalQueueAdapterOptions } from './local'
export { CloudflareQueueAdapter, type CloudflareQueueBinding } from './cloudflare'
export { createQueueAdapter, type AdapterEnv } from './factory'

export const QUEUE_VERSION = '0.1.0'
