-- ============================================================================
-- Migration 007: Finance forms
-- Creates: po_customer_records, purchase_requisitions,
--          invoice_manufactures, invoice_customers
--
-- Forward FKs:
--   * invoice_customers.related_bast_id -> bast_records: constraint added
--     in migration 008.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- po_customer_records
--   Finance-side view of a Sales PO. Auto-created when Sales submits a PO.
-- ----------------------------------------------------------------------------
CREATE TABLE po_customer_records (
    id                             uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    po_customer_record_number      text           NOT NULL,
    po_customer_number             text           NULL,
    related_sales_po_id            uuid           NULL REFERENCES sales_purchase_orders(id) ON DELETE SET NULL,
    related_po_id                  uuid           NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    customer_id                    uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    version                        text           NULL,
    order_date                     date           NULL,
    quotation_reference_id         uuid           NULL REFERENCES quotations(id) ON DELETE SET NULL,
    payment_term_condition         text           NULL,
    delivery_term                  text           NULL,
    term_of_payment                text           NULL,
    warranty                       text           NULL,
    penalty_clause                 text           NULL,
    bill_to                        text           NULL,
    ship_to                        text           NULL,
    currency                       text           NOT NULL DEFAULT 'IDR',
    item_list                      jsonb          NOT NULL DEFAULT '[]'::jsonb,
    subtotal                       numeric(20,2)  NULL,
    tax_percent                    numeric(5,2)   NULL,
    tax_amount                     numeric(20,2)  NULL,
    total_amount                   numeric(20,2)  NULL,
    notes                          text           NULL,
    current_po_status              text           NULL,
    workflow_status                text           NOT NULL DEFAULT 'registered',
    created_by                     uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                     uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                     timestamptz    NOT NULL DEFAULT now(),
    updated_at                     timestamptz    NOT NULL DEFAULT now(),
    deleted_at                     timestamptz    NULL,
    CONSTRAINT po_customer_record_number_unique UNIQUE (po_customer_record_number),
    CONSTRAINT po_customer_workflow_chk CHECK (workflow_status IN (
        'registered','active','invoiced','completed'))
);

-- ----------------------------------------------------------------------------
-- purchase_requisitions
--   Finance-side view of a Sales PR. PO Out fields (po_out_number +
--   po_out_date + attachment) together advance PO to Production stage.
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_requisitions (
    id                              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    pr_record_number                text         NOT NULL,
    related_sales_pr_id             uuid         NULL REFERENCES purchase_requests_sales(id) ON DELETE SET NULL,
    related_po_id                   uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    related_po_customer_id          uuid         NULL REFERENCES po_customer_records(id) ON DELETE SET NULL,
    customer_id                     uuid         NULL REFERENCES customers(id) ON DELETE SET NULL,
    supplier_or_manufacturer        text         NULL,
    manufacturer_contact_person     text         NULL,
    manufacturer_email              text         NULL,
    pr_number                       text         NULL,
    pr_date                         date         NULL,
    currency                        text         NOT NULL DEFAULT 'IDR',
    item_list                       jsonb        NOT NULL DEFAULT '[]'::jsonb,
    incoterm                        text         NULL,
    delivery_time                   text         NULL,
    payment_term                    text         NULL,
    shipping_address                text         NULL,
    notes                           text         NULL,
    po_out_number                   text         NULL,
    po_out_date                     date         NULL,
    current_pr_status               text         NOT NULL DEFAULT 'Registered',
    created_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                      timestamptz  NOT NULL DEFAULT now(),
    updated_at                      timestamptz  NOT NULL DEFAULT now(),
    deleted_at                      timestamptz  NULL,
    CONSTRAINT pr_finance_record_number_unique UNIQUE (pr_record_number),
    CONSTRAINT pr_finance_status_chk CHECK (current_pr_status IN (
        'Registered','Processed'))
);

-- ----------------------------------------------------------------------------
-- invoice_manufactures
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_manufactures (
    id                                   uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_manufacture_record_number    text           NOT NULL,
    related_pr_id                        uuid           NULL REFERENCES purchase_requisitions(id) ON DELETE SET NULL,
    related_po_out_number                text           NULL,
    related_po_id                        uuid           NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    supplier_or_manufacturer             text           NULL,
    invoice_number                       text           NULL,
    invoice_date                         date           NULL,
    due_date                             date           NULL,
    payment_terms                        text           NULL,
    preferred_shipping                   text           NULL,
    incoterm                             text           NULL,
    currency                             text           NOT NULL DEFAULT 'IDR',
    exchange_rate                        numeric(18,6)  NULL,
    item_list                            jsonb          NOT NULL DEFAULT '[]'::jsonb,
    untaxed_amount                       numeric(20,2)  NULL,
    vat_percent                          numeric(5,2)   NULL,
    vat_amount                           numeric(20,2)  NULL,
    total_amount                         numeric(20,2)  NULL,
    bank_name                            text           NULL,
    iban_or_account_number               text           NULL,
    bic_swift                            text           NULL,
    payment_date                         date           NULL,
    payment_amount                       numeric(20,2)  NULL,
    payment_status                       text           NOT NULL DEFAULT 'Unpaid',
    transaction_reference                text           NULL,
    notes                                text           NULL,
    created_by                           uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                           uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                           timestamptz    NOT NULL DEFAULT now(),
    updated_at                           timestamptz    NOT NULL DEFAULT now(),
    deleted_at                           timestamptz    NULL,
    CONSTRAINT invoice_manu_record_number_unique UNIQUE (invoice_manufacture_record_number),
    CONSTRAINT invoice_manu_payment_status_chk CHECK (payment_status IN (
        'Unpaid','Paid'))
);

-- ----------------------------------------------------------------------------
-- invoice_customers
--   Draft is auto-created by Technical BAST submission. Invoice Processed
--   advances PO to Invoice stage.
-- ----------------------------------------------------------------------------
CREATE TABLE invoice_customers (
    id                                uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    invoice_customer_record_number    text           NOT NULL,
    related_po_customer_id            uuid           NULL REFERENCES po_customer_records(id) ON DELETE SET NULL,
    related_bast_id                   uuid           NULL,
    related_do_id                     uuid           NULL REFERENCES delivery_orders(id) ON DELETE SET NULL,
    related_po_id                     uuid           NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    customer_id                       uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    invoice_number                    text           NULL,
    invoice_date                      date           NULL,
    customer_order_number             text           NULL,
    order_date                        date           NULL,
    currency                          text           NOT NULL DEFAULT 'IDR',
    shipping_method                   text           NULL,
    item_list                         jsonb          NOT NULL DEFAULT '[]'::jsonb,
    subtotal                          numeric(20,2)  NULL,
    discount_amount                   numeric(20,2)  NULL,
    tax_base                          numeric(20,2)  NULL,
    vat_percent                       numeric(5,2)   NULL,
    vat_amount                        numeric(20,2)  NULL,
    total_amount                      numeric(20,2)  NULL,
    billing_account_info              text           NULL,
    payment_due_date                  date           NULL,
    invoice_status                    text           NOT NULL DEFAULT 'Registered',
    notes                             text           NULL,
    created_by                        uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                        uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                        timestamptz    NOT NULL DEFAULT now(),
    updated_at                        timestamptz    NOT NULL DEFAULT now(),
    deleted_at                        timestamptz    NULL,
    CONSTRAINT invoice_customer_record_number_unique UNIQUE (invoice_customer_record_number),
    CONSTRAINT invoice_customer_status_chk CHECK (invoice_status IN (
        'Registered','Processed'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS invoice_customers;
DROP TABLE IF EXISTS invoice_manufactures;
DROP TABLE IF EXISTS purchase_requisitions;
DROP TABLE IF EXISTS po_customer_records;

COMMIT;
