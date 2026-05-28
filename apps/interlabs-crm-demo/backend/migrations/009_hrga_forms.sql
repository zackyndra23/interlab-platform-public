-- ============================================================================
-- Migration 009: HRGA / Legal forms
-- Creates: hrga_legal_documents, letter_templates, company_letters,
--          hrga_archive_records
--
-- Smart Search: hrga_legal_documents and company_letters carry a
-- generated tsvector column (search_document) used by the HRGA Smart
-- Search UNION query. The GIN indexes over those columns live in
-- migration 014.
--
-- The 'simple' FTS config is used to avoid English-only stemming on
-- Indonesian content (Bahasa Indonesia document names, notary names,
-- Indonesian regulatory identifiers).
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- hrga_legal_documents
-- ----------------------------------------------------------------------------
CREATE TABLE hrga_legal_documents (
    id                               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    legal_document_record_number     text         NOT NULL,
    document_category                text         NULL,
    document_subcategory             text         NULL,
    document_name                    text         NOT NULL,
    document_number                  text         NULL,
    document_year                    integer      NULL,
    issue_date                       date         NULL,
    expiry_date                      date         NULL,
    validity_period_start            date         NULL,
    validity_period_end              date         NULL,
    notary_name                      text         NULL,
    related_customer_id              uuid         NULL REFERENCES customers(id) ON DELETE SET NULL,
    related_principal                text         NULL,
    pic_user_id                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    version_number                   text         NULL,
    document_status                  text         NOT NULL DEFAULT 'Draft',
    tags                             text[]       NOT NULL DEFAULT ARRAY[]::text[],
    notes                            text         NULL,
    access_scope                     text         NOT NULL DEFAULT 'hrga_only',
    superseded_by_id                 uuid         NULL REFERENCES hrga_legal_documents(id) ON DELETE SET NULL,
    reminder_90_days_at              timestamptz  NULL,
    reminder_30_days_at              timestamptz  NULL,
    expired_at                       timestamptz  NULL,
    archived_at                      timestamptz  NULL,
    compliance_flag                  text         NOT NULL DEFAULT 'ok',
    -- search_document is maintained by the trigger defined below rather
    -- than GENERATED ALWAYS: array_to_string on a text[] is not IMMUTABLE
    -- in Postgres 16, which blocks stored-generated expressions.
    search_document                  tsvector     NULL,
    created_by                       uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                       uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                       timestamptz  NOT NULL DEFAULT now(),
    updated_at                       timestamptz  NOT NULL DEFAULT now(),
    deleted_at                       timestamptz  NULL,
    CONSTRAINT hrga_legal_record_number_unique UNIQUE (legal_document_record_number),
    CONSTRAINT hrga_legal_status_chk CHECK (document_status IN (
        'Draft','Active','Expiring Soon','Expired','Superseded','Archived')),
    CONSTRAINT hrga_legal_access_scope_chk CHECK (access_scope IN (
        'hrga_only','all_roles','specific_roles')),
    CONSTRAINT hrga_legal_compliance_flag_chk CHECK (compliance_flag IN (
        'ok','expiring_soon_90','expiring_soon_30','expired'))
);

-- ----------------------------------------------------------------------------
-- letter_templates
-- ----------------------------------------------------------------------------
CREATE TABLE letter_templates (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_name   text         NOT NULL,
    letter_type     text         NOT NULL,
    body_html       text         NOT NULL,
    created_by      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at      timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- company_letters
-- ----------------------------------------------------------------------------
CREATE TABLE company_letters (
    id                              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    letter_record_number            text         NOT NULL,
    letter_type                     text         NULL,
    letter_number                   text         NULL,
    subject                         text         NOT NULL,
    related_employee_id             uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    recipient_name                  text         NULL,
    recipient_role_or_department    text         NULL,
    issue_date                      date         NULL,
    effective_date                  date         NULL,
    reference_number                text         NULL,
    signatory_user_id               uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    template_reference_id           uuid         NULL REFERENCES letter_templates(id) ON DELETE SET NULL,
    letter_status                   text         NOT NULL DEFAULT 'Draft',
    tags                            text[]       NOT NULL DEFAULT ARRAY[]::text[],
    notes                           text         NULL,
    access_scope                    text         NOT NULL DEFAULT 'hrga_only',
    -- See note on hrga_legal_documents.search_document; trigger-maintained.
    search_document                 tsvector     NULL,
    created_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                      timestamptz  NOT NULL DEFAULT now(),
    updated_at                      timestamptz  NOT NULL DEFAULT now(),
    deleted_at                      timestamptz  NULL,
    CONSTRAINT company_letters_record_number_unique UNIQUE (letter_record_number),
    CONSTRAINT company_letters_status_chk CHECK (letter_status IN (
        'Draft','Under Review','Final','Sent','Archived')),
    CONSTRAINT company_letters_access_scope_chk CHECK (access_scope IN (
        'hrga_only','all_roles','specific_roles'))
);

-- ----------------------------------------------------------------------------
-- hrga_archive_records
--   Mirror records for anything archived from hrga_legal_documents or
--   company_letters. source_record_id is a soft pointer (not a FK) because
--   it may reference different source tables per source_module.
-- ----------------------------------------------------------------------------
CREATE TABLE hrga_archive_records (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    archive_record_number   text         NOT NULL,
    source_module           text         NOT NULL,
    source_record_id        uuid         NOT NULL,
    document_name           text         NULL,
    document_category       text         NULL,
    archive_reason          text         NULL,
    archived_by_user_id     uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    archived_at             timestamptz  NOT NULL DEFAULT now(),
    notes                   text         NULL,
    access_scope            text         NOT NULL DEFAULT 'hrga_only',
    created_at              timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT hrga_archive_record_number_unique UNIQUE (archive_record_number),
    CONSTRAINT hrga_archive_source_module_chk CHECK (source_module IN (
        'legalitas','company_letters','other')),
    CONSTRAINT hrga_archive_reason_chk CHECK (
        archive_reason IS NULL OR archive_reason IN ('Superseded','Expired','Withdrawn','Other')),
    CONSTRAINT hrga_archive_access_scope_chk CHECK (access_scope IN (
        'hrga_only','all_roles'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS hrga_archive_records;
DROP TABLE IF EXISTS company_letters;
DROP TABLE IF EXISTS letter_templates;
DROP TABLE IF EXISTS hrga_legal_documents;

COMMIT;
