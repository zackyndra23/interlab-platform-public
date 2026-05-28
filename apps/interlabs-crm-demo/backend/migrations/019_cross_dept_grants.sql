-- ============================================================================
-- Migration 019: cross_dept_grants
-- Explicit (grantee_user_id, target_role_key, feature_id, capability_id) grants
-- for cross-department interaction (spec F2). Active partial index on grantee
-- for fast resolver lookup.
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE cross_dept_grants (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    grantee_user_id uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_role_key text         NOT NULL REFERENCES roles(role_key),
    feature_id      uuid         NOT NULL REFERENCES feature_definitions(id) ON DELETE CASCADE,
    capability_id   uuid         NOT NULL REFERENCES capability_definitions(id) ON DELETE CASCADE,
    granted_by      uuid         NOT NULL REFERENCES users(id),
    granted_at      timestamptz  NOT NULL DEFAULT now(),
    expires_at      timestamptz  NULL,
    revoked_at      timestamptz  NULL,
    notes           text         NULL,
    CONSTRAINT cross_dept_grants_unique
        UNIQUE (grantee_user_id, target_role_key, feature_id, capability_id)
);

CREATE INDEX cross_dept_grants_grantee_idx ON cross_dept_grants (grantee_user_id) WHERE revoked_at IS NULL;

COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS cross_dept_grants;
COMMIT;
