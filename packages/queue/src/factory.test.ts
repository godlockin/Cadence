/**
 * createQueueAdapter factory tests.
 */
import { describe, it, expect } from 'vitest'
import { createQueueAdapter } from './factory'
import { EmbeddedQueueAdapter } from './embedded'
import { LocalQueueAdapter } from './local'
import { CloudflareQueueAdapter } from './cloudflare'

describe('createQueueAdapter', () => {
  it('returns EmbeddedQueueAdapter for kind=embedded', () => {
    const q = createQueueAdapter({ kind: 'embedded' })
    expect(q).toBeInstanceOf(EmbeddedQueueAdapter)
  })

  it('returns LocalQueueAdapter for kind=local', () => {
    const q = createQueueAdapter({ kind: 'local', options: { concurrency: 2 } })
    expect(q).toBeInstanceOf(LocalQueueAdapter)
  })

  it('returns CloudflareQueueAdapter for kind=cloudflare', () => {
    const q = createQueueAdapter({
      kind: 'cloudflare',
      binding: {
        producer: { send: () => Promise.resolve() },
        consumer: { id: { toString: () => 'x' } },
      },
    })
    expect(q).toBeInstanceOf(CloudflareQueueAdapter)
  })
})
