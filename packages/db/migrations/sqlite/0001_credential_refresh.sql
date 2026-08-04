-- @cadence/db — PHASE 6: credential refresh model.
-- Extends `credentials` with refresh metadata and adds two new tables:
--   * credential_refresh_jobs — distributed-lock ledger for refresh sweeps
--   * task_credentials       — task → credential dependency (pause on disable)
--
-- Every ALTER ... ADD COLUMN is nullable (or carries a DEFAULT) so legacy
-- rows created by PHASE 3 remain readable.

ALTER TABLE credentials ADD COLUMN type TEXT;
ALTER TABLE credentials ADD COLUMN key_id TEXT;
ALTER TABLE credentials ADD COLUMN client_secret_ciphertext TEXT;
ALTER TABLE credentials ADD COLUMN client_secret_iv TEXT;
ALTER TABLE credentials ADD COLUMN client_secret_auth_tag TEXT;
ALTER TABLE credentials ADD COLUMN token_endpoint TEXT;
ALTER TABLE credentials ADD COLUMN client_id TEXT;
ALTER TABLE credentials ADD COLUMN expires_at INTEGER;
ALTER TABLE credentials ADD COLUMN last_refreshed_at INTEGER;
ALTER TABLE credentials ADD COLUMN consecutive_failures INTEGER NOT NULL DEFAULT 0;
ALTER TABLE credentials ADD COLUMN disabled_at INTEGER;
ALTER TABLE credentials ADD COLUMN refresh_policy_lead_minutes INTEGER NOT NULL DEFAULT 5;
ALTER TABLE credentials ADD COLUMN refresh_policy_max_retries INTEGER NOT NULL DEFAULT 3;
ALTER TABLE credentials ADD COLUMN refresh_policy_backoff TEXT NOT NULL DEFAULT 'exponential';
ALTER TABLE credentials ADD COLUMN refresh_policy_disabled_on_fail INTEGER NOT NULL DEFAULT 1;
ALTER TABLE credentials ADD COLUMN version INTEGER NOT NULL DEFAULT 1;
ALTER TABLE credentials ADD COLUMN updated_at INTEGER;
CREATE INDEX IF NOT EXISTS credentials_expires_at_idx ON credentials (expires_at);

CREATE TABLE IF NOT EXISTS credential_refresh_jobs (
  id TEXT PRIMARY KEY,
  cred_id TEXT NOT NULL,
  status TEXT NOT NULL,
  started_at INTEGER NOT NULL,
  finished_at INTEGER
);
CREATE INDEX IF NOT EXISTS credential_refresh_jobs_cred_id_idx ON credential_refresh_jobs (cred_id);
CREATE INDEX IF NOT EXISTS credential_refresh_jobs_status_idx ON credential_refresh_jobs (status);

CREATE TABLE IF NOT EXISTS task_credentials (
  task_id TEXT NOT NULL,
  credential_id TEXT NOT NULL,
  PRIMARY KEY (task_id, credential_id)
);
CREATE INDEX IF NOT EXISTS task_credentials_credential_idx ON task_credentials (credential_id);
