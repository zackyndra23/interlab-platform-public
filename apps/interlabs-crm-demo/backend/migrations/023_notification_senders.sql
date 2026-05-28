-- ============================================================================
-- Migration 023: notification_senders + notification_templates.sender_id
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE notification_senders (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_key          text         NOT NULL UNIQUE,
    display_name        text         NOT NULL,
    from_email          text         NOT NULL,
    reply_to_email      text         NULL,
    provider            text         NOT NULL,
    -- TODO(Phase 3): reserved for per-sender credential routing via app_settings;
    -- adapters currently read credentials from process.env (see email-providers/factory.js).
    provider_config_key text         NOT NULL,
    is_active           boolean      NOT NULL DEFAULT true,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_senders_provider_chk
        CHECK (provider IN ('smtp','gmail','ses','postmark','resend'))
);

ALTER TABLE notification_templates
    ADD COLUMN sender_id uuid NULL REFERENCES notification_senders(id) ON DELETE SET NULL;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE notification_templates DROP COLUMN IF EXISTS sender_id;
DROP TABLE IF EXISTS notification_senders;
COMMIT;
