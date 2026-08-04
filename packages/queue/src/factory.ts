/**
 * Adapter factory — create the right QueueAdapter from an env descriptor.
 * Keeps selection logic in one place so callers can swap runtimes by config alone.
 */
import type { QueueAdapter } from '@cadence/domain'
import { CloudflareQueueAdapter, type CloudflareQueueBinding } from './cloudflare'
import { LocalQueueAdapter, type LocalQueueAdapterOptions } from './local'
import { EmbeddedQueueAdapter } from './embedded'

export type AdapterEnv =
  | { kind: 'cloudflare'; binding: CloudflareQueueBinding }
  | { kind: 'local'; options?: LocalQueueAdapterOptions }
  | { kind: 'embedded' }

export function createQueueAdapter(env: AdapterEnv): QueueAdapter {
  switch (env.kind) {
    case 'cloudflare':
      return new CloudflareQueueAdapter(env.binding)
    case 'local':
      return new LocalQueueAdapter(env.options)
    case 'embedded':
      return new EmbeddedQueueAdapter()
  }
}
