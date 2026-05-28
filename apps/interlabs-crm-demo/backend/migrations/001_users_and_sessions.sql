-- ============================================================================
-- Migration 001: Users and Sessions
-- Creates: users, user_sessions, user_preferences
-- Enables: pgcrypto (for gen_random_uuid()), pg_trgm (for later FTS/trigram)
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE EXTENSION IF NOT EXISTS "pgcrypto";
CREATE EXTENSION IF NOT EXISTS "pg_trgm";

-- ----------------------------------------------------------------------------
-- users
-- ----------------------------------------------------------------------------
CREATE TABLE users (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email             text         NOT NULL,
    password_hash     text         NOT NULL,
    role              text         NOT NULL,
    permission_level  text         NULL,
    avatar_url        text         NULL,
    display_name      text         NOT NULL,
    account_status    text         NOT NULL DEFAULT 'active',
    created_by        uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by        uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    deleted_at        timestamptz  NULL,
    CONSTRAINT users_email_unique UNIQUE (email),
    CONSTRAINT users_account_status_chk
        CHECK (account_status IN ('active','inactive','suspended'))
);

-- Foreign key to roles(role_key) is added in migration 002 after roles exists.

-- ----------------------------------------------------------------------------
-- user_sessions
--   Stores refresh-token handles (bcrypt/SHA-256 hash of the opaque token).
-- ----------------------------------------------------------------------------
CREATE TABLE user_sessions (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id     uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash  text         NOT NULL,
    expires_at  timestamptz  NOT NULL,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT user_sessions_token_hash_unique UNIQUE (token_hash)
);

-- ----------------------------------------------------------------------------
-- user_preferences
--   One row per user. theme = 'light' | 'dark'.
-- ----------------------------------------------------------------------------
CREATE TABLE user_preferences (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    theme                text         NOT NULL DEFAULT 'light',
    sidebar_collapsed    boolean      NOT NULL DEFAULT false,
    notification_email   boolean      NOT NULL DEFAULT true,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT user_preferences_user_unique UNIQUE (user_id),
    CONSTRAINT user_preferences_theme_chk CHECK (theme IN ('light','dark'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS user_preferences;
DROP TABLE IF EXISTS user_sessions;
DROP TABLE IF EXISTS users;

-- Extensions left in place (may be used by other schemas/databases).

COMMIT;
