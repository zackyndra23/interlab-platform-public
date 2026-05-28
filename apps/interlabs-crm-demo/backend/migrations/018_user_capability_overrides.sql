-- ============================================================================
-- Migration 018: user_capability_overrides
-- Per-user grant/deny overrides for the F2 permission resolver.
-- Quad-unique on (user_id, feature_id, capability_id, override_type) lets a
-- user have both a grant AND a deny on the same triple — deny wins per spec.
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE user_capability_overrides (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_id     uuid         NOT NULL REFERENCES feature_definitions(id) ON DELETE CASCADE,
    capability_id  uuid         NOT NULL REFERENCES capability_definitions(id) ON DELETE CASCADE,
    override_type  text         NOT NULL,
    reason         text         NULL,
    granted_by     uuid         NOT NULL REFERENCES users(id),
    granted_at     timestamptz  NOT NULL DEFAULT now(),
    expires_at     timestamptz  NULL,
    revoked_at     timestamptz  NULL,
    CONSTRAINT user_overrides_unique UNIQUE (user_id, feature_id, capability_id, override_type),
    CONSTRAINT user_overrides_type_chk CHECK (override_type IN ('grant','deny'))
);

CREATE INDEX user_overrides_active_idx ON user_capability_overrides (user_id) WHERE revoked_at IS NULL;

COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS user_capability_overrides;
COMMIT;
