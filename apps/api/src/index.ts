/**
 * @cadence/api — public surface.
 *
 * PHASE 3 ships:
 *  - `createApp({ storage, auth, jwt })` — wires the Hono app
 *  - `writeAudit(...)` — helper used by every route that mutates
 *  - runtime adapters: `adapters/cloudflare.ts`, `adapters/node.ts`
 *  - `errors.ts` — typed error → JSON envelope mapper
 *
 * Both runtimes (Node, Workers) consume the same `createApp` so the
 * routes are byte-identical; only the adapter chooses which storage
 * driver to inject.
 */
export { createApp, writeAudit } from './app.js'
export type { AppEnv, AppVariables, AppBindings, AuditWriteInput, CreateAppDeps } from './app.js'
export { mapErrorToResponse } from './errors.js'
export type { ErrorEnvelope } from './errors.js'
export const VERSION = '0.3.0'
