# Cadence Benchmarks

Environment: Node.js 24, macOS ARM, InMemoryStorageAdapter (no I/O).
Median of 5 runs, 1000 iterations per run. Lower is better for latency.

---

## AES-256-GCM Credential Encryption

| Operation       | Throughput    | p50 latency |
| --------------- | ------------- | ----------- |
| AES-GCM encrypt | ~50,379 ops/s | ~0.020ms    |
| AES-GCM decrypt | ~57,666 ops/s | ~0.017ms    |

Key derivation is cached (subsequent calls reuse the CryptoKey). First call
incurs ~0.5ms key import overhead.

---

## Trigger / Queue Throughput (InMemory, 1000 items)

| Operation                               | Throughput       | p50 latency |
| --------------------------------------- | ---------------- | ----------- |
| EmbeddedQueueAdapter enqueue (N serial) | ~8,224,766 ops/s | ~0.122ms    |
| EmbeddedQueueAdapter dequeue (N serial) | ~6,460,282 ops/s | ~0.155ms    |
| InMemory getTask (1000 rows)            | ~6,042,296 ops/s | ~0.165ms    |
| InMemory listTasks (1000 rows)          | ~3,274,212 ops/s | ~0.305ms    |

In-process queue is memory-resident → microsecond latency. `listTasks` scans
the full task Map (1000 iterations); with SQLite/D1 this would be I/O-bound.

---

## Scheduler Latency (per single call)

| Operation                 | Throughput    | p50 latency | Notes                         |
| ------------------------- | ------------- | ----------- | ----------------------------- |
| parseCron().next()        | ~18,748 ops/s | ~0.053ms    | Creates CronExpression object |
| nextFireAt()              | ~22,883 ops/s | ~0.044ms    | Wraps parseCron               |
| triggerTask (skip, allow) | ~64,453 ops/s | ~0.016ms    | DB write + audit              |
| triggerTask (skip, skip)  | ~23,994 ops/s | ~0.042ms    | List active + audit           |

`triggerTask allow` is faster than `skip` because `skip` calls
`listExecutions` first (one extra DB query). The "skip" path is dominated
by listing active executions.

---

## Storage Query Benchmarks (1000 rows seeded)

| Operation                               | Throughput    | p50 latency |
| --------------------------------------- | ------------- | ----------- |
| InMemory listTasks (no filter)          | ~23,624 ops/s | ~42.3ms     |
| InMemory listTasks (status filter)      | ~23,073 ops/s | ~43.3ms     |
| InMemory listExecutions (no filter)     | ~45,121 ops/s | ~22.2ms     |
| InMemory listExecutions (taskId filter) | ~33,440 ops/s | ~29.9ms     |

Linear scan over 1000 in-memory Map entries. With SQLite/D1: add I/O latency
(~1-5ms per query depending on disk/network).

---

## Key Observations

1. **Queue** is the fastest layer (pure in-memory, no I/O).
2. **AES-GCM** encrypt/decrypt is fast enough for per-request credential operations.
3. **triggerTask** add/remove DB writes dominate over cron parsing cost.
4. **InMemory storage** is CPU-bound on linear scans. With D1, expect ~10-50ms
   per query due to network round-trips.
5. **Concurrency skip** path is ~2x slower than allow due to extra `listExecutions` query.

---

## Running Benchmarks

```bash
# Install tsx (if not present)
pnpm add -D tsx

# Run individually
pnpm exec tsx bench/credential-encrypt.bench.ts
pnpm exec tsx bench/trigger-throughput.bench.ts
pnpm exec tsx bench/scheduler-latency.bench.ts
pnpm exec tsx bench/db-query.bench.ts
```

To reproduce numbers: run each bench 3+ times and verify within 10% variance.
Results vary by hardware, Node.js version, and system load.
