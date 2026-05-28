-- ============================================================================
-- Migration 006: Admin & Log forms
-- Creates: awb_records, awb_status_history,
--          delivery_orders, delivery_order_status_history,
--          admin_operational_records
--
-- AWB and DO records drive PO lifecycle stage automation from the service
-- layer; the status-history tables here are per-entity audit logs that
-- complement (not replace) purchase_order_status_history.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- awb_records
-- ----------------------------------------------------------------------------
CREATE TABLE awb_records (
    id                         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    awb_record_number          text           NOT NULL,
    related_po_id              uuid           NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    related_po_number          text           NULL,
    customer_id                uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    supplier_or_manufacturer   text           NULL,
    forwarder_or_courier       text           NULL,
    awb_tracking_number        text           NULL,
    shipment_method            text           NULL,
    origin_country             text           NULL,
    transit_country_or_hub     text           NULL,
    destination                text           NULL,
    despatch_date              date           NULL,
    transit_date               date           NULL,
    arrival_date               date           NULL,
    current_awb_status         text           NOT NULL DEFAULT 'Registered',
    weight_kg                  numeric(12,3)  NULL,
    package_count              integer        NULL,
    description_of_goods       text           NULL,
    incoterm                   text           NULL,
    notes                      text           NULL,
    created_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                 timestamptz    NOT NULL DEFAULT now(),
    updated_at                 timestamptz    NOT NULL DEFAULT now(),
    deleted_at                 timestamptz    NULL,
    CONSTRAINT awb_record_number_unique UNIQUE (awb_record_number),
    CONSTRAINT awb_shipment_method_chk CHECK (
        shipment_method IS NULL OR shipment_method IN ('Air','Sea','Land','Courier')),
    CONSTRAINT awb_current_status_chk CHECK (current_awb_status IN (
        'Registered','Processed','Arrived'))
);

-- ----------------------------------------------------------------------------
-- awb_status_history
-- ----------------------------------------------------------------------------
CREATE TABLE awb_status_history (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    awb_id               uuid         NOT NULL REFERENCES awb_records(id) ON DELETE CASCADE,
    status_code          text         NOT NULL,
    updated_by_user_id   uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by_role      text         NULL,
    note                 text         NULL,
    attachment_url       text         NULL,
    created_at           timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- delivery_orders
-- ----------------------------------------------------------------------------
CREATE TABLE delivery_orders (
    id                                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    do_record_number                       text         NOT NULL,
    related_po_id                          uuid         NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    related_po_number                      text         NULL,
    customer_id                            uuid         NULL REFERENCES customers(id) ON DELETE SET NULL,
    delivery_order_number                  text         NULL,
    delivery_date                          date         NULL,
    shipping_method                        text         NULL,
    courier_or_expedition_vendor           text         NULL,
    dispatch_from                          text         NULL,
    delivery_address                       text         NULL,
    invoicing_address                      text         NULL,
    item_list                              jsonb        NOT NULL DEFAULT '[]'::jsonb,
    technical_inspection_reference_date    date         NULL,
    customer_arrival_date                  date         NULL,
    current_do_status                      text         NOT NULL DEFAULT 'Registered',
    remarks                                text         NULL,
    created_by                             uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                             uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                             timestamptz  NOT NULL DEFAULT now(),
    updated_at                             timestamptz  NOT NULL DEFAULT now(),
    deleted_at                             timestamptz  NULL,
    CONSTRAINT do_record_number_unique UNIQUE (do_record_number),
    CONSTRAINT do_current_status_chk CHECK (current_do_status IN (
        'Registered','Arrived'))
);

-- ----------------------------------------------------------------------------
-- delivery_order_status_history
-- ----------------------------------------------------------------------------
CREATE TABLE delivery_order_status_history (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    do_id                uuid         NOT NULL REFERENCES delivery_orders(id) ON DELETE CASCADE,
    status_code          text         NOT NULL,
    updated_by_user_id   uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by_role      text         NULL,
    note                 text         NULL,
    attachment_url       text         NULL,
    created_at           timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- admin_operational_records
--   reporting_month is stored as DATE (the first day of the month).
--   period_start/end capture the optional multi-day date-range field.
-- ----------------------------------------------------------------------------
CREATE TABLE admin_operational_records (
    id                           uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    operational_record_number    text           NOT NULL,
    reporting_month              date           NOT NULL,
    department                   text           NULL,
    expense_category             text           NULL,
    expense_subcategory          text           NULL,
    transaction_date             date           NULL,
    period_start                 date           NULL,
    period_end                   date           NULL,
    vendor_or_payee              text           NULL,
    related_po_id                uuid           NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    description                  text           NULL,
    currency                     text           NOT NULL DEFAULT 'IDR',
    amount                       numeric(20,2)  NULL,
    payment_method               text           NULL,
    expense_status               text           NOT NULL DEFAULT 'Pending',
    workflow_status              text           NOT NULL DEFAULT 'draft',
    notes                        text           NULL,
    created_by                   uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                   uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                   timestamptz    NOT NULL DEFAULT now(),
    updated_at                   timestamptz    NOT NULL DEFAULT now(),
    deleted_at                   timestamptz    NULL,
    CONSTRAINT admin_op_record_number_unique UNIQUE (operational_record_number),
    CONSTRAINT admin_op_payment_method_chk CHECK (
        payment_method IS NULL OR payment_method IN ('Cash','Transfer','Credit Card')),
    CONSTRAINT admin_op_expense_status_chk CHECK (expense_status IN (
        'Pending','Paid','Cancelled')),
    CONSTRAINT admin_op_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','reviewed'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS admin_operational_records;
DROP TABLE IF EXISTS delivery_order_status_history;
DROP TABLE IF EXISTS delivery_orders;
DROP TABLE IF EXISTS awb_status_history;
DROP TABLE IF EXISTS awb_records;

COMMIT;
