/**
 * @cadence/nodes — in-memory Prometheus-style metric registry.
 *
 * `metric-emit` increments named counters and stores label sets. A zero-dep
 * stand-in for `prom-client`; the registry is a plain module-level store so
 * tests can inspect counters and a future exporter can scrape them.
 */

export interface MetricCounter {
  readonly name: string
  readonly help: string
  readonly labels: Readonly<Record<string, string>>
  value: number
}

const counters = new Map<string, MetricCounter>()

function keyOf(name: string, labels: Readonly<Record<string, string>>): string {
  const labelPart = Object.keys(labels)
    .sort()
    .map((k) => `${k}="${labels[k] ?? ''}"`)
    .join(',')
  return labelPart.length > 0 ? `${name}{${labelPart}}` : name
}

/** Increment a counter by `delta` (default 1) and return its new value. */
export function incrementCounter(
  name: string,
  help: string,
  labels: Readonly<Record<string, string>>,
  delta = 1,
): number {
  const key = keyOf(name, labels)
  const existing = counters.get(key)
  if (existing) {
    existing.value += delta
    return existing.value
  }
  const created: MetricCounter = { name, help, labels, value: delta }
  counters.set(key, created)
  return created.value
}

/** Snapshot all registered counters (sorted by key for deterministic tests). */
export function snapshotCounters(): MetricCounter[] {
  return [...counters.entries()]
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    .map(([, c]) => ({ name: c.name, help: c.help, labels: { ...c.labels }, value: c.value }))
}

/** Reset the registry (test isolation). */
export function resetCounters(): void {
  counters.clear()
}
