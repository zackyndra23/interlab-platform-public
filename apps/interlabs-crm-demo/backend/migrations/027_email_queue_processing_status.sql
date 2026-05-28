-- ============================================================================
-- Migration 027: add 'processing' status to email_queue
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_status_chk;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_status_chk
  CHECK (status IN ('pending','processing','sent','failed'));
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE email_queue DROP CONSTRAINT IF EXISTS email_queue_status_chk;
ALTER TABLE email_queue ADD CONSTRAINT email_queue_status_chk
  CHECK (status IN ('pending','sent','failed'));
COMMIT;
