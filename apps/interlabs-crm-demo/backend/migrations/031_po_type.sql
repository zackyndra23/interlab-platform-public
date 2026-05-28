-- ============================================================================
-- Migration 031: po_type on purchase_orders (Sub-2-lite)
-- service | supply | installation. Default 'installation' = the existing full
-- 11-stage path, so legacy rows + behavior are unchanged.
-- Spec: docs/superpowers/specs/2026-05-26-sub2-lite-po-types-and-dummy-seeder-design.md §2.1
-- ============================================================================

-- +migrate Up
BEGIN;
ALTER TABLE purchase_orders
  ADD COLUMN IF NOT EXISTS po_type text NOT NULL DEFAULT 'installation';
ALTER TABLE purchase_orders
  DROP CONSTRAINT IF EXISTS purchase_orders_po_type_chk;
ALTER TABLE purchase_orders
  ADD CONSTRAINT purchase_orders_po_type_chk
  CHECK (po_type IN ('service','supply','installation'));
COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE purchase_orders DROP CONSTRAINT IF EXISTS purchase_orders_po_type_chk;
ALTER TABLE purchase_orders DROP COLUMN IF EXISTS po_type;
COMMIT;
