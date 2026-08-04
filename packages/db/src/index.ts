/**
 * @cadence/db — drizzle schema + migrations (D1 + better-sqlite3).
 * PHASE 2 ships:
 *  - schema.ts   — 9 logical tables + 4 RBAC junctions
 *  - migrate.ts  — idempotent runner for SQLite + D1
 *  - mappers.ts  — row ↔ domain entity transforms (consumed by @cadence/storage)
 */
export * from './schema.js'
export { migrate, migrateD1 } from './migrate.js'
export const VERSION = '0.2.0'
