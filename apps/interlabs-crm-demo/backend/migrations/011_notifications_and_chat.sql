-- ============================================================================
-- Migration 011: Notifications and Chat
-- Creates: notifications, notification_templates, notification_logs,
--          chat_channels, chat_topics, chat_messages,
--          chat_channel_members, chat_message_reads
--
-- Notifications spec (CTX_master_context): each row carries a recipient_user_id
-- OR recipient_role (or both). notification_templates.recipient_roles_json
-- stores default recipient roles per template (JSONB array of role_keys).
--
-- notification_logs tracks per-channel delivery attempts (email / dashboard /
-- websocket) for observability and retry.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- notifications
-- ----------------------------------------------------------------------------
CREATE TABLE notifications (
    id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    title                  text         NOT NULL,
    message                text         NULL,
    recipient_user_id      uuid         NULL REFERENCES users(id) ON DELETE CASCADE,
    recipient_role         text         NULL,
    sender_user_id         uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    related_module         text         NULL,
    related_entity_type    text         NULL,
    related_entity_id      uuid         NULL,
    is_read                boolean      NOT NULL DEFAULT false,
    created_at             timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notifications_recipient_present_chk
        CHECK (recipient_user_id IS NOT NULL OR recipient_role IS NOT NULL)
);

-- ----------------------------------------------------------------------------
-- notification_templates
--   recipient_roles_json: JSONB array of role_keys, e.g.
--     '["superadmin","ceo","admin_log","finance"]'.
--   Disabling a template (status = 'disabled') suppresses ALL delivery
--   channels for its trigger_event.
-- ----------------------------------------------------------------------------
CREATE TABLE notification_templates (
    id                                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_key                          text         NOT NULL,
    template_name                         text         NOT NULL,
    feature_group                         text         NOT NULL,
    trigger_event                         text         NOT NULL,
    recipient_roles_json                  jsonb        NOT NULL DEFAULT '[]'::jsonb,
    send_email_enabled                    boolean      NOT NULL DEFAULT true,
    send_dashboard_notification_enabled   boolean      NOT NULL DEFAULT true,
    status                                text         NOT NULL DEFAULT 'enabled',
    subject                               text         NULL,
    body                                  text         NULL,
    created_by                            uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                            uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                            timestamptz  NOT NULL DEFAULT now(),
    updated_at                            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_templates_key_unique UNIQUE (template_key),
    CONSTRAINT notification_templates_status_chk CHECK (status IN (
        'enabled','disabled'))
);

-- ----------------------------------------------------------------------------
-- notification_logs
--   Per-channel dispatch log (email dispatch queue, WebSocket push, etc.).
--   attempted_at / completed_at bracket the delivery attempt.
-- ----------------------------------------------------------------------------
CREATE TABLE notification_logs (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    notification_id   uuid         NOT NULL REFERENCES notifications(id) ON DELETE CASCADE,
    channel           text         NOT NULL,
    status            text         NOT NULL,
    error_message     text         NULL,
    attempted_at      timestamptz  NULL,
    completed_at      timestamptz  NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_logs_channel_chk CHECK (channel IN (
        'email','dashboard','websocket')),
    CONSTRAINT notification_logs_status_chk CHECK (status IN (
        'queued','sent','failed','delivered'))
);

-- ----------------------------------------------------------------------------
-- chat_channels
--   channel_type:
--     'role'  = role-to-role channel (e.g. Sales<->Finance)
--     'dm'    = direct 1:1 user channel
--     'group' = ad-hoc multi-user channel
--     'topic' = topic-scoped discussion thread (uses chat_topics)
-- ----------------------------------------------------------------------------
CREATE TABLE chat_channels (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_name  text         NULL,
    channel_type  text         NOT NULL,
    topic         text         NULL,
    created_by    uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    updated_at    timestamptz  NOT NULL DEFAULT now(),
    deleted_at    timestamptz  NULL,
    CONSTRAINT chat_channels_type_chk CHECK (channel_type IN (
        'role','dm','group','topic'))
);

-- ----------------------------------------------------------------------------
-- chat_topics
--   Optional threading inside a channel.
-- ----------------------------------------------------------------------------
CREATE TABLE chat_topics (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id  uuid         NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    topic_name  text         NOT NULL,
    created_by  uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at  timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- chat_messages
-- ----------------------------------------------------------------------------
CREATE TABLE chat_messages (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id        uuid         NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    topic_id          uuid         NULL REFERENCES chat_topics(id) ON DELETE SET NULL,
    sender_user_id    uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    content           text         NOT NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    updated_at        timestamptz  NOT NULL DEFAULT now(),
    deleted_at        timestamptz  NULL
);

-- ----------------------------------------------------------------------------
-- chat_channel_members
--   last_read_message_id tracks the per-user read cursor in the channel.
-- ----------------------------------------------------------------------------
CREATE TABLE chat_channel_members (
    id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    channel_id                uuid         NOT NULL REFERENCES chat_channels(id) ON DELETE CASCADE,
    user_id                   uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    joined_at                 timestamptz  NOT NULL DEFAULT now(),
    last_read_message_id      uuid         NULL REFERENCES chat_messages(id) ON DELETE SET NULL,
    CONSTRAINT chat_channel_members_unique UNIQUE (channel_id, user_id)
);

-- ----------------------------------------------------------------------------
-- chat_message_reads
--   Per-message read receipts (for detailed "seen by" semantics).
-- ----------------------------------------------------------------------------
CREATE TABLE chat_message_reads (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    message_id  uuid         NOT NULL REFERENCES chat_messages(id) ON DELETE CASCADE,
    user_id     uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    read_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT chat_message_reads_unique UNIQUE (message_id, user_id)
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS chat_message_reads;
DROP TABLE IF EXISTS chat_channel_members;
DROP TABLE IF EXISTS chat_messages;
DROP TABLE IF EXISTS chat_topics;
DROP TABLE IF EXISTS chat_channels;
DROP TABLE IF EXISTS notification_logs;
DROP TABLE IF EXISTS notification_templates;
DROP TABLE IF EXISTS notifications;

COMMIT;
