/**
 * Node.js entry (macOS / Linux self-host).
 * PHASE 0: placeholder. Real server + graceful shutdown in PHASE 1+.
 */
import { createContext } from './index.js'

const ctx = createContext()
console.info('[pulsedeck/api] node entry ready', ctx)
