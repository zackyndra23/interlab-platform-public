-- ============================================================================
-- Migration 004: Customers
-- Creates: customers
-- Also closes the forward FK from purchase_orders.customer_id.
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE customers (
    id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    customer_record_number    text         NOT NULL,
    company_name              text         NOT NULL,
    trade_name                text         NULL,
    address                   text         NULL,
    city                      text         NULL,
    country                   text         NULL,
    phone                     text         NULL,
    email                     text         NULL,
    website                   text         NULL,
    npwp                      text         NULL,
    pic_name                  text         NULL,
    pic_phone                 text         NULL,
    pic_email                 text         NULL,
    customer_status           text         NOT NULL DEFAULT 'Active',
    notes                     text         NULL,
    created_by                uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now(),
    deleted_at                timestamptz  NULL,
    CONSTRAINT customers_record_number_unique UNIQUE (customer_record_number),
    CONSTRAINT customers_status_chk CHECK (customer_status IN ('Active','Inactive'))
);

-- Close forward FK from purchase_orders -> customers.
ALTER TABLE purchase_orders
    ADD CONSTRAINT fk_purchase_orders_customer
    FOREIGN KEY (customer_id)
    REFERENCES customers (id)
    ON DELETE SET NULL;

COMMIT;

-- +migrate Down
BEGIN;

ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS fk_purchase_orders_customer;
DROP TABLE IF EXISTS customers;

COMMIT;
