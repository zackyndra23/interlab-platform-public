-- ============================================================================
-- Migration 032: multi-termin billing on invoice_customers (Sub-2-lite)
-- Each invoice_customers row = one termin (DP/Termin/Pelunasan/Full) for its PO.
-- Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md §2.1
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS termin_sequence integer;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS termin_label text;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS amount numeric(20,2);
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS due_date date;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS payment_status text NOT NULL DEFAULT 'pending';
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS paid_at timestamptz;
ALTER TABLE invoice_customers ADD COLUMN IF NOT EXISTS payment_method text;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_payment_status_chk;
ALTER TABLE invoice_customers ADD CONSTRAINT invoice_customers_payment_status_chk
  CHECK (payment_status IN ('pending','paid'));
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_termin_label_chk;
ALTER TABLE invoice_customers ADD CONSTRAINT invoice_customers_termin_label_chk
  CHECK (termin_label IS NULL OR termin_label IN ('DP','Termin','Pelunasan','Full'));
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_payment_status_chk;
ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS invoice_customers_termin_label_chk;
ALTER TABLE invoice_customers
  DROP COLUMN IF EXISTS termin_sequence, DROP COLUMN IF EXISTS termin_label,
  DROP COLUMN IF EXISTS amount, DROP COLUMN IF EXISTS due_date,
  DROP COLUMN IF EXISTS payment_status, DROP COLUMN IF EXISTS paid_at,
  DROP COLUMN IF EXISTS payment_method;
COMMIT;
