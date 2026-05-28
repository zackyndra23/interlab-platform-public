-- +migrate Up
BEGIN;
ALTER TABLE role_levels DROP CONSTRAINT IF EXISTS role_levels_unique_key;
ALTER TABLE role_levels DROP CONSTRAINT IF EXISTS role_levels_unique_rank;
CREATE UNIQUE INDEX role_levels_unique_key_active ON role_levels (role_id, level_key) WHERE deleted_at IS NULL;
CREATE UNIQUE INDEX role_levels_unique_rank_active ON role_levels (role_id, level_rank) WHERE deleted_at IS NULL;
COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS role_levels_unique_rank_active;
DROP INDEX IF EXISTS role_levels_unique_key_active;
ALTER TABLE role_levels ADD CONSTRAINT role_levels_unique_rank UNIQUE (role_id, level_rank);
ALTER TABLE role_levels ADD CONSTRAINT role_levels_unique_key UNIQUE (role_id, level_key);
COMMIT;
