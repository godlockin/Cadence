/**
 * @cadence/storage — adapter factory.
 *
 * Dispatches to one of three adapters based on environment.
 *
 * ```ts
 * // in tests / dev:
 * const storage = createStorageAdapter({ kind: 'memory' })
 *
 * // on Node.js with better-sqlite3:
 * const storage = createStorageAdapter({ kind: 'sqlite', db: openSqlite() })
 *
 * // on Cloudflare Workers (request context):
 * const storage = createStorageAdapter({ kind: 'd1', binding: env.PULSEDECK_DB })
 * ```
 */

import type { D1Binding } from './d1.js'
import { D1StorageAdapter } from './d1.js'
import { InMemoryStorageAdapter } from './in-memory.js'
import type { StorageAdapter } from './interface.js'
import type { SqliteDatabase } from './sqlite.js'
import { SqliteStorageAdapter } from './sqlite.js'

export type AdapterEnv =
  { kind: 'memory' } | { kind: 'sqlite'; db: SqliteDatabase } | { kind: 'd1'; binding: D1Binding }

export function createStorageAdapter(env: AdapterEnv): StorageAdapter {
  switch (env.kind) {
    case 'memory':
      return new InMemoryStorageAdapter()
    case 'sqlite':
      return new SqliteStorageAdapter(env.db)
    case 'd1':
      return new D1StorageAdapter(env.binding)
  }
}
