-- ============================================================================
-- Migration 008: Technical forms
-- Creates: technical_job_orders, installation_records, pm_records,
--          sparepart_records, inspection_qc_records, bast_records
--
-- Closes forward FK from invoice_customers.related_bast_id -> bast_records.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- technical_job_orders
--   support_team_members is a native uuid[] array of users(id). Membership
--   is queryable via = ANY() and the GIN index declared in migration 014.
-- ----------------------------------------------------------------------------
CREATE TABLE technical_job_orders (
    id                             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    technical_job_order_number     text         NOT NULL,
    related_po_id                  uuid         NOT NULL REFERENCES purchase_orders(id) ON DELETE RESTRICT,
    related_po_number              text         NULL,
    customer_id                    uuid         NULL REFERENCES customers(id) ON DELETE SET NULL,
    job_type                       text         NOT NULL,
    planned_start_date             date         NULL,
    planned_end_date               date         NULL,
    work_duration_start            date         NULL,
    work_duration_end              date         NULL,
    assigned_engineer_id           uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    support_team_members           uuid[]       NOT NULL DEFAULT ARRAY[]::uuid[],
    site_location                  text         NULL,
    product_or_equipment_name      text         NULL,
    serial_number                  text         NULL,
    priority                       text         NULL,
    current_technical_status       text         NULL,
    po_due_date                    date         NULL,
    due_date_reminder_flag         boolean      NOT NULL DEFAULT false,
    notes                          text         NULL,
    workflow_status                text         NOT NULL DEFAULT 'draft',
    created_by                     uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                     uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                     timestamptz  NOT NULL DEFAULT now(),
    updated_at                     timestamptz  NOT NULL DEFAULT now(),
    deleted_at                     timestamptz  NULL,
    CONSTRAINT tjo_record_number_unique UNIQUE (technical_job_order_number),
    CONSTRAINT tjo_job_type_chk CHECK (job_type IN (
        'Installation','PM','Sparepart')),
    CONSTRAINT tjo_priority_chk CHECK (
        priority IS NULL OR priority IN ('Low','Medium','High','Critical')),
    CONSTRAINT tjo_workflow_chk CHECK (workflow_status IN (
        'draft','active','completed','cancelled'))
);

-- ----------------------------------------------------------------------------
-- installation_records
-- ----------------------------------------------------------------------------
CREATE TABLE installation_records (
    id                              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    related_job_order_id            uuid         NOT NULL REFERENCES technical_job_orders(id) ON DELETE CASCADE,
    related_po_id                   uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    pre_installation_status         text         NOT NULL DEFAULT 'Pending',
    local_part_request_needed       text         NULL,
    local_part_request_reference    text         NULL,
    finance_local_part_status       text         NULL,
    workshop_check_status           text         NOT NULL DEFAULT 'Pending',
    inspection_status               text         NOT NULL DEFAULT 'Pending',
    document_completeness_status    text         NULL,
    function_test_status            text         NOT NULL DEFAULT 'Pending',
    ready_to_deliver                text         NULL,
    delivery_method                 text         NULL,
    admin_log_response_status       text         NOT NULL DEFAULT 'pending',
    ready_to_deliver_at             timestamptz  NULL,
    installation_schedule_date      date         NULL,
    installation_start_date         date         NULL,
    installation_end_date           date         NULL,
    commissioning_included          text         NULL,
    training_included               text         NULL,
    workflow_phase                  text         NOT NULL DEFAULT 'pre_installation',
    notes                           text         NULL,
    created_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                      uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                      timestamptz  NOT NULL DEFAULT now(),
    updated_at                      timestamptz  NOT NULL DEFAULT now(),
    deleted_at                      timestamptz  NULL,
    CONSTRAINT inst_pre_status_chk CHECK (pre_installation_status IN (
        'Pending','In Progress','Complete')),
    CONSTRAINT inst_local_part_chk CHECK (
        local_part_request_needed IS NULL OR local_part_request_needed IN ('Yes','No')),
    CONSTRAINT inst_workshop_chk CHECK (workshop_check_status IN (
        'Pending','In Progress','Passed','Failed')),
    CONSTRAINT inst_inspection_chk CHECK (inspection_status IN (
        'Pending','In Progress','Complete')),
    CONSTRAINT inst_doc_complete_chk CHECK (
        document_completeness_status IS NULL OR document_completeness_status IN ('Complete','Incomplete')),
    CONSTRAINT inst_function_test_chk CHECK (function_test_status IN (
        'Pending','Pass','Fail')),
    CONSTRAINT inst_ready_to_deliver_chk CHECK (
        ready_to_deliver IS NULL OR ready_to_deliver IN ('Yes','No')),
    CONSTRAINT inst_delivery_method_chk CHECK (
        delivery_method IS NULL OR delivery_method IN ('Pick Up Forwarder','Hand Carry')),
    CONSTRAINT inst_admin_log_response_chk CHECK (admin_log_response_status IN (
        'pending','acknowledged','dispatched')),
    CONSTRAINT inst_commissioning_chk CHECK (
        commissioning_included IS NULL OR commissioning_included IN ('Yes','No')),
    CONSTRAINT inst_training_chk CHECK (
        training_included IS NULL OR training_included IN ('Yes','No')),
    CONSTRAINT inst_workflow_phase_chk CHECK (workflow_phase IN (
        'pre_installation','workshop','ready_to_deliver','scheduling',
        'on_site','commissioning','completed'))
);

-- ----------------------------------------------------------------------------
-- pm_records  (Preventive Maintenance)
-- ----------------------------------------------------------------------------
CREATE TABLE pm_records (
    id                      uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    related_job_order_id    uuid         NOT NULL REFERENCES technical_job_orders(id) ON DELETE CASCADE,
    related_po_id           uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    assigned_engineer_id    uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    pm_schedule_date        date         NULL,
    pm_start_date           date         NULL,
    pm_end_date             date         NULL,
    work_duration_start     date         NULL,
    work_duration_end       date         NULL,
    pm_activity_notes       text         NULL,
    notes                   text         NULL,
    workflow_status         text         NOT NULL DEFAULT 'scheduled',
    created_by              uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by              uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at              timestamptz  NOT NULL DEFAULT now(),
    updated_at              timestamptz  NOT NULL DEFAULT now(),
    deleted_at              timestamptz  NULL,
    CONSTRAINT pm_workflow_chk CHECK (workflow_status IN (
        'scheduled','in_progress','completed'))
);

-- ----------------------------------------------------------------------------
-- sparepart_records
-- ----------------------------------------------------------------------------
CREATE TABLE sparepart_records (
    id                           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    related_job_order_id         uuid         NOT NULL REFERENCES technical_job_orders(id) ON DELETE CASCADE,
    related_po_id                uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    related_awb_id               uuid         NULL REFERENCES awb_records(id) ON DELETE SET NULL,
    workshop_check_status        text         NOT NULL DEFAULT 'Pending',
    ready_to_deliver             text         NULL,
    delivery_method              text         NULL,
    admin_log_response_status    text         NOT NULL DEFAULT 'pending',
    ready_to_deliver_at          timestamptz  NULL,
    notes                        text         NULL,
    workflow_status              text         NOT NULL DEFAULT 'awaiting_awb',
    created_by                   uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                   uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                   timestamptz  NOT NULL DEFAULT now(),
    updated_at                   timestamptz  NOT NULL DEFAULT now(),
    deleted_at                   timestamptz  NULL,
    CONSTRAINT sp_workshop_chk CHECK (workshop_check_status IN (
        'Pending','In Progress','Passed','Failed')),
    CONSTRAINT sp_ready_to_deliver_chk CHECK (
        ready_to_deliver IS NULL OR ready_to_deliver IN ('Yes','No')),
    CONSTRAINT sp_delivery_method_chk CHECK (
        delivery_method IS NULL OR delivery_method IN ('Pick Up Forwarder','Hand Carry')),
    CONSTRAINT sp_admin_log_response_chk CHECK (admin_log_response_status IN (
        'pending','acknowledged','dispatched')),
    CONSTRAINT sp_workflow_chk CHECK (workflow_status IN (
        'awaiting_awb','workshop_check','ready','dispatched'))
);

-- ----------------------------------------------------------------------------
-- inspection_qc_records
-- ----------------------------------------------------------------------------
CREATE TABLE inspection_qc_records (
    id                         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    qc_record_number           text         NOT NULL,
    related_job_order_id       uuid         NULL REFERENCES technical_job_orders(id) ON DELETE SET NULL,
    related_po_id              uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    item_or_equipment_name     text         NULL,
    item_condition             text         NULL,
    defect_category            text         NOT NULL DEFAULT 'None',
    defect_description         text         NULL,
    pic_user_id                uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    qc_result                  text         NULL,
    review_status              text         NOT NULL DEFAULT 'Pending Review',
    final_submit_status        text         NOT NULL DEFAULT 'Draft',
    notes                      text         NULL,
    created_by                 uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                 uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                 timestamptz  NOT NULL DEFAULT now(),
    updated_at                 timestamptz  NOT NULL DEFAULT now(),
    deleted_at                 timestamptz  NULL,
    CONSTRAINT qc_record_number_unique UNIQUE (qc_record_number),
    CONSTRAINT qc_item_condition_chk CHECK (
        item_condition IS NULL OR item_condition IN ('Good','Incomplete','Damaged')),
    CONSTRAINT qc_defect_category_chk CHECK (defect_category IN (
        'None','Physical','Functional','Documentation')),
    CONSTRAINT qc_result_chk CHECK (
        qc_result IS NULL OR qc_result IN ('Pass','Need Fix','Reject')),
    CONSTRAINT qc_review_status_chk CHECK (review_status IN (
        'Pending Review','Reviewed','Approved')),
    CONSTRAINT qc_final_submit_chk CHECK (final_submit_status IN (
        'Draft','Submitted'))
);

-- ----------------------------------------------------------------------------
-- bast_records  (Berita Acara Serah Terima — Completion Docs)
-- ----------------------------------------------------------------------------
CREATE TABLE bast_records (
    id                         uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    bast_record_number         text         NOT NULL,
    related_job_order_id       uuid         NULL REFERENCES technical_job_orders(id) ON DELETE SET NULL,
    related_po_id              uuid         NULL REFERENCES purchase_orders(id) ON DELETE SET NULL,
    customer_id                uuid         NULL REFERENCES customers(id) ON DELETE SET NULL,
    job_type                   text         NULL,
    completion_start_date      date         NULL,
    completion_end_date        date         NULL,
    scope_summary              text         NULL,
    commissioning_included     text         NULL,
    training_included          text         NULL,
    customer_pic               text         NULL,
    technical_pic_id           uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    sent_to_finance            boolean      NOT NULL DEFAULT false,
    sent_to_finance_at         timestamptz  NULL,
    workflow_status            text         NOT NULL DEFAULT 'draft',
    notes                      text         NULL,
    created_by                 uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_by                 uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    created_at                 timestamptz  NOT NULL DEFAULT now(),
    updated_at                 timestamptz  NOT NULL DEFAULT now(),
    deleted_at                 timestamptz  NULL,
    CONSTRAINT bast_record_number_unique UNIQUE (bast_record_number),
    CONSTRAINT bast_job_type_chk CHECK (
        job_type IS NULL OR job_type IN ('Installation','PM','Sparepart')),
    CONSTRAINT bast_commissioning_chk CHECK (
        commissioning_included IS NULL OR commissioning_included IN ('Yes','No')),
    CONSTRAINT bast_training_chk CHECK (
        training_included IS NULL OR training_included IN ('Yes','No')),
    CONSTRAINT bast_workflow_chk CHECK (workflow_status IN (
        'draft','submitted','sent_to_finance'))
);

-- Close forward FK from invoice_customers -> bast_records.
ALTER TABLE invoice_customers
    ADD CONSTRAINT fk_invoice_customers_bast
    FOREIGN KEY (related_bast_id)
    REFERENCES bast_records (id)
    ON DELETE SET NULL;

COMMIT;

-- +migrate Down
BEGIN;

ALTER TABLE invoice_customers DROP CONSTRAINT IF EXISTS fk_invoice_customers_bast;

DROP TABLE IF EXISTS bast_records;
DROP TABLE IF EXISTS inspection_qc_records;
DROP TABLE IF EXISTS sparepart_records;
DROP TABLE IF EXISTS pm_records;
DROP TABLE IF EXISTS installation_records;
DROP TABLE IF EXISTS technical_job_orders;

COMMIT;
