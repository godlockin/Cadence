-- @cadence/db — add is_active, must_change_password to users.
-- v0003 — sync with domain UserSchema (mustChangePassword boolean).
ALTER TABLE users ADD COLUMN is_active INTEGER NOT NULL DEFAULT 1;
ALTER TABLE users ADD COLUMN must_change_password INTEGER NOT NULL DEFAULT 0;
