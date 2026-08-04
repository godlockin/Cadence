/**
 * @cadence/db — migration runner.
 *
 * Both SQLite (better-sqlite3) and D1 share the same SQL dialect, so a single
 * set of migration files in `migrations/sqlite/` is used for both.
 *
 * The runner is idempotent:
 *   - creates `schema_migrations` ledger if missing
 *   - reads `migrations/sqlite/*.sql` (sorted)
 *   - computes a sha256 checksum per file
 *   - applies only files not in the ledger (or whose checksum changed)
 *   - records the run
 *
 * Use `migrate(db)` (better-sqlite3) or `migrateD1(binding)` (Cloudflare D1).
 */
import { createHash } from 'node:crypto'
import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'

/* -------------------------------------------------------------------------
 * D1 binding type — matches the surface area we use (matches the loose type
 * in @cadence/storage). Using the `unknown` D1PreparedStatement cast is
 * safe because we never re-bind the statement; the same SQL is fine in
 * either engine.
 * ------------------------------------------------------------------------- */

type SqliteLikeStatement = {
  run: (...params: unknown[]) => unknown
}

type SqliteLikeDb = {
  exec: (sql: string) => unknown
  prepare: (sql: string) => SqliteLikeStatement
}

type D1LikeStatement = {
  bind: (...params: unknown[]) => D1LikeStatement
  run: () => Promise<unknown>
  all: <T = unknown>() => Promise<{ results?: T[]; success?: boolean }>
  first: <T = unknown>(colName?: string) => Promise<T | null>
}

type D1LikeBinding = {
  prepare: (sql: string) => D1LikeStatement
  batch: <T = unknown>(statements: D1LikeStatement[]) => Promise<T[]>
  exec: (sql: string) => Promise<{ count: number; duration: number }>
}

/* -------------------------------------------------------------------------
 * Ledger (migrations table) bootstrap
 * ------------------------------------------------------------------------- */

const LEDGER_DDL =
  'CREATE TABLE IF NOT EXISTS schema_migrations (' +
  'filename TEXT PRIMARY KEY, ' +
  'checksum TEXT NOT NULL, ' +
  'applied_at INTEGER NOT NULL' +
  ')'

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex')
}

/* -------------------------------------------------------------------------
 * Filesystem resolution (Node-side)
 * ------------------------------------------------------------------------- */

function resolveMigrationsDir(): string {
  // Migrations live at <db>/migrations/sqlite.  This file is at
  // <db>/src/migrate.ts, so go up one level.
  const here = dirname(fileURLToPath(import.meta.url))
  return resolve(here, '..', 'migrations', 'sqlite')
}

function loadMigrationFiles(): { filename: string; sql: string; checksum: string }[] {
  const dir = resolveMigrationsDir()
  const entries = readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
  return entries.map((filename) => {
    const sql = readFileSync(join(dir, filename), 'utf8')
    return { filename, sql, checksum: sha256(sql) }
  })
}

/* -------------------------------------------------------------------------
 * SQLite (better-sqlite3) path — sync, transactional
 * ------------------------------------------------------------------------- */

interface SqliteMigrateOptions {
  /** Override the migrations directory (e.g. for in-memory tests using a temp dir). */
  migrationsDir?: string
  /** Override the SQL file resolver (lets tests inject a virtual file set). */
  loadFiles?: () => { filename: string; sql: string; checksum: string }[]
}

export async function migrate(
  db: SqliteLikeDb,
  options: SqliteMigrateOptions = {},
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  db.exec(LEDGER_DDL)
  const files = options.loadFiles
    ? options.loadFiles()
    : options.migrationsDir
      ? loadFromDir(options.migrationsDir)
      : loadMigrationFiles()

  const ledger = ((): Map<string, string> => {
    const stmt = db.prepare('SELECT filename, checksum FROM schema_migrations') as unknown as {
      all: () => { filename: string; checksum: string }[]
    }
    const rows = stmt.all()
    const out = new Map<string, string>()
    for (const r of rows) out.set(r.filename, r.checksum)
    return out
  })()

  const applied: string[] = []
  const skipped: string[] = []

  // Wrap each migration in a transaction via SQLite's SAVEPOINT is overkill;
  // better-sqlite3 `db.transaction(...)` is the right tool but requires a real
  // Database. We rely on DDL being implicitly transactional in SQLite.
  for (const file of files) {
    const existing = ledger.get(file.filename)
    if (existing === file.checksum) {
      skipped.push(file.filename)
      continue
    }
    // Split on `;\n` so we issue one DDL per statement. Naive but reliable for
    // the well-formed migrations we ship.
    const statements = splitStatements(file.sql)
    for (const stmt of statements) {
      db.exec(stmt)
    }
    if (existing === undefined) {
      db.prepare(
        'INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)',
      ).run(file.filename, file.checksum, Date.now())
    } else {
      // checksum drifted — update in place
      db.prepare(
        'UPDATE schema_migrations SET checksum = ?, applied_at = ? WHERE filename = ?',
      ).run(file.checksum, Date.now(), file.filename)
    }
    applied.push(file.filename)
  }

  return { applied, skipped }
}

function loadFromDir(dir: string): { filename: string; sql: string; checksum: string }[] {
  return readdirSync(dir)
    .filter((f) => f.endsWith('.sql'))
    .sort((a, b) => a.localeCompare(b))
    .map((filename) => {
      const sql = readFileSync(join(dir, filename), 'utf8')
      return { filename, sql, checksum: sha256(sql) }
    })
}

function splitStatements(sql: string): string[] {
  return sql
    .split(/;\s*\n/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/* -------------------------------------------------------------------------
 * D1 path — async, batch-per-file
 * ------------------------------------------------------------------------- */

interface D1MigrateOptions {
  /** Override the SQL file resolver. */
  loadFiles?: () => { filename: string; sql: string; checksum: string }[]
}

export async function migrateD1(
  binding: D1LikeBinding,
  options: D1MigrateOptions = {},
): Promise<{ applied: readonly string[]; skipped: readonly string[] }> {
  // D1 does not allow `exec` of multi-statement SQL; we run the ledger DDL
  // through prepare/run instead.
  await binding.prepare(LEDGER_DDL).run()

  const files = options.loadFiles ? options.loadFiles() : loadMigrationFiles()

  const ledger = new Map<string, string>()
  const existing = await binding
    .prepare('SELECT filename, checksum FROM schema_migrations')
    .all<{ filename: string; checksum: string }>()
  for (const r of existing.results ?? []) ledger.set(r.filename, r.checksum)

  const applied: string[] = []
  const skipped: string[] = []

  for (const file of files) {
    const existing = ledger.get(file.filename)
    if (existing === file.checksum) {
      skipped.push(file.filename)
      continue
    }
    const statements = splitStatements(file.sql)
    for (const stmt of statements) {
      await binding.prepare(stmt).run()
    }
    if (existing === undefined) {
      await binding
        .prepare('INSERT INTO schema_migrations (filename, checksum, applied_at) VALUES (?, ?, ?)')
        .bind(file.filename, file.checksum, Date.now())
        .run()
    } else {
      // checksum drifted — update in place
      await binding
        .prepare('UPDATE schema_migrations SET checksum = ?, applied_at = ? WHERE filename = ?')
        .bind(file.checksum, Date.now(), file.filename)
        .run()
    }
    applied.push(file.filename)
  }

  return { applied, skipped }
}
