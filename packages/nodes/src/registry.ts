/**
 * @cadence/nodes — registry helpers.
 *
 * `defineNode` builds a `NodeHandler` from a typed definition: it validates
 * the raw config through the Zod schema and forwards the parsed value to a
 * typed handler, so individual node implementations never touch `unknown`
 * after the schema gate.
 */
import type { ZodType, ZodTypeDef } from 'zod'
import type { NodeContext, NodeDefinition, NodeHandler, NodeType, Runtime } from './types.js'

export function defineNode<TConfig>(def: NodeDefinition<TConfig>): NodeHandler {
  return {
    kind: def.kind,
    type: def.type,
    configSchema: def.configSchema as unknown as ZodType<unknown, ZodTypeDef, unknown>,
    runtimes: def.runtimes,
    handler: (raw: unknown, ctx: NodeContext) => def.handler(def.configSchema.parse(raw), ctx),
  }
}

/** Filter a node list down to those that can run on a given runtime. */
export function supportedOn(nodes: readonly NodeHandler[], runtime: Runtime): NodeHandler[] {
  return nodes.filter((n) => n.runtimes.includes(runtime))
}

export interface CatalogEntry {
  readonly kind: string
  readonly type: NodeType
  readonly name: string
  readonly description: string
  readonly runtimes: readonly Runtime[]
}

export function toCatalog(nodes: readonly NodeHandler[]): CatalogEntry[] {
  return nodes.map((n) => ({
    kind: n.kind,
    type: n.type,
    name: n.kind,
    description: n.kind,
    runtimes: n.runtimes,
  }))
}
