/**
 * @cadence/nodes — data-merge (left + right join) helpers.
 */

export interface Row {
  readonly [k: string]: unknown
}

export type JoinType = 'left' | 'inner' | 'right'

/**
 * Join two arrays of objects on a key.
 *
 * - `left`: keep every left row; unmatched right columns come back as `null`.
 * - `inner`: only rows that match on both sides.
 * - `right`: keep every right row; unmatched left columns come back as `null`.
 *
 * When multiple right rows share a key, each left row produces one combined
 * row per right match (standard fan-out).
 */
export function joinRows(
  left: readonly Row[],
  right: readonly Row[],
  leftKey: string,
  rightKey: string,
  type: JoinType,
): Row[] {
  const rightIndex = new Map<string, Row[]>()
  for (const row of right) {
    const k = keyValue(row, rightKey)
    const bucket = rightIndex.get(k)
    if (bucket) bucket.push(row)
    else rightIndex.set(k, [row])
  }

  if (type === 'right') {
    const out: Row[] = []
    const matched = new Set<string>()
    for (const r of right) {
      const k = keyValue(r, rightKey)
      matched.add(k)
      const matches = left.filter((l) => keyValue(l, leftKey) === k)
      if (matches.length === 0) {
        out.push({ ...blankLike(left[0]), ...r })
      } else {
        for (const l of matches) out.push({ ...l, ...r })
      }
    }
    return out
  }

  const out: Row[] = []
  for (const l of left) {
    const k = keyValue(l, leftKey)
    const matches = rightIndex.get(k)
    if (!matches || matches.length === 0) {
      if (type === 'left') out.push({ ...l, ...blankLike(right[0]) })
      continue
    }
    for (const r of matches) out.push({ ...l, ...r })
  }
  return out
}

function keyValue(row: Row, key: string): string {
  const v = row[key]
  if (v === undefined || v === null) return '__pulsedeck_null__'
  if (typeof v === 'object') return JSON.stringify(v)
  return String(v)
}

function blankLike(sample: Row | undefined): Row {
  if (sample === undefined) return {}
  const out: Record<string, unknown> = {}
  for (const key of Object.keys(sample)) out[key] = null
  return out
}
