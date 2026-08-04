# `@cadence/queue`

QueueAdapter port + three concrete implementations for PulseDeck:

- **`EmbeddedQueueAdapter`** — pure in-memory FIFO (tests, dev)
- **`LocalQueueAdapter`** — Node.js in-process queue with bounded concurrency + `worker_threads`
- **`CloudflareQueueAdapter`** — CF Queues producer (push-based consumer lives in the worker handler)

The `QueueAdapter` interface lives in `@cadence/domain` (extracted from `@cadence/sinker` to break the sinker↔queue package cycle):

```ts
interface QueueAdapter {
  enqueue(item: QueueItem): Promise<void>
  dequeue(): Promise<QueueItem | null>
  size(): Promise<number>
}
```

## When to use which

| Adapter      | Use case                            | Durability          | Concurrency model        | Recommended env    |
| ------------ | ----------------------------------- | ------------------- | ------------------------ | ------------------ |
| `Embedded`   | unit tests, single-process dev      | none (lost on exit) | N/A                      | node, tests        |
| `Local`      | self-hosted node, integration tests | none                | `p-queue` worker_threads | node               |
| `Cloudflare` | production Cloudflare deploy        | CF Queues (durable) | consumer-side via DO     | Cloudflare Workers |

## Usage

### Embedded (tests / dev)

```ts
import { EmbeddedQueueAdapter } from '@cadence/queue'

const q = new EmbeddedQueueAdapter()
await q.enqueue({ taskId, executionId, context, enqueuedAt: Date.now() })
const item = await q.dequeue()
```

### Local (self-hosted node)

```ts
import { LocalQueueAdapter } from '@cadence/queue'

const q = new LocalQueueAdapter({
  workerScript: './dist/worker-script.js', // your worker entry
  concurrency: 8, // defaults to MAX_CONCURRENT_EXECUTIONS or 4
})

await q.enqueue(item)
// After all enqueues:
await q.drain()
```

`workerData` can be customized via the `workerData` option to transform the
`QueueItem` before it's posted to the worker.

### Cloudflare

```ts
import { CloudflareQueueAdapter } from '@cadence/queue'

const q = new CloudflareQueueAdapter(env.MY_QUEUE)
await q.enqueue(item)
// dequeue() returns null — CF Queues is push-based; consumption happens
// in your worker fetch handler via binding.consumer.batch().
```

The `CloudflareQueueBinding` interface is intentionally minimal so consumers
don't need to pull in `@cloudflare/workers-types`. Provide any object that
exposes a `producer.send(body)` method and a `consumer` namespace.

### Factory

```ts
import { createQueueAdapter } from '@cadence/queue'

const q = createQueueAdapter({ kind: 'local', options: { concurrency: 8 } })
// or { kind: 'cloudflare', binding: env.MY_QUEUE }
// or { kind: 'embedded' }
```

## Performance

| Adapter    | Throughput         | Latency         | Memory             | Notes                    |
| ---------- | ------------------ | --------------- | ------------------ | ------------------------ |
| Embedded   | ~10M ops/s         | <1µs            | O(n)               | bounded by JS array perf |
| Local      | ~1-5K ops/s        | 5-50ms per item | bounded by p-queue | depends on worker cost   |
| Cloudflare | depends on CF plan | push latency    | O(0) client-side   | batching recommended     |

Embedded is for tests only — it will lose data on restart. Local is for dev and
self-hosted deployments where you accept in-memory loss on crash. Cloudflare
is the production-grade path with full durability.

## Implementation notes

- `LocalQueueAdapter` auto-consumes on `enqueue()`. After all enqueues, call
  `drain()` to await completion. Worker errors are captured per-task and do not
  surface as unhandled rejections.
- `CloudflareQueueAdapter.dequeue()` returns `null` because CF Queues is
  push-based. `size()` returns `-1` since the binding API doesn't expose depth.
