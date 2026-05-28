-- Migration 033: users.last_login_at (D1 — for last-login display, item 11)
-- +migrate Up
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS last_login_at timestamptz;
COMMIT;
-- +migrate Down
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS last_login_at;
COMMIT;
