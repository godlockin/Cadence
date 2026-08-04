-- @cadence/db — initial schema (SQLite + D1).
-- Generated to match @cadence/db/src/schema.ts exactly.
-- PHASE 2 ships 9 logical tables + 4 RBAC junctions + 1 migrations ledger.

CREATE TABLE IF NOT EXISTS users (
  id TEXT PRIMARY KEY,
  email TEXT NOT NULL,
  display_name TEXT NOT NULL,
  role TEXT NOT NULL,
  password_hash TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_email_uniq ON users (email);

CREATE TABLE IF NOT EXISTS groups (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  owner_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS groups_owner_idx ON groups (owner_id);

CREATE TABLE IF NOT EXISTS user_groups (
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  joined_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, group_id)
);

CREATE TABLE IF NOT EXISTS roles (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS permissions (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT ''
);

CREATE TABLE IF NOT EXISTS role_permissions (
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions(id) ON DELETE CASCADE,
  PRIMARY KEY (role_id, permission_id)
);

CREATE TABLE IF NOT EXISTS group_roles (
  group_id TEXT NOT NULL REFERENCES groups(id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  assigned_at INTEGER NOT NULL,
  PRIMARY KEY (group_id, role_id, user_id)
);

CREATE TABLE IF NOT EXISTS tasks (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  description TEXT,
  owner_id TEXT NOT NULL,
  group_id TEXT,
  payload_kind TEXT NOT NULL,
  payload_json TEXT NOT NULL,
  trigger_kind TEXT NOT NULL,
  trigger_config_json TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  cron TEXT,
  timezone TEXT NOT NULL DEFAULT 'UTC',
  start_at INTEGER,
  end_at INTEGER,
  max_retries INTEGER NOT NULL DEFAULT 0,
  retry_backoff TEXT NOT NULL DEFAULT 'exponential',
  concurrency_policy TEXT NOT NULL DEFAULT 'skip',
  jitter_ms INTEGER NOT NULL DEFAULT 0,
  timeout_ms INTEGER NOT NULL DEFAULT 30000,
  tags_json TEXT NOT NULL DEFAULT '[]',
  notifications_json TEXT,
  metadata_json TEXT NOT NULL DEFAULT '{}',
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS tasks_owner_idx ON tasks (owner_id);
CREATE INDEX IF NOT EXISTS tasks_group_idx ON tasks (group_id);
CREATE INDEX IF NOT EXISTS tasks_status_idx ON tasks (status);
CREATE INDEX IF NOT EXISTS tasks_payload_kind_idx ON tasks (payload_kind);
CREATE INDEX IF NOT EXISTS tasks_trigger_kind_idx ON tasks (trigger_kind);
CREATE INDEX IF NOT EXISTS tasks_deleted_at_idx ON tasks (deleted_at);

CREATE TABLE IF NOT EXISTS executions (
  id TEXT PRIMARY KEY,
  task_id TEXT NOT NULL,
  status TEXT NOT NULL,
  trigger_source TEXT NOT NULL,
  triggered_by TEXT,
  started_at INTEGER,
  finished_at INTEGER,
  duration_ms INTEGER,
  retry_count INTEGER NOT NULL DEFAULT 0,
  error_json TEXT,
  result_json TEXT,
  idempotency_key TEXT,
  version INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS executions_task_id_idx ON executions (task_id);
CREATE INDEX IF NOT EXISTS executions_status_idx ON executions (status);
CREATE INDEX IF NOT EXISTS executions_started_at_idx ON executions (started_at);

CREATE TABLE IF NOT EXISTS credentials (
  id TEXT PRIMARY KEY,
  owner_id TEXT NOT NULL,
  name TEXT NOT NULL,
  kind TEXT NOT NULL,
  ciphertext TEXT NOT NULL,
  iv TEXT NOT NULL,
  auth_tag TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS credentials_owner_idx ON credentials (owner_id);
CREATE INDEX IF NOT EXISTS credentials_kind_idx ON credentials (kind);

CREATE TABLE IF NOT EXISTS tags (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  color TEXT,
  created_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS tags_name_uniq ON tags (name);

CREATE TABLE IF NOT EXISTS pipeline_tags (
  task_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  attached_at INTEGER NOT NULL,
  PRIMARY KEY (task_id, tag_id)
);
CREATE INDEX IF NOT EXISTS pipeline_tags_task_idx ON pipeline_tags (task_id);
CREATE INDEX IF NOT EXISTS pipeline_tags_tag_idx ON pipeline_tags (tag_id);

CREATE TABLE IF NOT EXISTS audit_logs (
  id TEXT PRIMARY KEY,
  action TEXT NOT NULL,
  actor_id TEXT,
  resource_kind TEXT NOT NULL,
  resource_id TEXT NOT NULL,
  diff_json TEXT NOT NULL DEFAULT '{}',
  metadata_json TEXT NOT NULL DEFAULT '{}',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_logs_resource_idx ON audit_logs (resource_kind, resource_id);
CREATE INDEX IF NOT EXISTS audit_logs_actor_idx ON audit_logs (actor_id);
CREATE INDEX IF NOT EXISTS audit_logs_action_idx ON audit_logs (action);
CREATE INDEX IF NOT EXISTS audit_logs_created_at_idx ON audit_logs (created_at);

CREATE TABLE IF NOT EXISTS schema_migrations (
  filename TEXT PRIMARY KEY,
  checksum TEXT NOT NULL,
  applied_at INTEGER NOT NULL
);
