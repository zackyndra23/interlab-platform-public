-- ============================================================================
-- Migration 005: Sales forms
-- Creates: sales_forecasts, quotations, harga_pokok_penjualan,
--          sales_purchase_orders, purchase_requests_sales
--
-- Conventions:
--   * item_list columns are JSONB arrays of line-item objects (shape defined
--     by each form spec). Line items are flexible form payload — not
--     referenced by other tables, so they are not normalized into a
--     separate child table.
--   * Currency columns are plain text (IDR / USD / EUR and future codes).
--   * Amount columns use NUMERIC(20,2).
--   * Percent columns use NUMERIC(5,2) (0.00 .. 100.00).
--   * SLA monitoring columns (workflow_status, current_step, step_due_at,
--     step_status, last_progress_at) are repeated on every Sales form per
--     MOD_sales.txt — each form is monitored independently by the
--     sla_sales_form_monitor job.
--
-- Forward FKs:
--   * overdue_attachment_id on sales_purchase_orders -> file_attachments
--     is added in migration 012.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- sales_forecasts
-- ----------------------------------------------------------------------------
CREATE TABLE sales_forecasts (
    id                         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    forecast_record_number     text           NOT NULL,
    customer_id                uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    product_or_service_name    text           NOT NULL,
    description                text           NULL,
    forecast_period_start      date           NULL,
    forecast_period_end        date           NULL,
    currency                   text           NOT NULL DEFAULT 'IDR',
    estimated_value            numeric(20,2)  NULL,
    probability_percent        numeric(5,2)   NULL,
    stage                      text           NOT NULL DEFAULT 'Prospect',
    expected_close_date        date           NULL,
    pic_user_id                uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    notes                      text           NULL,
    workflow_status            text           NOT NULL DEFAULT 'draft',
    current_step               text           NULL,
    step_due_at                timestamptz    NULL,
    step_status                text           NOT NULL DEFAULT 'on_track',
    last_progress_at           timestamptz    NULL,
    created_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                 timestamptz    NOT NULL DEFAULT now(),
    updated_at                 timestamptz    NOT NULL DEFAULT now(),
    deleted_at                 timestamptz    NULL,
    CONSTRAINT sales_forecasts_record_number_unique UNIQUE (forecast_record_number),
    CONSTRAINT sales_forecasts_stage_chk CHECK (stage IN (
        'Prospect','Qualified','Proposal','Negotiation','Won','Lost')),
    CONSTRAINT sales_forecasts_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','closed')),
    CONSTRAINT sales_forecasts_step_status_chk CHECK (step_status IN (
        'on_track','overdue')),
    CONSTRAINT sales_forecasts_probability_chk CHECK (
        probability_percent IS NULL OR (probability_percent >= 0 AND probability_percent <= 100))
);

-- ----------------------------------------------------------------------------
-- quotations
-- ----------------------------------------------------------------------------
CREATE TABLE quotations (
    id                         uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    quotation_record_number    text           NOT NULL,
    quotation_number           text           NULL,
    customer_id                uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    related_forecast_id        uuid           NULL REFERENCES sales_forecasts(id) ON DELETE SET NULL,
    quotation_date             date           NULL,
    validity_date              date           NULL,
    currency                   text           NOT NULL DEFAULT 'IDR',
    item_list                  jsonb          NOT NULL DEFAULT '[]'::jsonb,
    subtotal                   numeric(20,2)  NULL,
    discount_percent           numeric(5,2)   NULL,
    discount_amount            numeric(20,2)  NULL,
    tax_percent                numeric(5,2)   NULL,
    tax_amount                 numeric(20,2)  NULL,
    total_amount               numeric(20,2)  NULL,
    payment_terms              text           NULL,
    delivery_terms             text           NULL,
    warranty_terms             text           NULL,
    notes                      text           NULL,
    workflow_status            text           NOT NULL DEFAULT 'draft',
    current_step               text           NULL,
    step_due_at                timestamptz    NULL,
    step_status                text           NOT NULL DEFAULT 'on_track',
    last_progress_at           timestamptz    NULL,
    created_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                 uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                 timestamptz    NOT NULL DEFAULT now(),
    updated_at                 timestamptz    NOT NULL DEFAULT now(),
    deleted_at                 timestamptz    NULL,
    CONSTRAINT quotations_record_number_unique UNIQUE (quotation_record_number),
    CONSTRAINT quotations_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','revised','accepted','rejected')),
    CONSTRAINT quotations_step_status_chk CHECK (step_status IN (
        'on_track','overdue'))
);

-- ----------------------------------------------------------------------------
-- harga_pokok_penjualan  (HPP — Cost of Goods Sold)
-- ----------------------------------------------------------------------------
CREATE TABLE harga_pokok_penjualan (
    id                      uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    hpp_record_number       text           NOT NULL,
    customer_id             uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    related_quotation_id    uuid           NULL REFERENCES quotations(id) ON DELETE SET NULL,
    hpp_date                date           NULL,
    currency                text           NOT NULL DEFAULT 'IDR',
    item_list               jsonb          NOT NULL DEFAULT '[]'::jsonb,
    total_cost              numeric(20,2)  NULL,
    total_selling_price     numeric(20,2)  NULL,
    gross_margin_total      numeric(20,2)  NULL,
    notes                   text           NULL,
    workflow_status         text           NOT NULL DEFAULT 'draft',
    current_step            text           NULL,
    step_due_at             timestamptz    NULL,
    step_status             text           NOT NULL DEFAULT 'on_track',
    last_progress_at        timestamptz    NULL,
    created_by              uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by              uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz    NOT NULL DEFAULT now(),
    updated_at              timestamptz    NOT NULL DEFAULT now(),
    deleted_at              timestamptz    NULL,
    CONSTRAINT hpp_record_number_unique UNIQUE (hpp_record_number),
    CONSTRAINT hpp_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','approved')),
    CONSTRAINT hpp_step_status_chk CHECK (step_status IN (
        'on_track','overdue'))
);

-- ----------------------------------------------------------------------------
-- sales_purchase_orders
--   Sales-side PO form. On first submit, a matching purchase_orders record
--   is created (status = Registered) and po_id is back-filled here.
-- ----------------------------------------------------------------------------
CREATE TABLE sales_purchase_orders (
    id                        uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    po_record_number          text           NOT NULL,
    po_number                 text           NULL,
    customer_id               uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    related_quotation_id      uuid           NULL REFERENCES quotations(id) ON DELETE SET NULL,
    order_date                date           NULL,
    delivery_deadline         date           NULL,
    currency                  text           NOT NULL DEFAULT 'IDR',
    payment_terms             text           NULL,
    delivery_terms            text           NULL,
    item_list                 jsonb          NOT NULL DEFAULT '[]'::jsonb,
    subtotal                  numeric(20,2)  NULL,
    tax_amount                numeric(20,2)  NULL,
    total_amount              numeric(20,2)  NULL,
    notes                     text           NULL,
    po_id                     uuid           NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    workflow_status           text           NOT NULL DEFAULT 'draft',
    current_step              text           NULL,
    step_due_at               timestamptz    NULL,
    step_status               text           NOT NULL DEFAULT 'on_track',
    last_progress_at          timestamptz    NULL,
    overdue_reason            text           NULL,
    overdue_attachment_id     uuid           NULL,
    created_by                uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                timestamptz    NOT NULL DEFAULT now(),
    updated_at                timestamptz    NOT NULL DEFAULT now(),
    deleted_at                timestamptz    NULL,
    CONSTRAINT sales_po_record_number_unique UNIQUE (po_record_number),
    CONSTRAINT sales_po_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','processed','overdue')),
    CONSTRAINT sales_po_step_status_chk CHECK (step_status IN (
        'on_track','overdue'))
);

-- ----------------------------------------------------------------------------
-- purchase_requests_sales
--   Sales-initiated PR. On submit, a matching purchase_requisitions record
--   is created in Finance (migration 007).
-- ----------------------------------------------------------------------------
CREATE TABLE purchase_requests_sales (
    id                          uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    pr_record_number            text           NOT NULL,
    related_po_id               uuid           NULL REFERENCES sales_purchase_orders(id) ON DELETE SET NULL,
    customer_id                 uuid           NULL REFERENCES customers(id) ON DELETE SET NULL,
    supplier_or_manufacturer    text           NULL,
    manufacturer_contact        text           NULL,
    manufacturer_email          text           NULL,
    pr_date                     date           NULL,
    currency                    text           NOT NULL DEFAULT 'IDR',
    item_list                   jsonb          NOT NULL DEFAULT '[]'::jsonb,
    incoterm                    text           NULL,
    delivery_time               text           NULL,
    payment_terms               text           NULL,
    shipping_address            text           NULL,
    notes                       text           NULL,
    workflow_status             text           NOT NULL DEFAULT 'draft',
    current_step                text           NULL,
    step_due_at                 timestamptz    NULL,
    step_status                 text           NOT NULL DEFAULT 'on_track',
    last_progress_at            timestamptz    NULL,
    created_by                  uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                  uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                  timestamptz    NOT NULL DEFAULT now(),
    updated_at                  timestamptz    NOT NULL DEFAULT now(),
    deleted_at                  timestamptz    NULL,
    CONSTRAINT pr_sales_record_number_unique UNIQUE (pr_record_number),
    CONSTRAINT pr_sales_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','copied_to_finance')),
    CONSTRAINT pr_sales_step_status_chk CHECK (step_status IN (
        'on_track','overdue'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS purchase_requests_sales;
DROP TABLE IF EXISTS sales_purchase_orders;
DROP TABLE IF EXISTS harga_pokok_penjualan;
DROP TABLE IF EXISTS quotations;
DROP TABLE IF EXISTS sales_forecasts;

COMMIT;
