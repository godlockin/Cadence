/**
 * Cloudflare Workers entry.
 * PHASE 0: placeholder. Hono app + D1 binding land in PHASE 1+.
 */
import { createContext } from './index.js'

export default {
  async fetch(): Promise<Response> {
    const ctx = createContext()
    return new Response(JSON.stringify({ ok: true, version: ctx.version }), {
      headers: { 'content-type': 'application/json' },
    })
  },
}
