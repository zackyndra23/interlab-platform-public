-- ============================================================================
-- Migration 015: Activity logs
--
-- Append-only audit trail of significant user actions (login, logout, CRUD,
-- exports, page-level views). Denormalizes user_email/user_role so rows
-- stay interpretable after a user is deleted. detail is jsonb for optional
-- structured context (diffs, filter params, etc.).
--
-- RBAC note: rbacGuard('activity_log', 'view_global') already bypasses for
-- superadmin/ceo via the middleware fast-path, so seed rows in
-- role_permissions are not strictly required for the demo. If you need to
-- expose the route to another role later, insert the capability grant as a
-- follow-up migration.
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE activity_logs (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NULL REFERENCES users(id) ON DELETE SET NULL,
    user_email    text         NOT NULL,
    user_role     text         NOT NULL,
    action        text         NOT NULL,
    resource_type text         NULL,
    resource_id   text         NULL,
    detail        jsonb        NULL,
    ip_address    text         NULL,
    user_agent    text         NULL,
    created_at    timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX activity_logs_user_id_idx    ON activity_logs (user_id);
CREATE INDEX activity_logs_created_at_idx ON activity_logs (created_at DESC);
CREATE INDEX activity_logs_action_idx     ON activity_logs (action);

COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS activity_logs;
COMMIT;
