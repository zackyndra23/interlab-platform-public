-- ============================================================================
-- Migration 014: Performance indexes
--
-- All indexes explicitly called out in IMPL_backend.txt Phase B2, plus
-- foreign-key indexes on heavy-traffic columns (PO joins, customer joins,
-- SLA-monitor scans) per the CTX_architecture design principle
-- "Indexing: index on foreign keys, (role + entity_id) pairs,
-- (recipient_user_id, is_read)".
--
-- UNIQUE-constraint-backed indexes are NOT repeated here (Postgres already
-- creates them with the constraint).
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- Auth & Users
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_users_role              ON users (role);
CREATE INDEX IF NOT EXISTS idx_user_sessions_user_id   ON user_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_user_sessions_expires   ON user_sessions (expires_at);

-- ----------------------------------------------------------------------------
-- Purchase Orders (core lifecycle)
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_po_current_status       ON purchase_orders (current_status);
CREATE INDEX IF NOT EXISTS idx_po_created_by_user      ON purchase_orders (created_by_user_id);
CREATE INDEX IF NOT EXISTS idx_po_customer_id          ON purchase_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_po_due_at               ON purchase_orders (due_at);

CREATE INDEX IF NOT EXISTS idx_po_status_history_po_id    ON purchase_order_status_history (po_id);
CREATE INDEX IF NOT EXISTS idx_po_status_history_created  ON purchase_order_status_history (created_at);
CREATE INDEX IF NOT EXISTS idx_po_status_history_po_time  ON purchase_order_status_history (po_id, created_at DESC);

CREATE INDEX IF NOT EXISTS idx_po_tracking_events_po_id   ON purchase_order_tracking_events (po_id);

-- ----------------------------------------------------------------------------
-- Customers
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_customers_company_name_trgm
    ON customers USING gin (company_name gin_trgm_ops);

-- ----------------------------------------------------------------------------
-- Sales forms
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sales_forecasts_customer   ON sales_forecasts (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_forecasts_pic        ON sales_forecasts (pic_user_id);
CREATE INDEX IF NOT EXISTS idx_sales_forecasts_step_due   ON sales_forecasts (step_due_at);
CREATE INDEX IF NOT EXISTS idx_sales_forecasts_step_stat  ON sales_forecasts (step_status);

CREATE INDEX IF NOT EXISTS idx_quotations_customer        ON quotations (customer_id);
CREATE INDEX IF NOT EXISTS idx_quotations_forecast        ON quotations (related_forecast_id);
CREATE INDEX IF NOT EXISTS idx_quotations_step_due        ON quotations (step_due_at);

CREATE INDEX IF NOT EXISTS idx_hpp_customer               ON harga_pokok_penjualan (customer_id);
CREATE INDEX IF NOT EXISTS idx_hpp_quotation              ON harga_pokok_penjualan (related_quotation_id);

CREATE INDEX IF NOT EXISTS idx_sales_po_customer          ON sales_purchase_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_sales_po_po_id             ON sales_purchase_orders (po_id);
CREATE INDEX IF NOT EXISTS idx_sales_po_step_due          ON sales_purchase_orders (step_due_at);
CREATE INDEX IF NOT EXISTS idx_sales_po_step_status       ON sales_purchase_orders (step_status);

CREATE INDEX IF NOT EXISTS idx_pr_sales_related_po        ON purchase_requests_sales (related_po_id);
CREATE INDEX IF NOT EXISTS idx_pr_sales_customer          ON purchase_requests_sales (customer_id);

-- ----------------------------------------------------------------------------
-- Admin & Log forms
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_awb_related_po             ON awb_records (related_po_id);
CREATE INDEX IF NOT EXISTS idx_awb_customer               ON awb_records (customer_id);
CREATE INDEX IF NOT EXISTS idx_awb_current_status         ON awb_records (current_awb_status);
CREATE INDEX IF NOT EXISTS idx_awb_status_history_awb_id  ON awb_status_history (awb_id);

CREATE INDEX IF NOT EXISTS idx_do_related_po              ON delivery_orders (related_po_id);
CREATE INDEX IF NOT EXISTS idx_do_customer                ON delivery_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_do_current_status          ON delivery_orders (current_do_status);
CREATE INDEX IF NOT EXISTS idx_do_status_history_do_id    ON delivery_order_status_history (do_id);

CREATE INDEX IF NOT EXISTS idx_admin_op_reporting_month   ON admin_operational_records (reporting_month);
CREATE INDEX IF NOT EXISTS idx_admin_op_category          ON admin_operational_records (expense_category);
CREATE INDEX IF NOT EXISTS idx_admin_op_related_po        ON admin_operational_records (related_po_id);

-- ----------------------------------------------------------------------------
-- Finance forms
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_po_customer_sales_po       ON po_customer_records (related_sales_po_id);
CREATE INDEX IF NOT EXISTS idx_po_customer_po             ON po_customer_records (related_po_id);
CREATE INDEX IF NOT EXISTS idx_po_customer_customer       ON po_customer_records (customer_id);
CREATE INDEX IF NOT EXISTS idx_po_customer_quotation      ON po_customer_records (quotation_reference_id);

CREATE INDEX IF NOT EXISTS idx_pr_finance_sales_pr        ON purchase_requisitions (related_sales_pr_id);
CREATE INDEX IF NOT EXISTS idx_pr_finance_po              ON purchase_requisitions (related_po_id);
CREATE INDEX IF NOT EXISTS idx_pr_finance_po_customer     ON purchase_requisitions (related_po_customer_id);
CREATE INDEX IF NOT EXISTS idx_pr_finance_customer        ON purchase_requisitions (customer_id);
CREATE INDEX IF NOT EXISTS idx_pr_finance_status          ON purchase_requisitions (current_pr_status);

CREATE INDEX IF NOT EXISTS idx_invoice_manu_pr            ON invoice_manufactures (related_pr_id);
CREATE INDEX IF NOT EXISTS idx_invoice_manu_po            ON invoice_manufactures (related_po_id);
CREATE INDEX IF NOT EXISTS idx_invoice_manu_due_date      ON invoice_manufactures (due_date);
CREATE INDEX IF NOT EXISTS idx_invoice_manu_pay_status    ON invoice_manufactures (payment_status);

CREATE INDEX IF NOT EXISTS idx_invoice_cust_po_customer   ON invoice_customers (related_po_customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_cust_bast          ON invoice_customers (related_bast_id);
CREATE INDEX IF NOT EXISTS idx_invoice_cust_do            ON invoice_customers (related_do_id);
CREATE INDEX IF NOT EXISTS idx_invoice_cust_po            ON invoice_customers (related_po_id);
CREATE INDEX IF NOT EXISTS idx_invoice_cust_customer      ON invoice_customers (customer_id);
CREATE INDEX IF NOT EXISTS idx_invoice_cust_status        ON invoice_customers (invoice_status);

-- ----------------------------------------------------------------------------
-- Technical forms
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tjo_related_po             ON technical_job_orders (related_po_id);
CREATE INDEX IF NOT EXISTS idx_tjo_customer               ON technical_job_orders (customer_id);
CREATE INDEX IF NOT EXISTS idx_tjo_engineer               ON technical_job_orders (assigned_engineer_id);
CREATE INDEX IF NOT EXISTS idx_tjo_po_due_date            ON technical_job_orders (po_due_date);
CREATE INDEX IF NOT EXISTS idx_tjo_job_type               ON technical_job_orders (job_type);
CREATE INDEX IF NOT EXISTS idx_tjo_support_team_gin       ON technical_job_orders USING gin (support_team_members);

CREATE INDEX IF NOT EXISTS idx_inst_job_order             ON installation_records (related_job_order_id);
CREATE INDEX IF NOT EXISTS idx_inst_related_po            ON installation_records (related_po_id);
CREATE INDEX IF NOT EXISTS idx_inst_ready_to_deliver_at   ON installation_records (ready_to_deliver_at);
CREATE INDEX IF NOT EXISTS idx_inst_admin_log_response    ON installation_records (admin_log_response_status);

CREATE INDEX IF NOT EXISTS idx_pm_job_order               ON pm_records (related_job_order_id);
CREATE INDEX IF NOT EXISTS idx_pm_engineer                ON pm_records (assigned_engineer_id);

CREATE INDEX IF NOT EXISTS idx_sp_job_order               ON sparepart_records (related_job_order_id);
CREATE INDEX IF NOT EXISTS idx_sp_related_po              ON sparepart_records (related_po_id);
CREATE INDEX IF NOT EXISTS idx_sp_related_awb             ON sparepart_records (related_awb_id);
CREATE INDEX IF NOT EXISTS idx_sp_ready_to_deliver_at     ON sparepart_records (ready_to_deliver_at);
CREATE INDEX IF NOT EXISTS idx_sp_admin_log_response      ON sparepart_records (admin_log_response_status);

CREATE INDEX IF NOT EXISTS idx_qc_job_order               ON inspection_qc_records (related_job_order_id);
CREATE INDEX IF NOT EXISTS idx_qc_related_po              ON inspection_qc_records (related_po_id);

CREATE INDEX IF NOT EXISTS idx_bast_job_order             ON bast_records (related_job_order_id);
CREATE INDEX IF NOT EXISTS idx_bast_related_po            ON bast_records (related_po_id);
CREATE INDEX IF NOT EXISTS idx_bast_customer              ON bast_records (customer_id);
CREATE INDEX IF NOT EXISTS idx_bast_sent_to_finance       ON bast_records (sent_to_finance);

-- ----------------------------------------------------------------------------
-- HRGA
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_hrga_legal_expiry_date     ON hrga_legal_documents (expiry_date);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_status          ON hrga_legal_documents (document_status);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_compliance      ON hrga_legal_documents (compliance_flag);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_category        ON hrga_legal_documents (document_category);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_pic             ON hrga_legal_documents (pic_user_id);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_fts             ON hrga_legal_documents USING gin (search_document);
CREATE INDEX IF NOT EXISTS idx_hrga_legal_tags            ON hrga_legal_documents USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_company_letters_status     ON company_letters (letter_status);
CREATE INDEX IF NOT EXISTS idx_company_letters_type       ON company_letters (letter_type);
CREATE INDEX IF NOT EXISTS idx_company_letters_employee   ON company_letters (related_employee_id);
CREATE INDEX IF NOT EXISTS idx_company_letters_signatory  ON company_letters (signatory_user_id);
CREATE INDEX IF NOT EXISTS idx_company_letters_fts        ON company_letters USING gin (search_document);
CREATE INDEX IF NOT EXISTS idx_company_letters_tags       ON company_letters USING gin (tags);

CREATE INDEX IF NOT EXISTS idx_hrga_archive_source        ON hrga_archive_records (source_module, source_record_id);
CREATE INDEX IF NOT EXISTS idx_hrga_archive_archived_at   ON hrga_archive_records (archived_at);

-- ----------------------------------------------------------------------------
-- Tax & Insurance
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_tax_op_masa_pajak
    ON tax_operational_records (masa_pajak_month, masa_pajak_year);
CREATE INDEX IF NOT EXISTS idx_tax_op_tax_type            ON tax_operational_records (tax_type);
CREATE INDEX IF NOT EXISTS idx_tax_op_record_status       ON tax_operational_records (record_status);
CREATE INDEX IF NOT EXISTS idx_tax_op_payment_status      ON tax_operational_records (payment_status);
CREATE INDEX IF NOT EXISTS idx_tax_op_npwp                ON tax_operational_records (npwp);
CREATE INDEX IF NOT EXISTS idx_tax_op_pic                 ON tax_operational_records (pic_user_id);
CREATE INDEX IF NOT EXISTS idx_tax_op_audit_record        ON tax_operational_audit_log (record_id);
CREATE INDEX IF NOT EXISTS idx_tax_op_audit_created       ON tax_operational_audit_log (created_at);

-- ----------------------------------------------------------------------------
-- Notifications & Chat
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_notifications_user_unread
    ON notifications (recipient_user_id, is_read);
CREATE INDEX IF NOT EXISTS idx_notifications_role         ON notifications (recipient_role);
CREATE INDEX IF NOT EXISTS idx_notifications_created      ON notifications (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_notifications_related
    ON notifications (related_module, related_entity_id);

CREATE INDEX IF NOT EXISTS idx_notification_templates_group
    ON notification_templates (feature_group);
CREATE INDEX IF NOT EXISTS idx_notification_templates_event
    ON notification_templates (trigger_event);

CREATE INDEX IF NOT EXISTS idx_notification_logs_notif    ON notification_logs (notification_id);
CREATE INDEX IF NOT EXISTS idx_notification_logs_status   ON notification_logs (status);

CREATE INDEX IF NOT EXISTS idx_chat_channels_type         ON chat_channels (channel_type);
CREATE INDEX IF NOT EXISTS idx_chat_topics_channel        ON chat_topics (channel_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel      ON chat_messages (channel_id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_created      ON chat_messages (created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_channel_time
    ON chat_messages (channel_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender       ON chat_messages (sender_user_id);
CREATE INDEX IF NOT EXISTS idx_chat_channel_members_user  ON chat_channel_members (user_id);

-- ----------------------------------------------------------------------------
-- Files
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_file_attachments_entity
    ON file_attachments (related_module, related_entity_id);
CREATE INDEX IF NOT EXISTS idx_file_attachments_uploaded_by
    ON file_attachments (uploaded_by);

-- ----------------------------------------------------------------------------
-- SLA / Workflow / Todo
-- ----------------------------------------------------------------------------
CREATE INDEX IF NOT EXISTS idx_sla_tracking_entity
    ON sla_tracking (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_sla_tracking_due_at        ON sla_tracking (due_at);
CREATE INDEX IF NOT EXISTS idx_sla_tracking_overdue_at    ON sla_tracking (overdue_at);

CREATE INDEX IF NOT EXISTS idx_workflow_step_entity
    ON workflow_step_history (entity_type, entity_id);
CREATE INDEX IF NOT EXISTS idx_workflow_step_created      ON workflow_step_history (created_at);

CREATE INDEX IF NOT EXISTS idx_todo_items_user_status     ON todo_items (user_id, status);
CREATE INDEX IF NOT EXISTS idx_todo_items_deadline        ON todo_items (deadline);

COMMIT;

-- +migrate Down
BEGIN;

-- Users
DROP INDEX IF EXISTS idx_users_role;
DROP INDEX IF EXISTS idx_user_sessions_user_id;
DROP INDEX IF EXISTS idx_user_sessions_expires;

-- Purchase Orders
DROP INDEX IF EXISTS idx_po_current_status;
DROP INDEX IF EXISTS idx_po_created_by_user;
DROP INDEX IF EXISTS idx_po_customer_id;
DROP INDEX IF EXISTS idx_po_due_at;
DROP INDEX IF EXISTS idx_po_status_history_po_id;
DROP INDEX IF EXISTS idx_po_status_history_created;
DROP INDEX IF EXISTS idx_po_status_history_po_time;
DROP INDEX IF EXISTS idx_po_tracking_events_po_id;

-- Customers
DROP INDEX IF EXISTS idx_customers_company_name_trgm;

-- Sales
DROP INDEX IF EXISTS idx_sales_forecasts_customer;
DROP INDEX IF EXISTS idx_sales_forecasts_pic;
DROP INDEX IF EXISTS idx_sales_forecasts_step_due;
DROP INDEX IF EXISTS idx_sales_forecasts_step_stat;
DROP INDEX IF EXISTS idx_quotations_customer;
DROP INDEX IF EXISTS idx_quotations_forecast;
DROP INDEX IF EXISTS idx_quotations_step_due;
DROP INDEX IF EXISTS idx_hpp_customer;
DROP INDEX IF EXISTS idx_hpp_quotation;
DROP INDEX IF EXISTS idx_sales_po_customer;
DROP INDEX IF EXISTS idx_sales_po_po_id;
DROP INDEX IF EXISTS idx_sales_po_step_due;
DROP INDEX IF EXISTS idx_sales_po_step_status;
DROP INDEX IF EXISTS idx_pr_sales_related_po;
DROP INDEX IF EXISTS idx_pr_sales_customer;

-- Admin & Log
DROP INDEX IF EXISTS idx_awb_related_po;
DROP INDEX IF EXISTS idx_awb_customer;
DROP INDEX IF EXISTS idx_awb_current_status;
DROP INDEX IF EXISTS idx_awb_status_history_awb_id;
DROP INDEX IF EXISTS idx_do_related_po;
DROP INDEX IF EXISTS idx_do_customer;
DROP INDEX IF EXISTS idx_do_current_status;
DROP INDEX IF EXISTS idx_do_status_history_do_id;
DROP INDEX IF EXISTS idx_admin_op_reporting_month;
DROP INDEX IF EXISTS idx_admin_op_category;
DROP INDEX IF EXISTS idx_admin_op_related_po;

-- Finance
DROP INDEX IF EXISTS idx_po_customer_sales_po;
DROP INDEX IF EXISTS idx_po_customer_po;
DROP INDEX IF EXISTS idx_po_customer_customer;
DROP INDEX IF EXISTS idx_po_customer_quotation;
DROP INDEX IF EXISTS idx_pr_finance_sales_pr;
DROP INDEX IF EXISTS idx_pr_finance_po;
DROP INDEX IF EXISTS idx_pr_finance_po_customer;
DROP INDEX IF EXISTS idx_pr_finance_customer;
DROP INDEX IF EXISTS idx_pr_finance_status;
DROP INDEX IF EXISTS idx_invoice_manu_pr;
DROP INDEX IF EXISTS idx_invoice_manu_po;
DROP INDEX IF EXISTS idx_invoice_manu_due_date;
DROP INDEX IF EXISTS idx_invoice_manu_pay_status;
DROP INDEX IF EXISTS idx_invoice_cust_po_customer;
DROP INDEX IF EXISTS idx_invoice_cust_bast;
DROP INDEX IF EXISTS idx_invoice_cust_do;
DROP INDEX IF EXISTS idx_invoice_cust_po;
DROP INDEX IF EXISTS idx_invoice_cust_customer;
DROP INDEX IF EXISTS idx_invoice_cust_status;

-- Technical
DROP INDEX IF EXISTS idx_tjo_related_po;
DROP INDEX IF EXISTS idx_tjo_customer;
DROP INDEX IF EXISTS idx_tjo_engineer;
DROP INDEX IF EXISTS idx_tjo_po_due_date;
DROP INDEX IF EXISTS idx_tjo_job_type;
DROP INDEX IF EXISTS idx_tjo_support_team_gin;
DROP INDEX IF EXISTS idx_inst_job_order;
DROP INDEX IF EXISTS idx_inst_related_po;
DROP INDEX IF EXISTS idx_inst_ready_to_deliver_at;
DROP INDEX IF EXISTS idx_inst_admin_log_response;
DROP INDEX IF EXISTS idx_pm_job_order;
DROP INDEX IF EXISTS idx_pm_engineer;
DROP INDEX IF EXISTS idx_sp_job_order;
DROP INDEX IF EXISTS idx_sp_related_po;
DROP INDEX IF EXISTS idx_sp_related_awb;
DROP INDEX IF EXISTS idx_sp_ready_to_deliver_at;
DROP INDEX IF EXISTS idx_sp_admin_log_response;
DROP INDEX IF EXISTS idx_qc_job_order;
DROP INDEX IF EXISTS idx_qc_related_po;
DROP INDEX IF EXISTS idx_bast_job_order;
DROP INDEX IF EXISTS idx_bast_related_po;
DROP INDEX IF EXISTS idx_bast_customer;
DROP INDEX IF EXISTS idx_bast_sent_to_finance;

-- HRGA
DROP INDEX IF EXISTS idx_hrga_legal_expiry_date;
DROP INDEX IF EXISTS idx_hrga_legal_status;
DROP INDEX IF EXISTS idx_hrga_legal_compliance;
DROP INDEX IF EXISTS idx_hrga_legal_category;
DROP INDEX IF EXISTS idx_hrga_legal_pic;
DROP INDEX IF EXISTS idx_hrga_legal_fts;
DROP INDEX IF EXISTS idx_hrga_legal_tags;
DROP INDEX IF EXISTS idx_company_letters_status;
DROP INDEX IF EXISTS idx_company_letters_type;
DROP INDEX IF EXISTS idx_company_letters_employee;
DROP INDEX IF EXISTS idx_company_letters_signatory;
DROP INDEX IF EXISTS idx_company_letters_fts;
DROP INDEX IF EXISTS idx_company_letters_tags;
DROP INDEX IF EXISTS idx_hrga_archive_source;
DROP INDEX IF EXISTS idx_hrga_archive_archived_at;

-- Tax
DROP INDEX IF EXISTS idx_tax_op_masa_pajak;
DROP INDEX IF EXISTS idx_tax_op_tax_type;
DROP INDEX IF EXISTS idx_tax_op_record_status;
DROP INDEX IF EXISTS idx_tax_op_payment_status;
DROP INDEX IF EXISTS idx_tax_op_npwp;
DROP INDEX IF EXISTS idx_tax_op_pic;
DROP INDEX IF EXISTS idx_tax_op_audit_record;
DROP INDEX IF EXISTS idx_tax_op_audit_created;

-- Notifications & Chat
DROP INDEX IF EXISTS idx_notifications_user_unread;
DROP INDEX IF EXISTS idx_notifications_role;
DROP INDEX IF EXISTS idx_notifications_created;
DROP INDEX IF EXISTS idx_notifications_related;
DROP INDEX IF EXISTS idx_notification_templates_group;
DROP INDEX IF EXISTS idx_notification_templates_event;
DROP INDEX IF EXISTS idx_notification_logs_notif;
DROP INDEX IF EXISTS idx_notification_logs_status;
DROP INDEX IF EXISTS idx_chat_channels_type;
DROP INDEX IF EXISTS idx_chat_topics_channel;
DROP INDEX IF EXISTS idx_chat_messages_channel;
DROP INDEX IF EXISTS idx_chat_messages_created;
DROP INDEX IF EXISTS idx_chat_messages_channel_time;
DROP INDEX IF EXISTS idx_chat_messages_sender;
DROP INDEX IF EXISTS idx_chat_channel_members_user;

-- Files
DROP INDEX IF EXISTS idx_file_attachments_entity;
DROP INDEX IF EXISTS idx_file_attachments_uploaded_by;

-- SLA / Workflow / Todo
DROP INDEX IF EXISTS idx_sla_tracking_entity;
DROP INDEX IF EXISTS idx_sla_tracking_due_at;
DROP INDEX IF EXISTS idx_sla_tracking_overdue_at;
DROP INDEX IF EXISTS idx_workflow_step_entity;
DROP INDEX IF EXISTS idx_workflow_step_created;
DROP INDEX IF EXISTS idx_todo_items_user_status;
DROP INDEX IF EXISTS idx_todo_items_deadline;

COMMIT;
