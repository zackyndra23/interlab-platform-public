-- ============================================================================
-- Migration 013: SLA tracking, workflow history, and To-Do items
-- Creates: sla_tracking, workflow_step_history, todo_items
--
-- sla_tracking is the generic per-entity deadline store used by the
-- sla_sales_po_monitor, sla_sales_form_monitor, and
-- sla_technical_ready_to_deliver background jobs.
--
-- workflow_step_history is a generic append-only step log for any entity
-- with a multi-step workflow (Sales forms, Installation phases, QC review,
-- BAST submission, etc.). It complements purchase_order_status_history
-- without duplicating it.
--
-- todo_items powers the To-Do icon in the TopBar.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- sla_tracking
-- ----------------------------------------------------------------------------
CREATE TABLE sla_tracking (
    id                     uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type            text         NOT NULL,
    entity_id              uuid         NOT NULL,
    stage                  text         NULL,
    due_at                 timestamptz  NULL,
    overdue_at             timestamptz  NULL,
    escalation_sent_at     timestamptz  NULL,
    overdue_reason         text         NULL,
    overdue_attachment_id  uuid         NULL REFERENCES file_attachments(id) ON DELETE SET NULL,
    created_at             timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- workflow_step_history
-- ----------------------------------------------------------------------------
CREATE TABLE workflow_step_history (
    id               uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    entity_type      text         NOT NULL,
    entity_id        uuid         NOT NULL,
    step_name        text         NOT NULL,
    step_status      text         NOT NULL,
    actor_user_id    uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    actor_role       text         NULL,
    note             text         NULL,
    created_at       timestamptz  NOT NULL DEFAULT now()
);

-- ----------------------------------------------------------------------------
-- todo_items
-- ----------------------------------------------------------------------------
CREATE TABLE todo_items (
    id                   uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id              uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    role                 text         NULL,
    title                text         NOT NULL,
    description          text         NULL,
    deadline             timestamptz  NULL,
    status               text         NOT NULL DEFAULT 'open',
    related_module       text         NULL,
    related_entity_id    uuid         NULL,
    created_at           timestamptz  NOT NULL DEFAULT now(),
    updated_at           timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT todo_items_status_chk CHECK (status IN (
        'open','in_progress','completed','cancelled'))
);

COMMIT;

-- +migrate Down
BEGIN;

DROP TABLE IF EXISTS todo_items;
DROP TABLE IF EXISTS workflow_step_history;
DROP TABLE IF EXISTS sla_tracking;

COMMIT;
