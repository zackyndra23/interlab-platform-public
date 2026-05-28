-- ============================================================================
-- Migration 030: backup (recovery) password hash on users
--
-- users.backup_password_hash holds a hash of the user's recovery/default
-- password. Set at seed time (= the seed password) and copied from the
-- invitation's initial_password_hash on accept. Superadmin "reset to backup"
-- copies this into password_hash. Plaintext is never stored.
--
-- Spec: docs/superpowers/specs/2026-05-26-sub1-accounts-permissions-design.md §3
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_password_hash text NULL;
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS backup_password_hash;
COMMIT;
