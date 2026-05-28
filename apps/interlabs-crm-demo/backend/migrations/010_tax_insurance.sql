-- ============================================================================
-- Migration 010: Tax & Insurance
-- Creates: tax_operational_records, tax_operational_audit_log
--
-- Indonesian tax compliance records (SSP payment + SPT reporting).
-- Masa Pajak is stored as DATE (first day of the reporting month);
-- Tahun Pajak is the reporting year integer.
--
-- Conditional field visibility (tax_category = SSP Payment hides SPT
-- fields, etc.) is enforced at the service + UI layers — not as database
-- constraints — so all fields remain nullable.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- tax_operational_records
-- ----------------------------------------------------------------------------
CREATE TABLE tax_operational_records (
    id                                 uuid           PRIMARY KEY DEFAULT gen_random_uuid(),
    tax_operational_record_number      text           NOT NULL,

    -- Tax classification
    tax_type                           text           NOT NULL,
    tax_category                       text           NOT NULL,

    -- Tax period
    masa_pajak                         date           NULL,
    masa_pajak_month                   integer        NULL,
    masa_pajak_year                    integer        NULL,
    tahun_pajak                        integer        NULL,

    -- Taxpayer identity
    npwp                               text           NOT NULL,
    taxpayer_name                      text           NULL,
    taxpayer_address                   text           NULL,

    -- SPT data
    jenis_spt                          text           NULL,
    status_spt                         text           NULL,
    reporting_date                     date           NULL,

    -- SSP / billing data
    billing_code                       text           NULL,
    ntpn                               text           NULL,
    ntb                                text           NULL,
    stan                               text           NULL,
    bank_name                          text           NULL,
    payment_date                       date           NULL,
    amount                             numeric(20,2)  NULL,
    currency                           text           NOT NULL DEFAULT 'IDR',

    -- Status & assignment
    payment_status                     text           NOT NULL DEFAULT 'Unpaid',
    record_status                      text           NOT NULL DEFAULT 'Draft',
    pic_user_id                        uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    notes                              text           NULL,

    -- Audit
    created_by                         uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                         uuid           NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                         timestamptz    NOT NULL DEFAULT now(),
    updated_at                         timestamptz    NOT NULL DEFAULT now(),
    deleted_at                         timestamptz    NULL,

    CONSTRAINT tax_op_record_number_unique UNIQUE (tax_operational_record_number),
    CONSTRAINT tax_op_tax_type_chk CHECK (tax_type IN (
        'PPh 21','PPh 25','PPN','Others')),
    CONSTRAINT tax_op_tax_category_chk CHECK (tax_category IN (
        'SSP Payment','SPT Reporting','Combined Record')),
    CONSTRAINT tax_op_jenis_spt_chk CHECK (
        jenis_spt IS NULL OR jenis_spt IN ('SPT Tahunan','SPT Masa')),
    CONSTRAINT tax_op_status_spt_chk CHECK (
        status_spt IS NULL OR status_spt IN ('Normal','Pembetulan')),
    CONSTRAINT tax_op_payment_status_chk CHECK (payment_status IN (
        'Unpaid','Paid','Pending','Failed')),
    CONSTRAINT tax_op_record_status_chk CHECK (record_status IN (
        'Draft','Submitted','Verified','Archived')),
    CONSTRAINT tax_op_masa_pajak_month_chk CHECK (
        masa_pajak_month IS NULL OR (masa_pajak_month BETWEEN 1 AND 12))
);

-- ----------------------------------------------------------------------------
-- tax_operational_audit_log
--   Immutable mutation log (create, update, status change, archive).
--   changed_fields is a JSONB diff: { field: { old: ..., new: ... }, ... }.
-- ----------------------------------------------------------------------------
CREATE TABLE tax_operational_audit_log (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    record_id        uuid         NOT NULL REFERENCES tax_operational_records(id) ON DELETE CASCADE,
    action           text         NOT NULL,
    changed_fields   jsonb        NOT NULL DEFAULT '{}'::jsonb,
    actor_user_id    uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_role       text         NULL,
    created_at       timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT tax_op_audit_action_chk CHECK (action IN (
        'created','updated','status_changed','archived'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS tax_operational_audit_log;
DROP TABLE IF EXISTS tax_operational_records;

COMMIT;
