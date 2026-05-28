-- ============================================================================
-- Migration 025: email_queue.sender_id column
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE email_queue
    ADD COLUMN sender_id uuid NULL REFERENCES notification_senders(id) ON DELETE SET NULL;
CREATE INDEX email_queue_sender_idx ON email_queue (sender_id) WHERE sender_id IS NOT NULL;
COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS email_queue_sender_idx;
ALTER TABLE email_queue DROP COLUMN IF EXISTS sender_id;
COMMIT;
