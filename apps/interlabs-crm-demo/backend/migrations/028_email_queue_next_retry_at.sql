-- ============================================================================
-- Migration 028: next_retry_at column for exponential backoff on email_queue
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE email_queue ADD COLUMN next_retry_at timestamptz NULL;
CREATE INDEX email_queue_next_retry_idx ON email_queue (next_retry_at) WHERE status='pending';
COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS email_queue_next_retry_idx;
ALTER TABLE email_queue DROP COLUMN IF EXISTS next_retry_at;
COMMIT;
