-- ============================================================================
-- Migration 002: RBAC
-- Creates: feature_definitions, capability_definitions, roles,
--          role_permissions, role_menu_visibility, user_role_scope
-- Also adds the users.role -> roles.role_key foreign key.
-- ============================================================================

-- +migrate Up
BEGIN;

-- ----------------------------------------------------------------------------
-- feature_definitions
--   Registry of every feature/module. feature_key is the stable identifier
--   used by the RBAC middleware (e.g. 'sales_po', 'hrga_legal').
-- ----------------------------------------------------------------------------
CREATE TABLE feature_definitions (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    feature_key   text         NOT NULL,
    feature_name  text         NOT NULL,
    module_group  text         NOT NULL,
    created_at    timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT feature_definitions_key_unique UNIQUE (feature_key)
);

-- ----------------------------------------------------------------------------
-- capability_definitions
--   Registry of capability types: view_own, view_global, create, edit,
--   delete, write, export, approve, full_access.
-- ----------------------------------------------------------------------------
CREATE TABLE capability_definitions (
    id                uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    capability_key    text         NOT NULL,
    capability_name   text         NOT NULL,
    created_at        timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT capability_definitions_key_unique UNIQUE (capability_key)
);

-- ----------------------------------------------------------------------------
-- roles
--   8 system roles seeded later: superadmin, ceo, sales, admin_log,
--   finance, technical, hrga, tax_insurance. CEO/Superadmin may also
--   create custom non-system roles via role management UI.
-- ----------------------------------------------------------------------------
CREATE TABLE roles (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_name       text         NOT NULL,
    role_key        text         NOT NULL,
    is_system_role  boolean      NOT NULL DEFAULT false,
    created_at      timestamptz  NOT NULL DEFAULT now(),
    updated_at      timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT roles_role_key_unique UNIQUE (role_key)
);

-- Close the loop: users.role references roles.role_key.
ALTER TABLE users
    ADD CONSTRAINT fk_users_role_key
    FOREIGN KEY (role)
    REFERENCES roles (role_key)
    ON UPDATE CASCADE
    ON DELETE RESTRICT;

-- ----------------------------------------------------------------------------
-- role_permissions
--   Fully relational role x feature x capability mapping.
--   No JSON arrays. RBAC middleware queries this table on every request.
-- ----------------------------------------------------------------------------
CREATE TABLE role_permissions (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id        uuid         NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    feature_id     uuid         NOT NULL REFERENCES feature_definitions(id) ON DELETE CASCADE,
    capability_id  uuid         NOT NULL REFERENCES capability_definitions(id) ON DELETE CASCADE,
    created_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT role_permissions_triple_unique
        UNIQUE (role_id, feature_id, capability_id)
);

-- ----------------------------------------------------------------------------
-- role_menu_visibility
--   Controls sidebar menu visibility per role. menu_key is a stable
--   identifier for each sidebar entry (e.g. 'sidebar.sales.po').
-- ----------------------------------------------------------------------------
CREATE TABLE role_menu_visibility (
    id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id     uuid         NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    menu_key    text         NOT NULL,
    is_visible  boolean      NOT NULL DEFAULT true,
    created_at  timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT role_menu_visibility_unique UNIQUE (role_id, menu_key)
);

-- ----------------------------------------------------------------------------
-- user_role_scope
--   Per-user scoping for same-role management. Enforced server-side by
--   sameRoleScope.middleware. If can_manage_same_role = true and
--   managed_role_scope is set, the user may create/edit users whose
--   role matches that scope.
-- ----------------------------------------------------------------------------
CREATE TABLE user_role_scope (
    id                        uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id                   uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    managed_role_scope        text         NULL,
    can_manage_same_role      boolean      NOT NULL DEFAULT false,
    feature_permission_scope  text         NULL,
    created_at                timestamptz  NOT NULL DEFAULT now(),
    updated_at                timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT user_role_scope_user_unique UNIQUE (user_id)
);

COMMIT;

-- +migrate Down
BEGIN;

ALTER TABLE users DROP CONSTRAINT IF EXISTS fk_users_role_key;

DROP TABLE IF EXISTS user_role_scope;
DROP TABLE IF EXISTS role_menu_visibility;
DROP TABLE IF EXISTS role_permissions;
DROP TABLE IF EXISTS roles;
DROP TABLE IF EXISTS capability_definitions;
DROP TABLE IF EXISTS feature_definitions;

COMMIT;
