-- ============================================================================
-- Migration 016: App settings + email queue
--
-- Key-value store for system-wide settings (general + email), an outbox for
-- queued emails, and RBAC wiring so all 8 roles can VIEW the settings page
-- while only superadmin/ceo can EDIT.
-- ============================================================================

-- +migrate Up
BEGIN;

-- Key-value store for all system-wide settings (general + email).
-- Using JSONB value for flexibility so we never need schema changes per field.
CREATE TABLE app_settings (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    key         text         NOT NULL,
    value       jsonb        NOT NULL,
    updated_by  uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    updated_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT app_settings_key_unique UNIQUE (key)
);

-- Email outbox / queue. Worker picks pending rows and sends via current SMTP config.
CREATE TABLE email_queue (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    to_address    text         NOT NULL,
    cc_address    text         NULL,
    bcc_address   text         NULL,
    subject       text         NOT NULL,
    body_html     text         NOT NULL,
    status        text         NOT NULL DEFAULT 'pending',
    attempts      int          NOT NULL DEFAULT 0,
    last_error    text         NULL,
    has_attachment boolean     NOT NULL DEFAULT false,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    sent_at       timestamptz  NULL,
    CONSTRAINT email_queue_status_chk CHECK (status IN ('pending','sent','failed'))
);

CREATE INDEX email_queue_status_idx ON email_queue (status, created_at);

-- Seed default general + email settings (idempotent).
INSERT INTO app_settings (key, value) VALUES
  ('general.company_name',        '"Interlab Sentra Solutions Indonesia"'::jsonb),
  ('general.company_main_domain', '"https://app.interlab-portal.com"'::jsonb),
  ('general.rtl_admin',           'false'::jsonb),
  ('general.rtl_customers',       'false'::jsonb),
  ('general.allowed_file_types',  '".png,.jpg,.pdf,.doc,.docx,.xls,.xlsx,.zip,.rar,.txt"'::jsonb),
  ('general.logo_url',            '""'::jsonb),
  ('email.mail_engine',           '"phpmailer"'::jsonb),
  ('email.protocol',              '"smtp"'::jsonb),
  ('email.encryption',            '"tls"'::jsonb),
  ('email.smtp_host',             '"smtp.gmail.com"'::jsonb),
  ('email.smtp_port',             '587'::jsonb),
  ('email.from_email',            '""'::jsonb),
  ('email.smtp_username',         '""'::jsonb),
  ('email.smtp_password',         '""'::jsonb),
  ('email.charset',               '"utf-8"'::jsonb),
  ('email.bcc_all_to',            '""'::jsonb),
  ('email.signature',             '""'::jsonb),
  ('email.predefined_header',     '"<!doctype html><html><head></head><body>"'::jsonb),
  ('email.predefined_footer',     '"</body></html>"'::jsonb),
  ('email.queue_enabled',         'false'::jsonb),
  ('email.queue_skip_attachments','true'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Register new feature in RBAC registry.
INSERT INTO feature_definitions (feature_key, feature_name, module_group) VALUES
  ('system_settings', 'System Settings', 'setup')
ON CONFLICT (feature_key) DO NOTHING;

-- Grant view_own to all roles (so all 8 roles can SEE the page).
INSERT INTO role_permissions (role_id, feature_id, capability_id)
SELECT r.id, f.id, c.id
  FROM roles r
  CROSS JOIN feature_definitions f
  CROSS JOIN capability_definitions c
 WHERE f.feature_key = 'system_settings'
   AND c.capability_key = 'view_own'
ON CONFLICT DO NOTHING;

-- superadmin + ceo get full_access (middleware auto-bypasses, but seeding
-- the grant keeps this feature consistent with the rest of the registry).
INSERT INTO role_permissions (role_id, feature_id, capability_id)
SELECT r.id, f.id, c.id
  FROM roles r
  CROSS JOIN feature_definitions f
  CROSS JOIN capability_definitions c
 WHERE f.feature_key = 'system_settings'
   AND c.capability_key = 'full_access'
   AND r.role_key IN ('superadmin','ceo')
ON CONFLICT DO NOTHING;

COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS email_queue_status_idx;
DROP TABLE IF EXISTS email_queue;
DROP TABLE IF EXISTS app_settings;
DELETE FROM feature_definitions WHERE feature_key = 'system_settings';
COMMIT;
