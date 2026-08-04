-- @cadence/db — PHASE 8: persist RBAC + refresh sessions for the
-- deployable runtimes (better-sqlite3 / D1). Previously these lived only
-- in the in-memory adapter, so the Node + Workers runtimes could not log
-- in or resolve roles.
--
--  * users.is_superadmin  — persist the bootstrap super_admin flag
--  * refresh_tokens       — hash-addressed refresh sessions

ALTER TABLE users ADD COLUMN is_superadmin INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS refresh_tokens (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  user_agent TEXT,
  ip TEXT,
  created_at INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS refresh_tokens_user_idx ON refresh_tokens (user_id);
CREATE UNIQUE INDEX IF NOT EXISTS refresh_tokens_hash_uniq ON refresh_tokens (token_hash);
