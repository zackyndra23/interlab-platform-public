-- ============================================================================
-- Migration 022: po_document_types + status history audit columns
-- F4 PO Document → Stage Trigger Map (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE po_document_types (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_key            text         NOT NULL UNIQUE,
    doc_name           text         NOT NULL,
    triggers_stage     text         NULL,
    required_for_stage text         NULL,
    uploader_role_keys jsonb        NOT NULL DEFAULT '[]'::jsonb,
    is_active          boolean      NOT NULL DEFAULT true,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT po_document_types_triggers_chk CHECK (triggers_stage IS NULL OR triggers_stage IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice')),
    CONSTRAINT po_document_types_required_chk CHECK (required_for_stage IS NULL OR required_for_stage IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice'))
);

ALTER TABLE file_attachments
    ADD COLUMN po_document_type_id uuid NULL REFERENCES po_document_types(id) ON DELETE SET NULL;

CREATE INDEX file_attachments_po_doc_idx ON file_attachments (po_document_type_id) WHERE po_document_type_id IS NOT NULL;

ALTER TABLE purchase_order_status_history
    ADD COLUMN is_rejection         boolean NOT NULL DEFAULT false,
    ADD COLUMN is_admin_override    boolean NOT NULL DEFAULT false,
    ADD COLUMN reject_count_after   int     NULL;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE purchase_order_status_history
    DROP COLUMN IF EXISTS reject_count_after,
    DROP COLUMN IF EXISTS is_admin_override,
    DROP COLUMN IF EXISTS is_rejection;
DROP INDEX IF EXISTS file_attachments_po_doc_idx;
ALTER TABLE file_attachments DROP COLUMN IF EXISTS po_document_type_id;
DROP TABLE IF EXISTS po_document_types;
COMMIT;
