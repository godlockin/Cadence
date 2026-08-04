/**
 * @cadence/storage — public surface.
 *
 * PHASE 2 ships:
 *  - `StorageAdapter` contract (interface.ts)
 *  - `InMemoryStorageAdapter` (PHASE 1A) — used by sinker unit tests
 *  - `SqliteStorageAdapter` (PHASE 2) — better-sqlite3 + drizzle-orm
 *  - `D1StorageAdapter` (PHASE 2)    — Cloudflare D1 + drizzle-orm
 *  - mappers (row ↔ domain)
 *  - `createStorageAdapter` factory
 *
 * Both SQLite and D1 share a single SQL dialect and a single migration set
 * owned by `@cadence/db` — they only differ in the underlying driver.
 */

export {
  ConflictError,
  NotFoundError,
  StaleVersionError,
  type AuditFilter,
  type CredentialFilter,
  type ExecutionFilter,
  type GroupFilter,
  type RefreshJob,
  type RefreshToken,
  type ResolvedPermission,
  type ResolvedUserRole,
  type SortClause,
  type SortDirection,
  type StorageAdapter,
  type TagFilter,
  type TaskFilter,
  type UserFilter,
} from './interface.js'

export { InMemoryStorageAdapter } from './in-memory.js'
export { SqliteStorageAdapter } from './sqlite.js'
export type { SqliteDatabase } from './sqlite.js'
export { D1StorageAdapter, type D1Binding } from './d1.js'
export { createStorageAdapter, type AdapterEnv } from './factory.js'
export {
  auditLogDomainToRow,
  auditLogRowToDomain,
  credentialDomainToRow,
  credentialRowToDomain,
  executionDomainToRow,
  executionRowToDomain,
  groupDomainToRow,
  groupRowToDomain,
  tagDomainToRow,
  tagRowToDomain,
  taskDomainToRow,
  taskRowToDomain,
  userDomainToRow,
  userRowToDomain,
} from './mappers.js'

export const VERSION = '0.2.0'
