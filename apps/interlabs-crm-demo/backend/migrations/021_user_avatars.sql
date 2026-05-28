-- ============================================================================
-- Migration 021: user avatar columns
-- F3 Avatar Upload (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

ALTER TABLE users
  ADD COLUMN avatar_file_id    uuid        NULL REFERENCES file_attachments(id) ON DELETE SET NULL,
  ADD COLUMN avatar_updated_at timestamptz NULL;

CREATE INDEX users_avatar_file_idx ON users (avatar_file_id) WHERE avatar_file_id IS NOT NULL;

COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS users_avatar_file_idx;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_updated_at;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_file_id;
COMMIT;
