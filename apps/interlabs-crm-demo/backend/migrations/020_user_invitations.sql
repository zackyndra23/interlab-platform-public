-- ============================================================================
-- Migration 020: user_invitations + users.must_change_password
-- F1 Invitation System (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE user_invitations (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 text         NOT NULL,
    role_key              text         NOT NULL REFERENCES roles(role_key),
    level_id              uuid         NULL REFERENCES role_levels(id),
    invited_by_user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    inviter_role_key      text         NOT NULL,
    activation_token_hash text         NOT NULL,
    initial_password_hash text         NOT NULL,
    status                text         NOT NULL DEFAULT 'pending',
    expires_at            timestamptz  NOT NULL,
    accepted_at           timestamptz  NULL,
    revoked_at            timestamptz  NULL,
    revoked_by_user_id    uuid         NULL REFERENCES users(id),
    revoke_reason         text         NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT user_invitations_status_chk CHECK (status IN ('pending','accepted','expired','revoked'))
);

-- Partial unique index: only one pending invitation per email address (case-insensitive).
-- Uses a partial index instead of EXCLUDE because btree_gist extension is not enabled.
CREATE UNIQUE INDEX user_invitations_email_active_unique
    ON user_invitations (lower(email)) WHERE status = 'pending';

CREATE INDEX user_invitations_token_idx        ON user_invitations (activation_token_hash);
CREATE INDEX user_invitations_email_idx        ON user_invitations (lower(email));
CREATE INDEX user_invitations_status_expires_idx ON user_invitations (status, expires_at);
CREATE INDEX user_invitations_inviter_idx      ON user_invitations (invited_by_user_id, created_at);

ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
DROP TABLE IF EXISTS user_invitations;
COMMIT;
