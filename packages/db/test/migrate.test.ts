/**
 * @cadence/db — migration runner round-trip tests.
 *
 * Verifies:
 *  - migrate(db) creates the schema on a fresh better-sqlite3 db
 *  - migrate(db) is idempotent (running twice doesn't duplicate)
 *  - migrateD1(binding) creates the schema on a fresh mock D1 binding
 *  - migrateD1(binding) is idempotent
 *  - The ledger tracks applied migrations + checksums
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import Database from 'better-sqlite3'
import { migrate, migrateD1 } from '../src/migrate.js'

type D1Binding = Parameters<typeof migrateD1>[0]

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

function loadAllMigrations(): { filename: string; sql: string; checksum: string }[] {
  const here = dirname(fileURLToPath(import.meta.url))
  const dir = resolve(here, '..', 'migrations', 'sqlite')
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), 'utf8')
      return { filename, sql, checksum: sha256(sql) }
    })
}

describe('migrate (better-sqlite3)', () => {
  let db: Database.Database

  beforeEach(() => {
    db = new Database(':memory:')
  })

  afterEach(() => {
    db.close()
  })

  it('creates the full schema on a fresh db', async () => {
    const r = await migrate(db as unknown as Parameters<typeof migrate>[0])
    expect(r.applied.length).toBeGreaterThan(0)
    expect(r.skipped).toHaveLength(0)

    const tables = db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all() as { name: string }[]
    const names = tables.map((t) => t.name)
    for (const expected of [
      'audit_logs',
      'credentials',
      'executions',
      'groups',
      'permissions',
      'pipeline_tags',
      'role_permissions',
      'roles',
      'schema_migrations',
      'tags',
      'tasks',
      'user_groups',
      'group_roles',
      'users',
    ]) {
      expect(names).toContain(expected)
    }
  })

  it('is idempotent — second run is a no-op', async () => {
    const r1 = await migrate(db as unknown as Parameters<typeof migrate>[0])
    expect(r1.applied.length).toBeGreaterThan(0)
    const r2 = await migrate(db as unknown as Parameters<typeof migrate>[0])
    expect(r2.applied).toHaveLength(0)
    expect(r2.skipped).toEqual(r1.applied)
  })

  it('records checksums so changed SQL re-runs', async () => {
    await migrate(db as unknown as Parameters<typeof migrate>[0])
    // re-run with a tampered migration set: pretend 0000 has new SQL
    const files = loadAllMigrations()
    const tampered = files.map((f, i) =>
      i === 0
        ? { ...f, sql: f.sql + '\n-- TAMpered\n', checksum: sha256(f.sql + '\n-- TAMpered\n') }
        : f,
    )
    const r = await migrate(db as unknown as Parameters<typeof migrate>[0], { loadFiles: () => tampered })
    expect(r.applied).toContain(files[0]!.filename)
  })
})

describe('migrateD1', () => {
  let binding: D1Binding
  let store: { sql: string; bound: unknown[] }[]
  let ledger: Map<string, string>

  beforeEach(() => {
    store = []
    ledger = new Map()
    binding = {
      prepare: (sql: string) => {
        // record prepare-time so non-bind .run() calls (e.g. LEDGER DDL) work
        store.push({ sql, bound: [] })
        const stmt: {
          bind: (...params: unknown[]) => typeof stmt
          run: () => Promise<unknown>
          all: <T = unknown>() => Promise<{ results?: T[]; success: boolean }>
          first: <T = unknown>() => Promise<T | null>
        } = {
          bind: (...params: unknown[]) => {
            const last = store[store.length - 1]!
            last.bound = params
            return stmt
          },
          run: async () => {
            const last = store[store.length - 1]!
            const sql = last.sql
            const params = last.bound
            if (/INSERT INTO schema_migrations/.test(sql)) {
              const [filename, checksum] = params
              if (typeof filename === 'string' && typeof checksum === 'string') {
                ledger.set(filename, checksum)
              }
            } else if (/UPDATE schema_migrations SET checksum/.test(sql)) {
              const [checksum, , filename] = params
              if (typeof filename === 'string' && typeof checksum === 'string') {
                ledger.set(filename, checksum)
              }
            }
            return { success: true, meta: { changes: 0 } }
          },
          all: async <T = unknown>() => {
            const last = store[store.length - 1]!
            if (/SELECT filename, checksum FROM schema_migrations/.test(last.sql)) {
              const rows = Array.from(ledger.entries()).map(([filename, checksum]) => ({
                filename,
                checksum,
              }))
              return { results: rows as T[], success: true }
            }
            return { results: [] as T[], success: true }
          },
          first: async <T = unknown>() => null as T | null,
        }
        return stmt
      },
      batch: async <T>(_s: readonly unknown[]) => [] as T,
      exec: async (_sql: string) => ({ count: 0, duration: 0 }),
    }
  })

  it('records every statement on a fresh D1 binding', async () => {
    const r = await migrateD1(binding)
    expect(r.applied.length).toBeGreaterThan(0)
    const inserts = store.filter((s) => /INSERT INTO schema_migrations/.test(s.sql))
    expect(inserts.length).toBe(r.applied.length)
  })

  it('is idempotent — second run records no INSERTs', async () => {
    const r1 = await migrateD1(binding)
    const before = store.length
    const r2 = await migrateD1(binding)
    expect(r2.applied).toHaveLength(0)
    expect(r2.skipped).toEqual(r1.applied)
    // second run adds: 1 LEDGER_DDL + 1 SELECT = 2 entries
    expect(store.length).toBe(before + 2)
  })
})
