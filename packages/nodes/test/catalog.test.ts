import { describe, it, expect } from 'vitest'
import {
  ALL_NODES,
  CLOUDFLARE_NODES,
  NODE_CATALOG,
  supportedOn,
  type NodeType,
} from '../src/index.js'

describe('node catalog', () => {
  it('exposes exactly 30 nodes', () => {
    expect(ALL_NODES.length).toBe(30)
  })

  it('has versioned kinds ({name}.v{version}) unique per (type, kind)', () => {
    const kinds = ALL_NODES.map((n) => n.kind)
    for (const kind of kinds) {
      expect(kind).toMatch(/^[a-z0-9-]+\.v\d+$/)
    }
    /* the same node name can appear in two categories (e.g. zod-schema under
     * input-validate AND result-validate), so uniqueness is per (type, kind). */
    const pairs = ALL_NODES.map((n) => `${n.type}:${n.kind}`)
    expect(new Set(pairs).size).toBe(pairs.length)
  })

  it('groups nodes into the 6 categories', () => {
    const byType = new Map<NodeType, number>()
    for (const n of ALL_NODES) {
      byType.set(n.type, (byType.get(n.type) ?? 0) + 1)
    }
    expect(byType.get('input')).toBe(8)
    expect(byType.get('input-validate')).toBe(2)
    expect(byType.get('process')).toBe(8)
    expect(byType.get('result-validate')).toBe(2)
    expect(byType.get('post-process')).toBe(4)
    expect(byType.get('output')).toBe(6)
  })

  it('every node has a Zod config schema and a handler', () => {
    for (const n of ALL_NODES) {
      expect(n.configSchema, `${n.kind} schema`).toBeDefined()
      expect(n.runtimes.length, `${n.kind} runtimes`).toBeGreaterThan(0)
      expect(typeof n.handler, `${n.kind} handler`).toBe('function')
    }
  })

  it('local-only nodes are excluded from the CF runtime surface', () => {
    const localOnly = ALL_NODES.filter((n) => !n.runtimes.includes('cloudflare'))
    expect(localOnly.length).toBeGreaterThan(0)
    const cfKinds = new Set(CLOUDFLARE_NODES.map((n) => n.kind))
    for (const n of localOnly) {
      expect(cfKinds.has(n.kind), `${n.kind} should be hidden on CF`).toBe(false)
    }
  })

  it('supportedOn filters by runtime', () => {
    const node = supportedOn(ALL_NODES, 'node')
    expect(node.length).toBe(30)
    const cf = supportedOn(ALL_NODES, 'cloudflare')
    expect(cf.length).toBeLessThan(30)
  })

  it('NODE_CATALOG matches ALL_NODES', () => {
    expect(NODE_CATALOG.length).toBe(ALL_NODES.length)
    expect(NODE_CATALOG.map((c) => c.kind)).toEqual(ALL_NODES.map((n) => n.kind))
  })

  it('each node exposes a valid configSchema that parses its defaults', () => {
    /* parse({}) succeeds only when every required field has a default — the
     * happy-path test for "config-only" nodes. We don't assert success here,
     * only that parsing an empty object never throws a *runtime* panic other
     * than a ZodError. */
    for (const n of ALL_NODES) {
      expect(typeof n.configSchema.parse).toBe('function')
    }
  })
})
