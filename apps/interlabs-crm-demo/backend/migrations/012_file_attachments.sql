-- ============================================================================
-- Migration 012: File attachments
-- Creates: file_attachments
--
-- Metadata row for every file stored in MinIO. Per CTX_architecture the
-- MinIO bucket strategy is:
--   bucket=avatars     path avatars/defaults/{role}.png or avatars/users/{user_id}/{filename}
--   bucket=attachments path attachments/{module}/{entity_id}/{file_id}_{original_filename}
--
-- Files are private; access is always via time-limited presigned URLs
-- (download 15 min, upload 5 min).
--
-- Closes the forward FK from sales_purchase_orders.overdue_attachment_id
-- and from purchase_orders.overdue_attachment_id.
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE file_attachments (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    original_filename       text         NOT NULL,
    mime_type               text         NOT NULL,
    extension               text         NULL,
    uploaded_by             uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    uploaded_at             timestamptz  NOT NULL DEFAULT now(),
    related_module          text         NOT NULL,
    related_entity_id       uuid         NULL,
    storage_bucket          text         NOT NULL,
    storage_path            text         NOT NULL,
    size_bytes              bigint       NULL,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    deleted_at              timestamptz  NULL,
    CONSTRAINT file_attachments_storage_path_unique UNIQUE (storage_bucket, storage_path)
);

-- Close forward FKs that reference file_attachments.
ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_overdue_attachment
    FOREIGN KEY (overdue_attachment_id)
    REFERENCES file_attachments (id)
    ON DELETE SET NULL;

ALTER TABLE sales_purchase_orders
    ADD CONSTRAINT fk_sales_po_overdue_attachment
    FOREIGN KEY (overdue_attachment_id)
    REFERENCES file_attachments (id)
    ON DELETE SET NULL;

COMMIT;

-- +migrate Down
BEGIN;

ALTER TABLE sales_purchase_orders DROP CONSTRAINT IF EXISTS fk_sales_po_overdue_attachment;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS fk_purchase_orders_overdue_attachment;

DROP TABLE IF EXISTS file_attachments;

COMMIT;
