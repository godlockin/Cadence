/**
 * @pulsedeck/api — Hono backend with dual runtime entry points.
 * PHASE 0: skeleton only. Routes and adapters land in PHASE 1+.
 */
export const VERSION = '0.1.0'

export interface ApiContext {
  readonly version: string
}

export function createContext(): ApiContext {
  return { version: VERSION }
}
