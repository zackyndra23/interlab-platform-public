-- ============================================================================
-- Migration 017: role_levels + level_id columns + role_permissions quad-unique
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE role_levels (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id            uuid         NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    level_key          text         NOT NULL,
    level_name         text         NOT NULL,
    level_rank         int          NOT NULL,
    data_scope_default text         NOT NULL DEFAULT 'own',
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    deleted_at         timestamptz  NULL,
    CONSTRAINT role_levels_unique_key UNIQUE (role_id, level_key),
    CONSTRAINT role_levels_unique_rank UNIQUE (role_id, level_rank),
    CONSTRAINT role_levels_scope_chk CHECK (data_scope_default IN ('own','team','role','global'))
);
CREATE INDEX role_levels_role_idx ON role_levels (role_id) WHERE deleted_at IS NULL;

-- Add level_id to users (nullable: superadmin/ceo and seeded service users keep NULL)
ALTER TABLE users ADD COLUMN level_id uuid NULL REFERENCES role_levels(id) ON DELETE SET NULL;

-- Seed a 'staff' (rank 1) level for each non-system role that has role_permissions rows.
-- Without this, the backfill below would have nothing to point existing rows at.
INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
SELECT r.id,
       r.role_key || '_staff',
       initcap(replace(r.role_key, '_', ' ')) || ' Staff',
       1,
       CASE WHEN r.role_key IN ('superadmin','ceo') THEN 'global' ELSE 'own' END
  FROM roles r
 WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
ON CONFLICT (role_id, level_key) DO NOTHING;

-- Extend role_permissions with level_id (nullable initially, then backfill, then NOT NULL).
-- RESTRICT (not CASCADE): deleting a level requires the operator to first
-- migrate or remove its role_permissions rows. Prevents silent permission loss
-- if a level is hard-deleted (project invariant: "no silent mutations").
ALTER TABLE role_permissions ADD COLUMN level_id uuid NULL REFERENCES role_levels(id) ON DELETE RESTRICT;

-- Backfill: every existing role_permissions row gets the rank-1 (staff) level for its role.
UPDATE role_permissions rp
   SET level_id = rl.id
  FROM role_levels rl
 WHERE rl.role_id = rp.role_id
   AND rl.level_rank = 1
   AND rp.level_id IS NULL;

-- Superadmin/CEO bypass the resolver entirely, so their role_permissions rows are
-- legacy and should be removed before enforcing NOT NULL.
DELETE FROM role_permissions rp
 WHERE rp.level_id IS NULL
   AND rp.role_id IN (SELECT id FROM roles WHERE role_key IN ('superadmin','ceo'));

-- After cleanup, every remaining row must have level_id.
DO $$
DECLARE remaining int;
BEGIN
    SELECT count(*) INTO remaining FROM role_permissions WHERE level_id IS NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'role_permissions backfill failed: % rows still null', remaining;
    END IF;
END $$;

ALTER TABLE role_permissions ALTER COLUMN level_id SET NOT NULL;

-- Replace triple-unique with quad-unique to allow per-(role, level) permission templates.
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_triple_unique;
ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_quad_unique
        UNIQUE (role_id, level_id, feature_id, capability_id);

COMMIT;

-- +migrate Down
BEGIN;
-- NOTE: Down is destructive — superadmin/ceo role_permissions rows deleted by
-- the Up migration are NOT restored here. Run `node scripts/seed.js` after
-- migrating down to recover them.
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_quad_unique;
ALTER TABLE role_permissions DROP COLUMN IF EXISTS level_id;
ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_triple_unique
        UNIQUE (role_id, feature_id, capability_id);
ALTER TABLE users DROP COLUMN IF EXISTS level_id;
DROP TABLE IF EXISTS role_levels;
COMMIT;
