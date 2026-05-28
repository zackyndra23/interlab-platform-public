-- ============================================================================
-- Migration 003: Purchase Orders (master lifecycle)
-- Creates: purchase_orders, purchase_order_status_history,
--          purchase_order_tracking_events
--
-- current_status values (11-stage lifecycle):
--   Registered  (Sales)          Processed    (Sales)
--   Production  (Finance)        Shipped      (Admin & Log)
--   Customs     (Admin & Log)    Arrived      (Admin & Log)
--   Inspected   (Technical)      Delivery     (Admin & Log)
--   Installation (Technical)     BAST         (Technical)
--   Invoice     (Finance)
--
-- customer_id and overdue_attachment_id are forward references; their FK
-- constraints are added by migrations 004 and 012 respectively.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- purchase_orders
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_orders (
    id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    po_number              text         NOT NULL,
    current_status         text         NOT NULL DEFAULT 'Registered',
    created_by_user_id     uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_by_role        text         NULL,
    updated_by_user_id     uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by_role        text         NULL,
    customer_id            uuid         NULL,
    due_at                 timestamptz  NULL,
    overdue_at             timestamptz  NULL,
    overdue_reason         text         NULL,
    overdue_attachment_id  uuid         NULL,
    escalation_sent_at     timestamptz  NULL,
    created_at             timestamptz  NOT NULL DEFAULT now(),
    updated_at             timestamptz  NOT NULL DEFAULT now(),
    deleted_at             timestamptz  NULL,
    CONSTRAINT purchase_orders_po_number_unique UNIQUE (po_number),
    CONSTRAINT purchase_orders_status_chk CHECK (current_status IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice'
    ))
);

-- ----------------------------------------------------------------------------
-- purchase_order_status_history
--   Appended on every PO stage transition. po_number is denormalized for
--   fast lookup and retained history if the PO is later renamed/soft-deleted.
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_order_status_history (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id                uuid         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    po_number            text         NOT NULL,
    status_code          text         NOT NULL,
    status_label         text         NOT NULL,
    updated_by_user_id   uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by_role      text         NULL,
    note                 text         NULL,
    reason_if_delayed    text         NULL,
    attachment_url       text         NULL,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT purchase_order_status_history_status_code_chk CHECK (status_code IN (
        'REGISTERED','PROCESSED','PRODUCTION','SHIPPED','CUSTOMS','ARRIVED',
        'INSPECTED','DELIVERY','INSTALLATION','BAST','INVOICE'
    ))
);

-- ----------------------------------------------------------------------------
-- purchase_order_tracking_events
--   Free-form event log (JSONB payload) for richer tracking queries
--   beyond the canonical status-history append log.
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_order_tracking_events (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    po_id         uuid         NOT NULL REFERENCES purchase_orders(id) ON DELETE CASCADE,
    event_type    text         NOT NULL,
    payload_json  jsonb        NOT NULL DEFAULT '{}'::jsonb,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS purchase_order_tracking_events;
DROP TABLE IF EXISTS purchase_order_status_history;
DROP TABLE IF EXISTS purchase_orders;

COMMIT;
