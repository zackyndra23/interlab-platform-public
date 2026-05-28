-- ============================================================================
-- Migration 024: notification_template_extras + user mutes
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE notification_template_extra_recipients (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_template_extra_recipients_unique UNIQUE (template_id, user_id)
);

CREATE INDEX notification_template_extra_recipients_template_idx
    ON notification_template_extra_recipients (template_id);

CREATE TABLE notification_user_mutes (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    muted_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_user_mutes_unique UNIQUE (user_id, template_id)
);

CREATE INDEX notification_user_mutes_user_idx ON notification_user_mutes (user_id);

COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS notification_user_mutes;
DROP TABLE IF EXISTS notification_template_extra_recipients;
COMMIT;
