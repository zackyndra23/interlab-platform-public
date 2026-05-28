'use strict';

// Idempotent demo seed.
//
// Creates:
//   - Every feature + capability referenced by the RBAC spec.
//   - The 8 system roles (superadmin, ceo, sales, admin_log, finance,
//     technical, hrga, tax_insurance).
//   - role_permissions for each role (superadmin/ceo get full_access on
//     every feature; division roles get write+view_own on their own
//     features and view_own on shared globals like po_tracking).
//   - One demo user per role with a known password.
//
// Runs safely on every container start — all writes are ON CONFLICT DO
// NOTHING, and the per-role permission backfill is additive.

const bcrypt = require('bcryptjs');
const { Pool } = require('pg');

const DEMO_PASSWORD = process.env.DEMO_PASSWORD || 'Demo@2025!';

// ---------------------------------------------------------------------------
// REGISTRY
// ---------------------------------------------------------------------------

const FEATURES = [
    ['dashboard',              'Dashboard',                  'shared'],
    ['notifications',          'Notifications',              'shared'],
    ['chat',                   'Chat',                       'shared'],
    ['po_tracking',            'PO Tracking',                'shared'],
    ['user_profile',           'User Profile',               'shared'],
    ['settings',               'Settings',                   'shared'],
    ['roles_management',       'Roles Management',           'setup'],
    ['email_templates',        'Email Templates',            'setup'],
    ['customers',              'Customers',                  'sales'],
    ['sales_forecast',         'Sales Forecast',             'sales'],
    ['quotation',              'Quotation',                  'sales'],
    ['hpp',                    'Harga Pokok Penjualan',      'sales'],
    ['sales_po',               'Sales Purchase Order',       'sales'],
    ['sales_pr',               'Sales Purchase Request',     'sales'],
    ['awb',                    'Airway Bill',                'admin_log'],
    ['delivery_order',         'Delivery Order',             'admin_log'],
    ['admin_operational',      'Admin Operational',          'admin_log'],
    ['po_customer',            'PO Customer',                'finance'],
    ['purchase_requisition',   'Purchase Requisition',       'finance'],
    ['invoice_manufacture',    'Invoice Manufacture',        'finance'],
    ['invoice_customer',       'Invoice Customer',           'finance'],
    ['technical_job_order',    'Technical Job Order',        'technical'],
    ['installation',           'Installation',               'technical'],
    ['pm',                     'Preventive Maintenance',     'technical'],
    ['sparepart',              'Sparepart',                  'technical'],
    ['inspection_qc',          'Inspection & QC',            'technical'],
    ['bast',                   'BAST / Completion Docs',     'technical'],
    ['hrga_legal',             'HRGA Legalitas',             'hrga'],
    ['company_letters',        'Company Letters',            'hrga'],
    ['hrga_archive',           'HRGA Archive',               'hrga'],
    ['hrga_compliance',        'HRGA Compliance & Expiry',   'hrga'],
    ['hrga_smart_search',      'HRGA Smart Search',          'hrga'],
    ['tax_operational',        'Tax Operational',            'tax'],
    ['admin_rbac',             'RBAC Administration',        'admin'],
];

const CAPABILITIES = [
    ['view_own',     'View Own Records'],
    ['view_global',  'View All Records'],
    ['create',       'Create'],
    ['edit',         'Edit'],
    ['delete',       'Delete'],
    ['write',        'Write (Create + Edit)'],
    ['export',       'Export'],
    ['approve',      'Approve'],
    ['full_access',  'Full Access'],
    ['invite_user',  'Invite user'],
    ['reset_user_password', 'Reset user password to backup'],
];

const ROLES = [
    ['superadmin',     'Superadmin',      true],
    ['ceo',            'CEO',             true],
    ['sales',          'Sales',           true],
    ['admin_log',      'Admin & Log',     true],
    ['finance',        'Finance',         true],
    ['technical',      'Technical',       true],
    ['hrga',           'HRGA / Legal',    true],
    ['tax_insurance',  'Tax & Insurance', true],
];

// Feature → capability grants per role. For division roles, "write"
// expands to create+edit+write at insert time so downstream checks for
// either pass. Shared globals (dashboard, notifications, chat, po_tracking)
// are granted view_own to every role.
const SHARED_GLOBALS = ['dashboard', 'notifications', 'chat', 'po_tracking', 'user_profile', 'settings'];

const DIVISION_FEATURES = {
    sales:          ['customers', 'sales_forecast', 'quotation', 'hpp', 'sales_po', 'sales_pr'],
    admin_log:      ['awb', 'delivery_order', 'admin_operational'],
    finance:        ['po_customer', 'purchase_requisition', 'invoice_manufacture', 'invoice_customer'],
    technical:      ['technical_job_order', 'installation', 'pm', 'sparepart', 'inspection_qc', 'bast'],
    hrga:           ['hrga_legal', 'company_letters', 'hrga_archive', 'hrga_compliance', 'hrga_smart_search'],
    tax_insurance:  ['tax_operational'],
};

// Role → SEED_PW_* env var (operator-set per-role passwords; fallback DEMO_PASSWORD).
// Names are non-mechanical: admin_log → SEED_PW_ADMINLOG, tax_insurance → SEED_PW_TAX.
// This map is the source of truth for env var names — do not derive them algorithmically.
const SEED_PW_ENV = {
    superadmin:    'SEED_PW_SUPERADMIN',
    ceo:           'SEED_PW_CEO',
    sales:         'SEED_PW_SALES',
    admin_log:     'SEED_PW_ADMINLOG',
    finance:       'SEED_PW_FINANCE',
    technical:     'SEED_PW_TECHNICAL',
    hrga:          'SEED_PW_HRGA',
    tax_insurance: 'SEED_PW_TAX',
};

const USERS = [
    ['superadmin',    'zakyindrasatriaputra@gmail.com',     'Superadmin'],
    ['ceo',           'zakyindrasatriap@gmail.com',         'CEO'],
    ['sales',         'putra.zakyindras@gmail.com',         'Sales Manager'],
    ['admin_log',     'adminlog@issi-interlab.com',         'Admin & Log Manager'],
    ['finance',       'zaky.putra@integrity-indonesia.com', 'Finance Manager'],
    ['technical',     'pancaaindrawati@gmail.com',          'Technical Manager'],
    ['hrga',          'pancaindrawati27@gmail.com',         'HRGA / Legal Manager'],
    ['tax_insurance', 'pancaindrawati2704@gmail.com',       'Tax & Insurance Manager'],
];

// Division accounts seeded as department managers (rank-2 level).
const DIVISION_MANAGER_EMAILS = USERS
    .filter(([role]) => role !== 'superadmin' && role !== 'ceo')
    .map(([, email]) => email);

// ---------------------------------------------------------------------------
// RUNNER
// ---------------------------------------------------------------------------

async function seed() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) throw new Error('DATABASE_URL is not set');
    const pool = new Pool({ connectionString: databaseUrl });

    // Features
    for (const [key, name, group] of FEATURES) {
        await pool.query(
            `INSERT INTO feature_definitions (feature_key, feature_name, module_group)
             VALUES ($1, $2, $3)
             ON CONFLICT (feature_key) DO NOTHING`,
            [key, name, group],
        );
    }

    // Capabilities
    for (const [key, name] of CAPABILITIES) {
        await pool.query(
            `INSERT INTO capability_definitions (capability_key, capability_name)
             VALUES ($1, $2)
             ON CONFLICT (capability_key) DO NOTHING`,
            [key, name],
        );
    }

    // Roles
    for (const [roleKey, roleName, isSystem] of ROLES) {
        await pool.query(
            `INSERT INTO roles (role_key, role_name, is_system_role)
             VALUES ($1, $2, $3)
             ON CONFLICT (role_key) DO NOTHING`,
            [roleKey, roleName, isSystem],
        );
    }

    // Lookup maps
    const { rows: roleRows } = await pool.query('SELECT id, role_key FROM roles');
    const roleByKey = Object.fromEntries(roleRows.map((r) => [r.role_key, r.id]));
    const { rows: featureRows } = await pool.query('SELECT id, feature_key FROM feature_definitions');
    const featureByKey = Object.fromEntries(featureRows.map((r) => [r.feature_key, r.id]));
    const { rows: capRows } = await pool.query('SELECT id, capability_key FROM capability_definitions');
    const capByKey = Object.fromEntries(capRows.map((r) => [r.capability_key, r.id]));

    // Staff (rank-1) level seed for division roles — matches migration 017 logic so
    // this block is safely idempotent via ON CONFLICT DO NOTHING.
    for (const roleKey of Object.keys(DIVISION_FEATURES)) {
        await pool.query(
            `INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
             SELECT id,
                    $1 || '_staff',
                    initcap(replace($1, '_', ' ')) || ' Staff',
                    1,
                    'own'
               FROM roles WHERE role_key = $1
             ON CONFLICT (role_id, level_key) WHERE deleted_at IS NULL DO NOTHING`,
            [roleKey],
        );
    }

    // Lookup level_id map (staff = rank 1) for role_permissions grants.
    const { rows: levelRows } = await pool.query(
        `SELECT rl.id, r.role_key FROM role_levels rl JOIN roles r ON r.id = rl.role_id WHERE rl.level_rank = 1`,
    );
    const staffLevelByRole = Object.fromEntries(levelRows.map((r) => [r.role_key, r.id]));

    // grant inserts a role_permissions row for the given role's staff level.
    // Superadmin/CEO bypass the resolver entirely (migration 017 deleted their
    // rows) — do not insert for them.
    async function grant(roleKey, featureKey, capabilityKey) {
        const roleId = roleByKey[roleKey];
        const featureId = featureByKey[featureKey];
        const capId = capByKey[capabilityKey];
        const levelId = staffLevelByRole[roleKey];
        if (!roleId || !featureId || !capId || !levelId) return;
        await pool.query(
            `INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
             VALUES ($1, $2, $3, $4)
             ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING`,
            [roleId, levelId, featureId, capId],
        );
    }

    // Superadmin + CEO bypass the RBAC resolver — no role_permissions rows needed
    // (migration 017 removed them). We intentionally skip granting for those roles.

    // Division roles: own-module write + view_own; shared globals view_own.
    for (const [role, features] of Object.entries(DIVISION_FEATURES)) {
        for (const fKey of features) {
            for (const cap of ['view_own', 'create', 'edit', 'write', 'delete', 'export']) {
                await grant(role, fKey, cap);
            }
        }
        for (const fKey of SHARED_GLOBALS) {
            await grant(role, fKey, 'view_own');
        }
        // Give every division role read access to roles_management so
        // they can at least browse their own users (real same-role scope
        // is enforced at the service layer).
        await grant(role, 'roles_management', 'view_own');
        await grant(role, 'email_templates', 'view_own');
    }

    // Manager (rank-2) levels for each invitable role.
    // data_scope_default = 'role': Managers see role-wide data per spec.
    const MANAGER_LEVELS = [
        ['sales',         'sales_manager',         'Sales Manager'],
        ['admin_log',     'admin_log_manager',      'Admin & Log Manager'],
        ['finance',       'finance_manager',        'Finance Manager'],
        ['technical',     'technical_manager',      'Technical Manager'],
        ['hrga',          'hrga_manager',           'HRGA Manager'],
        ['tax_insurance', 'tax_insurance_manager',  'Tax & Insurance Manager'],
    ];
    for (const [roleKey, levelKey, levelName] of MANAGER_LEVELS) {
        await pool.query(
            `INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
             SELECT id, $2, $3, 2, 'role' FROM roles WHERE role_key = $1
             ON CONFLICT (role_id, level_key) WHERE deleted_at IS NULL DO UPDATE
               SET level_name          = EXCLUDED.level_name,
                   data_scope_default  = EXCLUDED.data_scope_default,
                   updated_at          = now()`,
            [roleKey, levelKey, levelName],
        );
    }

    // Grant invite_user to top-rank Manager of each invitable role on admin_rbac feature
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
                            AND rl.level_rank = (
                              SELECT max(level_rank) FROM role_levels
                               WHERE role_id = rl.role_id AND deleted_at IS NULL)
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
         AND f.feature_key = 'admin_rbac'
         AND c.capability_key = 'invite_user'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
    `);

    // Seed invitation_pending notification template
    await pool.query(`
      INSERT INTO notification_templates
        (template_key, template_name, feature_group, trigger_event,
         recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
         status, subject, body)
      VALUES
        ('invitation_pending', 'User Invitation', 'admin', 'invitation.created',
         '[]'::jsonb, true, false, 'enabled',
         'You are invited to join Interlab',
         '<p>Hello,</p>' ||
         '<p>You have been invited to join the Interlab portal as <b>{{role}}</b>.</p>' ||
         '<p>Activation link: <a href="{{activation_url}}">{{activation_url}}</a></p>' ||
         '<p>This invitation expires on {{expires_at}}.</p>')
      ON CONFLICT (template_key) DO UPDATE
        SET template_name = EXCLUDED.template_name,
            body = EXCLUDED.body,
            updated_at = now()
    `);

    // Users — password per role from SEED_PW_{ROLE} (fallback DEMO_PASSWORD).
    // backup_password_hash = same hash so "reset to backup" returns the account
    // to the operator-known seed password. ($2 is reused for both columns.)
    for (const [role, email, displayName] of USERS) {
        const plain = process.env[SEED_PW_ENV[role]] || DEMO_PASSWORD;
        const pwHash = await bcrypt.hash(plain, 10);
        await pool.query(
            `INSERT INTO users
               (email, password_hash, backup_password_hash, role, display_name, account_status)
             VALUES ($1, $2, $2, $3, $4, 'active')
             ON CONFLICT (email) DO UPDATE SET
                 password_hash        = EXCLUDED.password_hash,
                 backup_password_hash = EXCLUDED.backup_password_hash,
                 role                 = EXCLUDED.role,
                 display_name         = EXCLUDED.display_name,
                 account_status       = 'active',
                 deleted_at           = NULL,
                 updated_at           = now()`,
            [email, pwHash, role, displayName],
        );
    }

    // Backfill: any division user without a level_id gets the rank-1 (staff)
    // level for their role.  Superadmin/CEO are intentionally excluded.
    await pool.query(
        `UPDATE users u
            SET level_id   = rl.id,
                updated_at = now()
           FROM roles r
           JOIN role_levels rl ON rl.role_id = r.id AND rl.level_rank = 1
          WHERE u.role = r.role_key
            AND u.role NOT IN ('superadmin','ceo')
            AND u.level_id IS NULL
            AND u.deleted_at IS NULL`,
    );

    // Seeded division accounts are department MANAGERS → upgrade to rank-2 level
    // (the generic backfill above set them to rank-1; this overrides for the 6).
    // The seeder OWNS these canonical accounts: a re-run intentionally re-asserts
    // rank-2 even if an admin manually changed a level in between.
    await pool.query(
        `UPDATE users u
            SET level_id   = rl.id,
                updated_at = now()
           FROM roles r
           JOIN role_levels rl ON rl.role_id = r.id AND rl.level_rank = 2
          WHERE u.role = r.role_key
            AND u.email = ANY($1)
            AND u.deleted_at IS NULL`,
        [DIVISION_MANAGER_EMAILS],
    );

    // --- Seed po_document_types ----------------------------------------------
    const PO_DOC_TYPES = [
        { doc_key: 'awb',              doc_name: 'Air Waybill',             triggers_stage: 'Shipped',     uploader_role_keys: ['admin_log'] },
        { doc_key: 'arrival_doc',      doc_name: 'Arrival Document',        triggers_stage: 'Arrived',     uploader_role_keys: ['admin_log'] },
        { doc_key: 'do',               doc_name: 'Delivery Order',          triggers_stage: 'Delivery',    uploader_role_keys: ['admin_log'] },
        { doc_key: 'pr_po_out',        doc_name: 'PR PO Out (Production)',  triggers_stage: 'Production',  uploader_role_keys: ['finance'] },
        { doc_key: 'bast',             doc_name: 'BAST',                    triggers_stage: 'BAST',        uploader_role_keys: ['technical'] },
        { doc_key: 'invoice_customer', doc_name: 'Invoice to Customer',     triggers_stage: 'Invoice',     uploader_role_keys: ['finance'] },
    ];

    for (const t of PO_DOC_TYPES) {
        await pool.query(`
            INSERT INTO po_document_types (doc_key, doc_name, triggers_stage, uploader_role_keys, is_active)
            VALUES ($1, $2, $3, $4::jsonb, true)
            ON CONFLICT (doc_key) DO UPDATE SET
              doc_name = EXCLUDED.doc_name,
              triggers_stage = EXCLUDED.triggers_stage,
              uploader_role_keys = EXCLUDED.uploader_role_keys,
              updated_at = now()
        `, [t.doc_key, t.doc_name, t.triggers_stage, JSON.stringify(t.uploader_role_keys)]);
    }

    // --- New capabilities for stage actions ----------------------------------
    const STAGE_CAPABILITIES = [
        ['advance_stage',        'Advance PO stage'],
        ['reject_stage',         'Reject PO stage'],
        ['admin_override_stage', 'Admin override PO stage (skip)'],
    ];
    for (const [key, name] of STAGE_CAPABILITIES) {
        await pool.query(`
            INSERT INTO capability_definitions (capability_key, capability_name)
            VALUES ($1, $2) ON CONFLICT (capability_key) DO NOTHING`, [key, name]);
    }

    // --- Grant view_own + advance_stage on sales_po to division roles.
    // view_own on sales_po is required so that GET /api/po/:id/history is accessible
    // to all division staff (I5 fix — the endpoint used view_global which no division
    // role holds, locking them out of the PO audit trail).
    // advance_stage is limited to the four PO-owning roles; hrga and tax are read-only
    // in the PO context (they keep view_own but must NOT have advance_stage).
    const PO_FEATURE_KEY = 'sales_po';

    // view_own on sales_po for ALL division roles — PO history visibility (I5 fix).
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
         AND f.feature_key = $1
         AND c.capability_key = 'view_own'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
    `, [PO_FEATURE_KEY]);

    // advance_stage on sales_po ONLY for roles that own PO stages (NOT hrga/tax).
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key IN ('sales','admin_log','finance','technical')
         AND f.feature_key = $1
         AND c.capability_key = 'advance_stage'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
    `, [PO_FEATURE_KEY]);

    // Idempotent revoke: remove advance_stage from hrga/tax on already-seeded DBs
    // (the seeder is otherwise additive; this DELETE makes the trim deterministic).
    await pool.query(`
      DELETE FROM role_permissions rp
       USING roles r, feature_definitions f, capability_definitions c
       WHERE rp.role_id = r.id AND rp.feature_id = f.id AND rp.capability_id = c.id
         AND r.role_key IN ('hrga','tax_insurance')
         AND f.feature_key = $1
         AND c.capability_key = 'advance_stage'
    `, [PO_FEATURE_KEY]);

    // --- Grant reject_stage to manager (top-rank) only
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
                            AND rl.level_rank = (SELECT max(level_rank) FROM role_levels
                                                  WHERE role_id = rl.role_id AND deleted_at IS NULL)
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
         AND f.feature_key = $1
         AND c.capability_key = 'reject_stage'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING
    `, [PO_FEATURE_KEY]);

    // admin_override_stage is reserved to Superadmin/CEO via bypass — no grants needed.

    // --- New capability for notification settings ----------------------------
    await pool.query(`
      INSERT INTO capability_definitions (capability_key, capability_name)
      VALUES ('manage_notifications','Manage notification senders and templates')
      ON CONFLICT (capability_key) DO NOTHING`);

    // Grant manage_notifications to top-rank managers on admin_rbac feature.
    // CEO/Superadmin bypass via ALL_CAPABILITY_KEYS (no rows needed for them).
    await pool.query(`
      INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
      SELECT r.id, rl.id, f.id, c.id
        FROM roles r
        JOIN role_levels rl ON rl.role_id = r.id
                            AND rl.level_rank = (SELECT max(level_rank) FROM role_levels
                                                  WHERE role_id = rl.role_id AND deleted_at IS NULL)
        CROSS JOIN feature_definitions f
        CROSS JOIN capability_definitions c
       WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
         AND f.feature_key = 'admin_rbac'
         AND c.capability_key = 'manage_notifications'
       ON CONFLICT (role_id, level_id, feature_id, capability_id) DO NOTHING`);

    // Default 'noreply' sender — points at the existing SMTP env config.
    await pool.query(`
      INSERT INTO notification_senders
        (sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active)
      VALUES ('noreply', 'Interlab Notifications', $1, NULL, 'smtp', 'smtp.default', true)
      ON CONFLICT (sender_key) DO UPDATE SET
        display_name = EXCLUDED.display_name,
        from_email = EXCLUDED.from_email,
        updated_at = now()`,
      [process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || 'noreply@interlab-portal.com']);

    // Seed po.stage_rejected notification template (C1).
    // Recipients: superadmin, ceo, plus the rejecting actor's role (passed as
    // extraRoles at emit time). The JSON here captures the default standing set.
    await pool.query(`
      INSERT INTO notification_templates
        (template_key, template_name, feature_group, trigger_event,
         recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
         status, subject, body)
      VALUES
        ('po.stage_rejected', 'PO Stage Rejected', 'po_tracking', 'po.stage_rejected',
         '["superadmin","ceo"]'::jsonb, false, true, 'enabled',
         'PO {{po_number}} stage rejected',
         '<p>Purchase order <b>{{po_number}}</b> was rejected back to stage <b>{{new_status}}</b>.</p>' ||
         '<p>Reason: {{reason}}</p>' ||
         '<p>Rejected by: {{actor_role}}</p>')
      ON CONFLICT (template_key) DO UPDATE
        SET template_name = EXCLUDED.template_name,
            body          = EXCLUDED.body,
            subject       = EXCLUDED.subject,
            updated_at    = now()
    `);

    // Seed po.stage_admin_overridden notification template (C1).
    // Recipients: superadmin, ceo only (override is an admin-only action).
    await pool.query(`
      INSERT INTO notification_templates
        (template_key, template_name, feature_group, trigger_event,
         recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
         status, subject, body)
      VALUES
        ('po.stage_admin_overridden', 'PO Stage Admin Override', 'po_tracking', 'po.stage_admin_overridden',
         '["superadmin","ceo"]'::jsonb, false, true, 'enabled',
         'PO {{po_number}} stage overridden by admin',
         '<p>Purchase order <b>{{po_number}}</b> was admin-overridden to stage <b>{{new_status}}</b>.</p>' ||
         '<p>Reason: {{reason}}</p>' ||
         '<p>Overridden by: {{actor_role}}</p>')
      ON CONFLICT (template_key) DO UPDATE
        SET template_name = EXCLUDED.template_name,
            body          = EXCLUDED.body,
            subject       = EXCLUDED.subject,
            updated_at    = now()
    `);

    // Seed password_reset_email notification template (Stage 5).
    await pool.query(`
      INSERT INTO notification_templates
        (template_key, template_name, feature_group, trigger_event,
         recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
         status, subject, body)
      VALUES
        ('password_reset_email',
         'Password Reset Link',
         'auth',
         'auth.password.reset.requested',
         '[]'::jsonb,
         true,
         false,
         'enabled',
         'Reset your Interlab Portal password',
         '<p>Hello {{display_name}},</p>' ||
         '<p>We received a request to reset your password. Click the link below to choose a new one:</p>' ||
         '<p><a href="{{reset_url}}" style="display:inline-block;padding:10px 20px;background:#C8102E;color:#fff;text-decoration:none;border-radius:4px;">Reset Password</a></p>' ||
         '<p>Or copy this URL into your browser: <code>{{reset_url}}</code></p>' ||
         '<p>This link expires in {{expires_in_minutes}} minutes. If you did not request a password reset, you can safely ignore this email — your password remains unchanged.</p>' ||
         '<p>— Interlab Portal</p>')
      ON CONFLICT (template_key) DO UPDATE SET
        template_name = EXCLUDED.template_name,
        subject = EXCLUDED.subject,
        body = EXCLUDED.body,
        updated_at = now()
    `);

    // Seed two_factor_email_otp notification template (Stage 6).
    await pool.query(`
      INSERT INTO notification_templates
        (template_key, template_name, feature_group, trigger_event,
         recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
         status, subject, body)
      VALUES
        ('two_factor_email_otp',
         'Two-Factor Email OTP',
         'auth',
         'auth.2fa.email.requested',
         '[]'::jsonb,
         true,
         false,
         'enabled',
         'Your Interlab Portal verification code',
         '<p>Hello {{display_name}},</p>' ||
         '<p>Your verification code is:</p>' ||
         '<p style="font-size:32px;font-weight:bold;letter-spacing:6px;color:#C8102E;text-align:center;">{{code}}</p>' ||
         '<p>This code expires in {{expires_in_minutes}} minutes.</p>' ||
         '<p>If you did not try to log in, please change your password immediately.</p>' ||
         '<p>— Interlab Portal</p>')
      ON CONFLICT (template_key) DO UPDATE SET
        template_name = EXCLUDED.template_name,
        subject = EXCLUDED.subject,
        body = EXCLUDED.body,
        updated_at = now()
    `);

    // Assign default sender to all existing templates that don't have one.
    await pool.query(`
      UPDATE notification_templates SET sender_id = (SELECT id FROM notification_senders WHERE sender_key='noreply')
       WHERE sender_id IS NULL`);

    await pool.end();
    console.log('[seed] done');
    const overrideCount = Object.values(SEED_PW_ENV).filter((k) => process.env[k]).length;
    if (overrideCount === 0) {
        console.log(`[seed] all 8 accounts use fallback DEMO_PASSWORD: ${DEMO_PASSWORD}`);
    } else {
        console.log(`[seed] ${overrideCount}/8 accounts use SEED_PW_* overrides; the rest fall back to DEMO_PASSWORD`);
    }
}

seed().catch((err) => {
    console.error('[seed] fatal', err);
    process.exit(1);
});
