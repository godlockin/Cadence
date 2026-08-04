/**
 * Shared dev bootstrap for `dev:cron` / `dev:queue` scripts.
 *
 * Opens (and migrates) the same SQLite file the API uses
 * (`PULSEDECK_DB_PATH`, default `.pulsedeck/dev.db`) so tasks created via
 * the API in dev are visible to the standalone cron loop and queue worker.
 */
import Database from 'better-sqlite3'
import { drizzle } from 'drizzle-orm/better-sqlite3'
import { migrate } from '@cadence/db'
import { createStorageAdapter, type SqliteDatabase } from '@cadence/storage'
import { mkdirSync } from 'node:fs'
import { dirname, resolve } from 'node:path'

export interface DevStorage {
  readonly db: Database.Database
  readonly storage: ReturnType<typeof createStorageAdapter>
  close(): Promise<void>
}

export function openDevStorage(): DevStorage {
  const dbPath = resolve(process.env['PULSEDECK_DB_PATH'] ?? '.pulsedeck/dev.db')
  mkdirSync(dirname(dbPath), { recursive: true })
  const db = new Database(dbPath)
  db.pragma('journal_mode = WAL')
  db.pragma('foreign_keys = ON')
  drizzle(db)
  migrate(db as unknown as Parameters<typeof migrate>[0])
  const storage = createStorageAdapter({
    kind: 'sqlite',
    db: db as unknown as SqliteDatabase,
  })
  return {
    db,
    storage,
    async close() {
      db.close()
      await storage.close()
    },
  }
}
