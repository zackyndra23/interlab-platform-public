-- ============================================================================
-- Migration 029: user profile fields + two-factor auth schema
--
-- Adds first_name / last_name / phone / two_factor_* columns to users.
-- Creates password_reset_tokens (forgot-password flow) and
-- two_factor_email_codes (Email 2FA OTP storage). Pending login state for
-- Email/TOTP 2FA verification lives in Redis (TTL 5 min) — no DB table.
--
-- Spec: docs/superpowers/specs/2026-05-03-auth-features-design.md §3
-- ============================================================================

-- +migrate Up
BEGIN;

-- Profile fields (nullable; populate on first profile edit)
ALTER TABLE users
    ADD COLUMN first_name             text         NULL,
    ADD COLUMN last_name              text         NULL,
    ADD COLUMN phone                  text         NULL,
    ADD COLUMN two_factor_method      text         NOT NULL DEFAULT 'disabled',
    ADD COLUMN two_factor_secret      text         NULL,         -- AES-256-GCM ciphertext (base64)
    ADD COLUMN two_factor_backup_codes text[]      NULL,         -- bcrypt hashes; one entry per code
    ADD COLUMN two_factor_enabled_at  timestamptz  NULL;

ALTER TABLE users
    ADD CONSTRAINT users_two_factor_method_chk
        CHECK (two_factor_method IN ('disabled','email','totp'));

-- E.164 international phone format. NULL allowed (field optional until profile saved).
ALTER TABLE users
    ADD CONSTRAINT users_phone_e164_chk
        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{1,14}$');

-- Partial index speeds up "find users with 2FA enabled" queries.
CREATE INDEX users_2fa_method_idx ON users (two_factor_method)
    WHERE two_factor_method <> 'disabled';

-- Password reset tokens. token_hash is SHA-256(plaintext). Plaintext only
-- ever exists in the email body. Single-use (used_at IS NOT NULL = consumed).
CREATE TABLE password_reset_tokens (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    text         NOT NULL UNIQUE,
    expires_at    timestamptz  NOT NULL,
    used_at       timestamptz  NULL,
    requested_ip  text         NULL,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_tokens_active_idx
    ON password_reset_tokens (token_hash) WHERE used_at IS NULL;

-- Email 2FA one-time codes. code_hash is SHA-256(6-digit OTP). 10-min expiry,
-- max 5 wrong attempts before voided.
CREATE TABLE two_factor_email_codes (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash     text         NOT NULL,
    expires_at    timestamptz  NOT NULL,
    used_at       timestamptz  NULL,
    attempts      int          NOT NULL DEFAULT 0,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX two_factor_email_codes_user_idx ON two_factor_email_codes (user_id, created_at);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS two_factor_email_codes;
DROP TABLE IF EXISTS password_reset_tokens;

DROP INDEX IF EXISTS users_2fa_method_idx;

ALTER TABLE users DROP CONSTRAINT IF EXISTS users_phone_e164_chk;
ALTER TABLE users DROP CONSTRAINT IF EXISTS users_two_factor_method_chk;

ALTER TABLE users
    DROP COLUMN IF EXISTS two_factor_enabled_at,
    DROP COLUMN IF EXISTS two_factor_backup_codes,
    DROP COLUMN IF EXISTS two_factor_secret,
    DROP COLUMN IF EXISTS two_factor_method,
    DROP COLUMN IF EXISTS phone,
    DROP COLUMN IF EXISTS last_name,
    DROP COLUMN IF EXISTS first_name;

COMMIT;
