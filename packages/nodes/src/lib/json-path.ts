/**
 * @cadence/nodes — minimal JSONPath evaluator.
 *
 * Implements the JSONPath subset used by the `jsonpath-assert` and
 * `transform-jsonpath`-style nodes:
 *   - `$` root
 *   - `.name` / `['name']` child access
 *   - `[N]` array index (supports negative indexing)
 *   - `[*]` array wildcard, `.*` object wildcard
 *   - `..name` deep scan
 *   - `[1,2]` index union
 *   - `[?(@.field OP value)]` filters: `==`, `!=`, `<`, `<=`, `>`, `>=`,
 *     `=~` (regex) against primitives
 *
 * Full JSONPath (filters with functions, slices, scripts) is intentionally
 * out of scope; TODO in a future phase can swap in `jsonpath-plus`.
 */

export type JsonPathToken =
  | { kind: 'child'; key: string }
  | { kind: 'index'; index: number }
  | { kind: 'wildcard' }
  | { kind: 'deep'; key: string }
  | { kind: 'union'; indices: readonly number[] }
  | { kind: 'filter'; op: FilterOp; field: string; value: unknown }

export type FilterOp = '==' | '!=' | '<' | '<=' | '>' | '>=' | '=~'

export interface FilterCriterion {
  readonly op: FilterOp
  readonly field: string
  readonly value: unknown
}

interface Segment {
  readonly type: 'child' | 'index' | 'wildcard' | 'deep' | 'union' | 'filter'
  readonly key?: string
  readonly index?: number
  readonly indices?: readonly number[]
  readonly filter?: FilterCriterion
}

/** Throw a typed error for malformed paths so nodes can surface it cleanly. */
export class JsonPathError extends Error {
  constructor(
    public readonly path: string,
    public readonly reason: string,
  ) {
    super(`Invalid JSONPath '${path}': ${reason}`)
    this.name = 'JsonPathError'
  }
}

/** Parse a JSONPath string into segments. Throws JsonPathError on bad syntax. */
export function parseJsonPath(path: string): readonly Segment[] {
  if (path === '') return []
  if (path === '$') return []
  if (!path.startsWith('$')) {
    throw new JsonPathError(path, 'must start with $')
  }
  let rest = path.slice(1)
  const segments: Segment[] = []
  while (rest.length > 0) {
    if (rest.startsWith('..')) {
      rest = rest.slice(2)
      const key = readBareKey(rest)
      if (key === '') throw new JsonPathError(path, 'deep scan requires a key')
      rest = rest.slice(key.length)
      segments.push({ type: 'deep', key })
      continue
    }
    if (rest.startsWith('.')) {
      rest = rest.slice(1)
      if (rest.startsWith('*')) {
        rest = rest.slice(1)
        segments.push({ type: 'wildcard' })
        continue
      }
      const key = readBareKey(rest)
      if (key === '') throw new JsonPathError(path, 'expected a property name after .')
      rest = rest.slice(key.length)
      segments.push({ type: 'child', key })
      continue
    }
    if (rest.startsWith('[')) {
      const end = findClosingBracket(rest)
      if (end === -1) throw new JsonPathError(path, 'unterminated [')
      const inner = rest.slice(1, end)
      rest = rest.slice(end + 1)
      segments.push(parseBracketSegment(inner, path))
      continue
    }
    throw new JsonPathError(path, `unexpected character '${rest[0]}'`)
  }
  return segments
}

function readBareKey(rest: string): string {
  const m = /^[A-Za-z_$][A-Za-z0-9_$-]*/.exec(rest)
  return m?.[0] ?? ''
}

function findClosingBracket(s: string): number {
  if (s[1] === '?') {
    /* filter — find matching ] ignoring nested quotes and parens */
    let depth = 0
    let quote: string | null = null
    for (let i = 1; i < s.length; i += 1) {
      const c = s[i]
      if (quote) {
        if (c === quote) quote = null
        continue
      }
      if (c === "'" || c === '"') quote = c
      else if (c === '(') depth += 1
      else if (c === ')') depth -= 1
      else if (c === ']' && depth <= 0) return i
    }
    return -1
  }
  let quote: string | null = null
  for (let i = 1; i < s.length; i += 1) {
    const c = s[i]
    if (quote) {
      if (c === quote) quote = null
      continue
    }
    if (c === "'" || c === '"') quote = c
    else if (c === ']') return i
  }
  return -1
}

function parseBracketSegment(inner: string, fullPath: string): Segment {
  const trimmed = inner.trim()
  if (trimmed === '') throw new JsonPathError(fullPath, 'empty []')
  if (trimmed === '*') return { type: 'wildcard' }
  if (trimmed.startsWith('?')) {
    const expr = trimmed.slice(1).trim()
    return { type: 'filter', filter: parseFilter(expr, fullPath) }
  }
  if (trimmed.startsWith("'") || trimmed.startsWith('"')) {
    const key = parseQuoted(trimmed)
    return { type: 'child', key }
  }
  if (trimmed.includes(',')) {
    const indices: number[] = []
    for (const part of trimmed.split(',')) {
      const n = Number(part.trim())
      if (!Number.isInteger(n))
        throw new JsonPathError(fullPath, `union must be integers, got '${part}'`)
      indices.push(n)
    }
    return { type: 'union', indices }
  }
  const n = Number(trimmed)
  if (!Number.isInteger(n))
    throw new JsonPathError(fullPath, `expected index or filter, got '${trimmed}'`)
  return { type: 'index', index: n }
}

function parseQuoted(s: string): string {
  const q = s[0]
  if (q !== "'" && q !== '"') throw new JsonPathError(s, 'bad quoted key')
  const end = s.lastIndexOf(q)
  return s.slice(1, end)
}

const FILTER_OPS: readonly FilterOp[] = ['==', '!=', '<=', '>=', '<', '>', '=~']

function parseFilter(expr: string, fullPath: string): FilterCriterion {
  if (!expr.startsWith('@'))
    throw new JsonPathError(fullPath, `filter must reference @, got '${expr}'`)
  /* find the operator that splits the field path from the literal */
  let op: FilterOp | null = null
  let opIndex = -1
  for (const candidate of FILTER_OPS) {
    const idx = expr.indexOf(candidate, 1)
    if (
      idx !== -1 &&
      (op === null || idx < opIndex || (idx === opIndex && candidate.length > op.length))
    ) {
      op = candidate
      opIndex = idx
    }
  }
  if (op === null) throw new JsonPathError(fullPath, `filter has no operator: '${expr}'`)
  const left = expr.slice(1, opIndex).trim() // e.g. .status or ['status']
  const right = expr.slice(opIndex + op.length).trim()
  const field = parseFilterField(left, fullPath)
  return { op, field, value: parseLiteral(right, fullPath) }
}

function parseFilterField(left: string, fullPath: string): string {
  if (left.startsWith("['") && left.endsWith("']")) return left.slice(2, -2)
  if (left.startsWith('.')) return left.slice(1)
  throw new JsonPathError(fullPath, `unsupported filter field '${left}'`)
}

function parseLiteral(raw: string, fullPath: string): unknown {
  if (raw === 'true') return true
  if (raw === 'false') return false
  if (raw === 'null') return null
  if ((raw.startsWith("'") && raw.endsWith("'")) || (raw.startsWith('"') && raw.endsWith('"'))) {
    return raw.slice(1, -1)
  }
  if (/^\/.+\/$/.test(raw)) return new RegExp(raw.slice(1, -1))
  const n = Number(raw)
  if (!Number.isNaN(n)) return n
  throw new JsonPathError(fullPath, `unsupported filter literal '${raw}'`)
}

/** Evaluate a parsed path against a value, returning all matches. */
export function evaluateJsonPath(path: string, value: unknown): unknown[] {
  const segments = parseJsonPath(path)
  return walk(segments, 0, value)
}

function walk(segments: readonly Segment[], i: number, value: unknown): unknown[] {
  if (i >= segments.length) return [value]
  const seg = segments[i]
  if (seg === undefined) return []
  switch (seg.type) {
    case 'child': {
      if (value === null || typeof value !== 'object') return []
      const obj = value as unknown as Record<string, unknown>
      if (!(seg.key !== undefined && seg.key in obj)) return []
      return walk(segments, i + 1, obj[seg.key as string])
    }
    case 'index': {
      if (!Array.isArray(value)) return []
      const idx = (seg.index ?? 0) < 0 ? value.length + (seg.index ?? 0) : (seg.index ?? 0)
      const el = value[idx]
      return el === undefined ? [] : walk(segments, i + 1, el)
    }
    case 'union': {
      const out: unknown[] = []
      if (Array.isArray(value)) {
        for (const idx of seg.indices ?? []) {
          const el = value[idx < 0 ? value.length + idx : idx]
          if (el !== undefined) out.push(...walk(segments, i + 1, el))
        }
      }
      return out
    }
    case 'wildcard': {
      const out: unknown[] = []
      if (Array.isArray(value)) {
        for (const el of value) out.push(...walk(segments, i + 1, el))
      } else if (value !== null && typeof value === 'object') {
        for (const v of Object.values(value as unknown as Record<string, unknown>)) {
          out.push(...walk(segments, i + 1, v))
        }
      }
      return out
    }
    case 'deep': {
      const out: unknown[] = []
      collectDeep(value, seg.key ?? '', segments, i + 1, out)
      return out
    }
    case 'filter': {
      if (!Array.isArray(value)) return []
      const crit = seg.filter
      if (!crit) return []
      const out: unknown[] = []
      for (const el of value) {
        if (matchesFilter(el, crit)) out.push(...walk(segments, i + 1, el))
      }
      return out
    }
  }
}

function collectDeep(
  value: unknown,
  key: string,
  segments: readonly Segment[],
  next: number,
  out: unknown[],
): void {
  if (value === null || typeof value !== 'object') return
  if (Array.isArray(value)) {
    for (const el of value) {
      if (el !== null && typeof el === 'object') collectDeep(el, key, segments, next, out)
    }
    return
  }
  const obj = value as unknown as Record<string, unknown>
  if (key in obj) out.push(...walk(segments, next, obj[key]))
  for (const v of Object.values(obj)) {
    if (v !== null && typeof v === 'object') collectDeep(v, key, segments, next, out)
  }
}

function matchesFilter(el: unknown, crit: FilterCriterion): boolean {
  if (el === null || typeof el !== 'object') return false
  const obj = el as unknown as Record<string, unknown>
  if (!(crit.field in obj)) return false
  const actual = obj[crit.field]
  return compare(actual, crit.value, crit.op)
}

function compare(actual: unknown, expected: unknown, op: FilterOp): boolean {
  switch (op) {
    case '==':
      return actual === expected
    case '!=':
      return actual !== expected
    case '<':
      return typeof actual === 'number' && typeof expected === 'number' && actual < expected
    case '<=':
      return typeof actual === 'number' && typeof expected === 'number' && actual <= expected
    case '>':
      return typeof actual === 'number' && typeof expected === 'number' && actual > expected
    case '>=':
      return typeof actual === 'number' && typeof expected === 'number' && actual >= expected
    case '=~':
      return expected instanceof RegExp && typeof actual === 'string' && expected.test(actual)
  }
}
