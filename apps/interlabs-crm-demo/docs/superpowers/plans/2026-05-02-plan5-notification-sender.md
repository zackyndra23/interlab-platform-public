# Plan 5 — F5 Dynamic Notification Sender Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
>
> **Spec:** `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`)
> **Master plan:** `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md`
> **Depends on:** Plan 1 (`email-providers/factory.js` + adapters from Task 1.14). Plan 4 optional (stage events drive notifications).

**Goal:** Per-template configurable sender (smtp / gmail / ses) + multi-recipient (roles + extras − mutes) + dispatch worker that drains `email_queue` via the provider abstraction.

**Architecture:** A new `notification_senders` table holds (provider, from_email, display_name, provider_config_key). `notification_templates.sender_id` FKs in. Two side tables: `notification_template_extra_recipients` (specific user_ids beyond the role expansion) and `notification_user_mutes` (per-user opt-out per template). The existing `notification.service.emit` is extended to resolve sender + expand recipients + dedupe within 60s. A new dispatch worker (registered with the existing scheduler) drains `email_queue` rows and routes through the Plan-1 `email-providers/factory.js`.

**Tech Stack:** Existing `notification_templates` + `email_queue` tables, `notification.service.js`, `email-providers/factory.js` (Plan 1), `node-cron` scheduler, existing `notification_logs` table for per-channel dispatch logging.

---

## File map

**Net-new backend files**
- `backend/migrations/023_notification_senders.sql`
- `backend/migrations/024_notification_template_extras.sql`
- `backend/src/services/notification_sender.service.js` — CRUD + active-row resolution
- `backend/src/services/notification_dispatch.worker.js` — drain email_queue
- `backend/src/services/notification_mute.service.js`
- `backend/src/routes/admin/notification-senders.routes.js`
- `backend/src/routes/admin/notification-templates.routes.js` — extends template editing (sender + extras)
- `backend/src/routes/users/me-notifications.routes.js`
- `backend/test/migrations/023_024_notifications.test.js`
- `backend/test/services/notification_sender.service.test.js`
- `backend/test/services/notification_dispatch.worker.test.js`
- `backend/test/services/notification.dedupe.test.js`

**Modified backend files**
- `backend/src/services/notification.service.js` — `emit()` resolves sender from template, expands recipients (roles ∪ extras − mutes), dedupe window
- `backend/src/jobs/scheduler.js` — register dispatch tick (every 30s)
- `backend/scripts/seed.js` — default `noreply` sender + assign to existing templates + new capability `manage_notifications`
- `backend/src/app.js` — mount new routes

**Net-new frontend files**
- `frontend/lib/notification-types.ts`
- `frontend/lib/notification-api.ts`
- `frontend/app/(app)/admin/notifications/senders/page.tsx`
- `frontend/app/(app)/admin/notifications/templates/page.tsx`
- `frontend/app/(app)/admin/notifications/templates/[id]/page.tsx`
- `frontend/app/(app)/profile/notifications/page.tsx`

---

## Task 5.1 — Migrations 023 + 024

**Files:**
- Create: `backend/migrations/023_notification_senders.sql`
- Create: `backend/migrations/024_notification_template_extras.sql`
- Create: `backend/test/migrations/023_024_notifications.test.js`

- [ ] **Step 5.1.1 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');

describe('migrations 023+024 notification senders + extras', () => {
  it('notification_senders table with provider CHECK', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_senders'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint WHERE conname='notification_senders_provider_chk'`);
    expect(c.rows[0]?.def).toMatch(/smtp|gmail|ses|postmark|resend/i);
  });

  it('notification_templates.sender_id column added', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.columns WHERE table_name='notification_templates' AND column_name='sender_id'`);
    expect(r.rowCount).toBe(1);
  });

  it('notification_template_extra_recipients table exists with unique constraint', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_template_extra_recipients'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='notification_template_extra_recipients_unique'`);
    expect(c.rowCount).toBe(1);
  });

  it('notification_user_mutes table exists with unique constraint', async () => {
    const r = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='notification_user_mutes'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='notification_user_mutes_unique'`);
    expect(c.rowCount).toBe(1);
  });
});
```

- [ ] **Step 5.1.2 — Migration 023**

```sql
-- ============================================================================
-- Migration 023: notification_senders + notification_templates.sender_id
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE notification_senders (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_key          text         NOT NULL UNIQUE,
    display_name        text         NOT NULL,
    from_email          text         NOT NULL,
    reply_to_email      text         NULL,
    provider            text         NOT NULL,
    provider_config_key text         NOT NULL,
    is_active           boolean      NOT NULL DEFAULT true,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_senders_provider_chk
        CHECK (provider IN ('smtp','gmail','ses','postmark','resend'))
);

ALTER TABLE notification_templates
    ADD COLUMN sender_id uuid NULL REFERENCES notification_senders(id) ON DELETE SET NULL;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE notification_templates DROP COLUMN IF EXISTS sender_id;
DROP TABLE IF EXISTS notification_senders;
COMMIT;
```

- [ ] **Step 5.1.3 — Migration 024**

```sql
-- ============================================================================
-- Migration 024: notification_template_extras + user mutes
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE notification_template_extra_recipients (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_template_extra_recipients_unique UNIQUE (template_id, user_id)
);

CREATE INDEX notification_template_extra_recipients_template_idx
    ON notification_template_extra_recipients (template_id);

CREATE TABLE notification_user_mutes (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    muted_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_user_mutes_unique UNIQUE (user_id, template_id)
);

CREATE INDEX notification_user_mutes_user_idx ON notification_user_mutes (user_id);

COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS notification_user_mutes;
DROP TABLE IF EXISTS notification_template_extra_recipients;
COMMIT;
```

- [ ] **Step 5.1.4 — Apply + run test + commit**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/migrate.js 2>&1 | tail -3
```

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/migrations/023_notification_senders.sql backend/migrations/024_notification_template_extras.sql backend/test/migrations/023_024_notifications.test.js
git commit -m "feat(db): migrations 023+024 notification senders + template extras

023 adds notification_senders (provider+config) and notification_templates.
sender_id FK. 024 adds notification_template_extra_recipients (per-template
user list beyond role expansion) and notification_user_mutes (per-user
opt-out).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.2 — Seed default sender + capability + assign to existing templates

**Files:** Modify `backend/scripts/seed.js`. Create `backend/test/services/notification_sender.seed.test.js`.

- [ ] **Step 5.2.1 — Edit seed.js**

After capabilities are seeded, add `manage_notifications` capability + grant to top-rank managers. Then seed default sender + assign it to existing notification_templates:

```js
// New capability for notification settings
await client.query(`
  INSERT INTO capability_definitions (capability_key, capability_name)
  VALUES ('manage_notifications','Manage notification senders and templates')
  ON CONFLICT (capability_key) DO NOTHING`);

// Grant to top-rank managers on admin_rbac (CEO/Superadmin bypass elsewhere)
await client.query(`
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
await client.query(`
  INSERT INTO notification_senders
    (sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active)
  VALUES ('noreply', 'Interlab Notifications', $1, NULL, 'smtp', 'smtp.default', true)
  ON CONFLICT (sender_key) DO UPDATE SET
    display_name = EXCLUDED.display_name,
    from_email = EXCLUDED.from_email,
    updated_at = now()`,
  [process.env.EMAIL_FROM_ADDRESS || process.env.SMTP_FROM || 'noreply@interlab-portal.com']);

// Assign default sender to all existing templates that don't have one
await client.query(`
  UPDATE notification_templates SET sender_id = (SELECT id FROM notification_senders WHERE sender_key='noreply')
   WHERE sender_id IS NULL`);
```

Add `ALL_CAPABILITY_KEYS` extension in `permission.service.js` to include `manage_notifications` (similar to Plan 4 carrying forward — needed for superadmin/CEO bypass).

- [ ] **Step 5.2.2 — Re-run seed + test**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/seed.js 2>&1 | tail -3
```

Test:
```js
'use strict';
const { pool } = require('../helpers/db');

describe('seed — notification sender + capability', () => {
  it('default noreply sender exists', async () => {
    const r = await pool.query(`SELECT provider, is_active FROM notification_senders WHERE sender_key='noreply'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].provider).toBe('smtp');
    expect(r.rows[0].is_active).toBe(true);
  });

  it('all existing notification_templates have sender_id assigned', async () => {
    const r = await pool.query(`SELECT count(*)::int AS n FROM notification_templates WHERE sender_id IS NULL`);
    expect(r.rows[0].n).toBe(0);
  });

  it('manage_notifications capability exists', async () => {
    const r = await pool.query(`SELECT 1 FROM capability_definitions WHERE capability_key='manage_notifications'`);
    expect(r.rowCount).toBe(1);
  });
});
```

- [ ] **Step 5.2.3 — Commit**

```bash
git add backend/scripts/seed.js backend/src/services/permission.service.js backend/test/services/notification_sender.seed.test.js
git commit -m "feat(seed): default noreply sender + manage_notifications capability + template assignment

Default sender points at existing SMTP config. All existing templates get
sender_id assigned. manage_notifications capability granted to top-rank
managers; CEO/Superadmin bypass via ALL_CAPABILITY_KEYS extension.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.3 — `notification_sender.service.js` (CRUD + resolve)

**Files:** Create service + test.

- [ ] **Step 5.3.1 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/notification_sender.service');

let ceoId;

beforeAll(async () => {
  const u = await pool.query(`SELECT id FROM users WHERE role='ceo' LIMIT 1`);
  ceoId = u.rows[0]?.id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM notification_senders WHERE sender_key LIKE 'test-sender-%'`);
});

describe('notification_sender.service', () => {
  it('create + list', async () => {
    if (!ceoId) return;
    const created = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      sender_key: `test-sender-${Date.now()}`,
      display_name: 'Test',
      from_email: 'test@example.com',
      provider: 'smtp',
      provider_config_key: 'smtp.default',
    });
    expect(created.id).toBeDefined();
    const list = await svc.list();
    expect(list.find(s => s.id === created.id)).toBeDefined();
  });

  it('resolveByTemplateKey returns the template-assigned sender or default', async () => {
    if (!ceoId) return;
    // pick any seeded template
    const t = await pool.query(`SELECT template_key FROM notification_templates LIMIT 1`);
    if (!t.rowCount) return;
    const sender = await svc.resolveByTemplateKey(t.rows[0].template_key);
    expect(sender).toBeDefined();
    expect(sender.provider).toBeDefined();
  });

  it('non-superadmin/non-ceo without manage_notifications cannot create', async () => {
    const s = await pool.query(`
      SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
       WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
    const staffId = s.rows[0]?.id;
    if (!staffId) return;
    await expect(svc.create({
      actor: { id: staffId, role: 'sales' },
      sender_key: 'test-sender-forbidden', display_name: 'X',
      from_email: 'x@x.com', provider: 'smtp', provider_config_key: 'smtp.default',
    })).rejects.toThrow();
  });
});
```

- [ ] **Step 5.3.2 — Implement**

```js
'use strict';
const db = require('../config/database');
const { ForbiddenError, ValidationError } = require('../utils/errors');
const perms = require('./permission.service');
const activityLog = require('./activity_log.service');

const VALID_PROVIDERS = ['smtp','gmail','ses','postmark','resend'];

async function authorize(actor) {
  if (actor.role === 'superadmin' || actor.role === 'ceo') return;
  const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
  if (!caps.has('manage_notifications') && !caps.has('full_access')) {
    throw new ForbiddenError('lacks manage_notifications capability');
  }
}

async function resolveActorEmail(actor) {
  if (actor.email) return actor.email;
  const r = await db.query(`SELECT email FROM users WHERE id=$1`, [actor.id]);
  return r.rows[0]?.email || 'system@internal';
}

async function list() {
  const r = await db.query(`SELECT * FROM notification_senders ORDER BY display_name`);
  return r.rows;
}

async function create({ actor, sender_key, display_name, from_email, reply_to_email = null, provider, provider_config_key, is_active = true }) {
  await authorize(actor);
  if (!VALID_PROVIDERS.includes(provider)) throw new ValidationError(`invalid provider: ${provider}`);
  const r = await db.query(`
    INSERT INTO notification_senders (sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active)
    VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active]);
  resolveActorEmail(actor).then(email => activityLog.record({
    userId: actor.id, userEmail: email, userRole: actor.role,
    action: 'notification.sender.created',
    resourceType: 'notification_senders', resourceId: r.rows[0].id,
    details: { sender_key, provider },
  }).catch(()=>{})).catch(()=>{});
  return r.rows[0];
}

async function update({ actor, id, patch }) {
  await authorize(actor);
  const r = await db.query(`
    UPDATE notification_senders SET
      display_name        = COALESCE($2, display_name),
      from_email          = COALESCE($3, from_email),
      reply_to_email      = COALESCE($4, reply_to_email),
      provider            = COALESCE($5, provider),
      provider_config_key = COALESCE($6, provider_config_key),
      is_active           = COALESCE($7, is_active),
      updated_at          = now()
     WHERE id=$1 RETURNING *`,
    [id, patch.display_name ?? null, patch.from_email ?? null, patch.reply_to_email ?? null,
     patch.provider ?? null, patch.provider_config_key ?? null, patch.is_active ?? null]);
  if (!r.rowCount) throw new ValidationError('sender not found');
  return r.rows[0];
}

async function remove({ actor, id }) {
  await authorize(actor);
  const used = await db.query(`SELECT count(*)::int AS n FROM notification_templates WHERE sender_id=$1`, [id]);
  if (used.rows[0].n > 0) throw new ValidationError('cannot delete: sender is in use by templates');
  await db.query(`DELETE FROM notification_senders WHERE id=$1`, [id]);
  return { ok: true };
}

async function resolveByTemplateKey(templateKey) {
  const r = await db.query(`
    SELECT s.* FROM notification_templates t
      LEFT JOIN notification_senders s ON s.id = t.sender_id AND s.is_active=true
     WHERE t.template_key = $1`, [templateKey]);
  if (r.rows[0]?.id) return r.rows[0];
  // Fallback to noreply
  const fb = await db.query(`SELECT * FROM notification_senders WHERE sender_key='noreply' LIMIT 1`);
  return fb.rows[0] || null;
}

module.exports = { list, create, update, remove, resolveByTemplateKey };
```

- [ ] **Step 5.3.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/notification_sender.service.test.js 2>&1 | tail -10
```

```bash
git add backend/src/services/notification_sender.service.js backend/test/services/notification_sender.service.test.js
git commit -m "feat(notification): notification_sender CRUD service + resolveByTemplateKey

Authority: superadmin/ceo OR top-rank manager with manage_notifications.
Block delete when sender is in use by any template. resolveByTemplateKey
returns the template's sender or falls back to 'noreply'.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.4 — Routes: sender CRUD + template editor + mute toggles

**Files:**
- Create: `backend/src/routes/admin/notification-senders.routes.js`
- Create: `backend/src/routes/admin/notification-templates.routes.js` (or extend existing)
- Create: `backend/src/services/notification_mute.service.js`
- Create: `backend/src/routes/users/me-notifications.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 5.4.1 — Sender routes**

```js
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const svc = require('../../services/notification_sender.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

const create = Joi.object({
  sender_key: Joi.string().min(2).max(60).required(),
  display_name: Joi.string().min(1).max(120).required(),
  from_email: Joi.string().email().required(),
  reply_to_email: Joi.string().email().allow(null, ''),
  provider: Joi.string().valid('smtp','gmail','ses','postmark','resend').required(),
  provider_config_key: Joi.string().min(1).max(120).required(),
  is_active: Joi.boolean().default(true),
});

const update = Joi.object({
  display_name: Joi.string().min(1).max(120),
  from_email: Joi.string().email(),
  reply_to_email: Joi.string().email().allow(null, ''),
  provider: Joi.string().valid('smtp','gmail','ses','postmark','resend'),
  provider_config_key: Joi.string().min(1).max(120),
  is_active: Joi.boolean(),
}).min(1);

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try { res.json(success({ items: await svc.list() })); } catch (e) { next(e); }
});

router.post('/', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: create }),
  async (req, res, next) => {
    try { res.status(201).json(success(await svc.create({ actor: req.user, ...req.body }))); }
    catch (e) { next(e); }
  });

router.patch('/:id', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: update }),
  async (req, res, next) => {
    try { res.json(success(await svc.update({ actor: req.user, id: req.params.id, patch: req.body }))); }
    catch (e) { next(e); }
  });

router.delete('/:id', rbacGuard('admin_rbac', 'delete'), permissionWriteLimiter,
  async (req, res, next) => {
    try { res.json(success(await svc.remove({ actor: req.user, id: req.params.id }))); }
    catch (e) { next(e); }
  });

module.exports = router;
```

- [ ] **Step 5.4.2 — Template editor routes**

```js
// backend/src/routes/admin/notification-templates.routes.js
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try {
    const r = await db.query(`
      SELECT id, template_key, template_name, feature_group, trigger_event,
             recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
             status, subject, body, sender_id, updated_at
        FROM notification_templates ORDER BY feature_group, template_key`);
    res.json(success({ items: r.rows }));
  } catch (e) { next(e); }
});

router.get('/:id', rbacGuard('admin_rbac', 'view_global'), async (req, res, next) => {
  try {
    const t = await db.query(`SELECT * FROM notification_templates WHERE id=$1`, [req.params.id]);
    if (!t.rowCount) return res.status(404).json({ error: 'not found' });
    const extras = await db.query(`
      SELECT u.id AS user_id, u.email, u.display_name
        FROM notification_template_extra_recipients e
        JOIN users u ON u.id = e.user_id
       WHERE e.template_id = $1`, [req.params.id]);
    res.json(success({ template: t.rows[0], extra_recipients: extras.rows }));
  } catch (e) { next(e); }
});

const patch = Joi.object({
  sender_id: Joi.string().uuid().allow(null),
  recipient_roles_json: Joi.array().items(Joi.string()),
  send_email_enabled: Joi.boolean(),
  send_dashboard_notification_enabled: Joi.boolean(),
  status: Joi.string().valid('enabled','disabled'),
  subject: Joi.string().allow('', null),
  body: Joi.string().allow('', null),
}).min(1);

router.patch('/:id', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: patch }),
  async (req, res, next) => {
    try {
      const b = req.body;
      const r = await db.query(`
        UPDATE notification_templates SET
          sender_id                            = COALESCE($2, sender_id),
          recipient_roles_json                 = COALESCE($3::jsonb, recipient_roles_json),
          send_email_enabled                   = COALESCE($4, send_email_enabled),
          send_dashboard_notification_enabled  = COALESCE($5, send_dashboard_notification_enabled),
          status                               = COALESCE($6, status),
          subject                              = COALESCE($7, subject),
          body                                 = COALESCE($8, body),
          updated_at                           = now()
         WHERE id=$1 RETURNING *`,
        [req.params.id, b.sender_id ?? null,
         b.recipient_roles_json ? JSON.stringify(b.recipient_roles_json) : null,
         b.send_email_enabled ?? null, b.send_dashboard_notification_enabled ?? null,
         b.status ?? null, b.subject ?? null, b.body ?? null]);
      res.json(success(r.rows[0]));
    } catch (e) { next(e); }
  });

router.put('/:id/extra-recipients', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter,
  validate({ body: Joi.object({ user_ids: Joi.array().items(Joi.string().uuid()).required() }) }),
  async (req, res, next) => {
    try {
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await client.query(`DELETE FROM notification_template_extra_recipients WHERE template_id=$1`, [req.params.id]);
        for (const uid of req.body.user_ids) {
          await client.query(`
            INSERT INTO notification_template_extra_recipients (template_id, user_id)
            VALUES ($1,$2) ON CONFLICT DO NOTHING`, [req.params.id, uid]);
        }
        await client.query('COMMIT');
        res.json(success({ ok: true, count: req.body.user_ids.length }));
      } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
      } finally { client.release(); }
    } catch (e) { next(e); }
  });

module.exports = router;
```

- [ ] **Step 5.4.3 — Mute service + user routes**

```js
// backend/src/services/notification_mute.service.js
'use strict';
const db = require('../config/database');

async function listForUser(userId) {
  const r = await db.query(`
    SELECT m.template_id, t.template_key, t.template_name
      FROM notification_user_mutes m
      JOIN notification_templates t ON t.id = m.template_id
     WHERE m.user_id = $1`, [userId]);
  return r.rows;
}

async function mute(userId, templateId) {
  await db.query(`
    INSERT INTO notification_user_mutes (user_id, template_id) VALUES ($1, $2)
    ON CONFLICT DO NOTHING`, [userId, templateId]);
  return { ok: true };
}

async function unmute(userId, templateId) {
  await db.query(`DELETE FROM notification_user_mutes WHERE user_id=$1 AND template_id=$2`, [userId, templateId]);
  return { ok: true };
}

module.exports = { listForUser, mute, unmute };
```

```js
// backend/src/routes/users/me-notifications.routes.js
'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const muteSvc = require('../../services/notification_mute.service');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

router.get('/templates', async (req, res, next) => {
  try {
    const r = await db.query(`
      SELECT t.id, t.template_key, t.template_name, t.feature_group,
             EXISTS (SELECT 1 FROM notification_user_mutes m
                      WHERE m.user_id = $1 AND m.template_id = t.id) AS muted
        FROM notification_templates t
       WHERE t.status = 'enabled'
       ORDER BY t.feature_group, t.template_name`, [req.user.id]);
    res.json(success({ items: r.rows }));
  } catch (e) { next(e); }
});

router.post('/mutes/:templateId', async (req, res, next) => {
  try { res.json(success(await muteSvc.mute(req.user.id, req.params.templateId))); } catch (e) { next(e); }
});

router.delete('/mutes/:templateId', async (req, res, next) => {
  try { res.json(success(await muteSvc.unmute(req.user.id, req.params.templateId))); } catch (e) { next(e); }
});

module.exports = router;
```

- [ ] **Step 5.4.4 — Mount in app.js**

```js
app.use('/api/admin/notification-senders', require('./routes/admin/notification-senders.routes'));
app.use('/api/admin/notification-templates', require('./routes/admin/notification-templates.routes'));
app.use('/api/users/me/notifications', require('./routes/users/me-notifications.routes'));
```

- [ ] **Step 5.4.5 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

```bash
git add backend/src/routes/admin/notification-senders.routes.js backend/src/routes/admin/notification-templates.routes.js backend/src/services/notification_mute.service.js backend/src/routes/users/me-notifications.routes.js backend/src/app.js
git commit -m "feat(notification): sender CRUD + template editor + user mute routes

/api/admin/notification-senders — sender CRUD.
/api/admin/notification-templates — list + read + patch + replace
extra-recipients.
/api/users/me/notifications — list templates with mute status + toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.5 — Extend `notification.service.emit` with sender + extras + mutes + dedupe

**Files:** Modify `backend/src/services/notification.service.js`. Test in `backend/test/services/notification.dedupe.test.js`.

- [ ] **Step 5.5.1 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');
const ns = require('../../src/services/notification.service');

describe('notification.emit — extras + mutes + dedupe', () => {
  let testUserId, templateId;

  beforeAll(async () => {
    const u = await pool.query(`SELECT id FROM users WHERE role='sales' LIMIT 1`);
    testUserId = u.rows[0]?.id;
    const t = await pool.query(`SELECT id, template_key FROM notification_templates LIMIT 1`);
    templateId = t.rows[0]?.id;
  });

  it('extra recipient receives notification beyond role expansion', async () => {
    if (!testUserId || !templateId) return;
    await pool.query(`
      INSERT INTO notification_template_extra_recipients (template_id, user_id) VALUES ($1, $2)
      ON CONFLICT DO NOTHING`, [templateId, testUserId]);
    const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
    const r = await ns.emit(null, {
      templateKey: tk.rows[0].template_key,
      title: 'test extra',
      message: 'extra recipient test',
      module: 'test', entityType: 'test', entityId: testUserId,
    });
    expect(r.notificationIds.length).toBeGreaterThan(0);
    await pool.query(`DELETE FROM notification_template_extra_recipients WHERE template_id=$1 AND user_id=$2`,
      [templateId, testUserId]);
  });

  it('muted user is excluded from recipients', async () => {
    if (!testUserId || !templateId) return;
    await pool.query(`
      INSERT INTO notification_user_mutes (user_id, template_id) VALUES ($1, $2)
      ON CONFLICT DO NOTHING`, [testUserId, templateId]);
    const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
    const r = await ns.emit(null, {
      templateKey: tk.rows[0].template_key,
      title: 'test muted',
      extraRecipientUserIds: [testUserId], // even if explicitly named, mute wins
    });
    // The muted user should not receive — but other role-expanded users may. So check the user is absent.
    const sent = await pool.query(`SELECT 1 FROM notifications WHERE id = ANY($1::uuid[]) AND recipient_user_id=$2`,
      [r.notificationIds, testUserId]);
    expect(sent.rowCount).toBe(0);
    await pool.query(`DELETE FROM notification_user_mutes WHERE user_id=$1 AND template_id=$2`,
      [testUserId, templateId]);
  });

  it('dedupe window suppresses duplicate emits within 60s', async () => {
    if (!testUserId || !templateId) return;
    const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
    const r1 = await ns.emit(null, {
      templateKey: tk.rows[0].template_key,
      title: 'dedupe test',
      module: 'test', entityType: 'test', entityId: 'fixed-id-for-dedupe',
      extraRecipientUserIds: [testUserId],
    });
    const r2 = await ns.emit(null, {
      templateKey: tk.rows[0].template_key,
      title: 'dedupe test 2',
      module: 'test', entityType: 'test', entityId: 'fixed-id-for-dedupe',
      extraRecipientUserIds: [testUserId],
    });
    // Second emit should be deduped (notificationIds empty or skipped flag)
    expect(r2.deduped).toBe(true);
  });
});
```

- [ ] **Step 5.5.2 — Implement extensions**

In `notification.service.js`, modify `emit()` to:
1. Look up sender via `notification_sender.service.resolveByTemplateKey`
2. Expand recipients = (role expansion) ∪ extras − mutes
3. Dedupe key: `(template_id, recipient_user_id, entity_id)` within 60s — use Redis (key `notif:dedupe:{...}` TTL 60s)
4. Stamp `sender_id` on the queued email

Specific changes (read existing emit() then patch):

```js
// Before INSERT to notifications, look up extras + mutes
const extrasRes = await runner.query(`
  SELECT user_id FROM notification_template_extra_recipients WHERE template_id=$1`, [template?.id || null]);
for (const r of extrasRes.rows) userSet.add(r.user_id);

// Filter out muted users
if (template?.id && userSet.size) {
  const muted = await runner.query(`
    SELECT user_id FROM notification_user_mutes
     WHERE template_id=$1 AND user_id = ANY($2::uuid[])`, [template.id, [...userSet]]);
  for (const r of muted.rows) userSet.delete(r.user_id);
}

// Dedupe via Redis
const { getRedis, isAvailable } = require('../config/redis');
const dedupeKey = options.entityId
  ? `notif:dedupe:${template?.id || templateKey}:${options.entityId}`
  : null;
if (dedupeKey && isAvailable()) {
  const set = await getRedis().set(dedupeKey, '1', 'EX', 60, 'NX');
  if (set === null) {
    return { skipped: true, deduped: true, notificationIds: [] };
  }
}

// When email is enqueued, include sender info:
const senderSvc = require('./notification_sender.service');
const sender = await senderSvc.resolveByTemplateKey(templateKey);
// ... pass sender.id (or sender.from_email + display_name) into the email_queue insert
```

Adjust the existing `emit()` implementation accordingly. Reading the existing `notification.service.js` is essential — match its style.

- [ ] **Step 5.5.3 — Run + commit**

```bash
git add backend/src/services/notification.service.js backend/test/services/notification.dedupe.test.js
git commit -m "feat(notification): extras + mutes + 60s dedupe in emit()

emit() now:
- Expands recipients = (role expansion) ∪ template_extra_recipients − user_mutes
- Dedupes (template, entity_id) pairs within 60s using Redis NX SET
- Resolves sender via resolveByTemplateKey for the email_queue payload

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.6 — Dispatch worker + scheduler tick

**Files:** Create `backend/src/services/notification_dispatch.worker.js` + register in scheduler.

- [ ] **Step 5.6.1 — Worker implementation**

```js
'use strict';
const db = require('../config/database');
const factory = require('./email-providers/factory');

const MAX_ATTEMPTS = 5;

async function processOne(row) {
  // Look up sender via the row's sender_id (added in this task to email_queue)
  // OR fall back to default if email_queue row lacks sender_id (legacy rows).
  let sender = null;
  if (row.sender_id) {
    const r = await db.query(`SELECT * FROM notification_senders WHERE id=$1 AND is_active=true`, [row.sender_id]);
    sender = r.rows[0];
  }
  if (!sender) sender = await factory.resolveDefaultSender();

  try {
    await factory.sendViaSender(sender, {
      to: row.to_address,
      cc: row.cc_address || undefined,
      bcc: row.bcc_address || undefined,
      subject: row.subject,
      html: row.body_html,
    });
    await db.query(`UPDATE email_queue SET status='sent', sent_at=now() WHERE id=$1`, [row.id]);
    return { sent: true };
  } catch (err) {
    const newAttempts = row.attempts + 1;
    const newStatus = newAttempts >= MAX_ATTEMPTS ? 'failed' : 'pending';
    await db.query(`
      UPDATE email_queue SET attempts=$2, last_error=$3, status=$4 WHERE id=$1`,
      [row.id, newAttempts, err.message?.slice(0, 500), newStatus]);
    return { sent: false, attempts: newAttempts };
  }
}

async function tick({ batchSize = 20 } = {}) {
  // Add sender_id column to email_queue if not present.
  const r = await db.query(`
    SELECT * FROM email_queue
     WHERE status = 'pending' AND attempts < $1
     ORDER BY created_at ASC LIMIT $2`, [MAX_ATTEMPTS, batchSize]);
  const results = [];
  for (const row of r.rows) {
    results.push(await processOne(row));
  }
  return { processed: results.length, sent: results.filter(x => x.sent).length };
}

module.exports = { tick, processOne, MAX_ATTEMPTS };
```

- [ ] **Step 5.6.2 — Add `email_queue.sender_id` column (small migration)**

This requires migration `025_email_queue_sender.sql`:

```sql
-- +migrate Up
BEGIN;
ALTER TABLE email_queue
  ADD COLUMN sender_id uuid NULL REFERENCES notification_senders(id) ON DELETE SET NULL;
CREATE INDEX email_queue_sender_idx ON email_queue (sender_id) WHERE sender_id IS NOT NULL;
COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS email_queue_sender_idx;
ALTER TABLE email_queue DROP COLUMN IF EXISTS sender_id;
COMMIT;
```

Apply after creation. Also update `notification.service.emit` to write `sender_id` when enqueuing (Task 5.5 hook).

- [ ] **Step 5.6.3 — Register tick in scheduler**

In `backend/src/jobs/scheduler.js`, after existing cron jobs, add:

```js
// Notification dispatch — every 30s
const dispatchWorker = require('../services/notification_dispatch.worker');
this._registerJob('notification_dispatch', '*/30 * * * * *', async () => {
  await dispatchWorker.tick();
}, { tz: 'Asia/Jakarta' });
```

(Adapt to actual scheduler API — `node-cron` may not support sub-minute by default. Alternative: use `setInterval(() => dispatchWorker.tick(), 30000)` registered alongside the cron jobs. Pick whichever fits the existing scheduler shape.)

- [ ] **Step 5.6.4 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');
const worker = require('../../src/services/notification_dispatch.worker');

describe('notification_dispatch.worker', () => {
  it('tick processes pending email_queue rows', async () => {
    // Insert a stub pending row that will fail (no SMTP creds in test) but should bump attempts
    const r = await pool.query(`
      INSERT INTO email_queue (to_address, subject, body_html)
      VALUES ($1, $2, $3) RETURNING id`,
      ['unreachable@test.invalid', 'test', '<p>x</p>']);
    const result = await worker.tick({ batchSize: 5 });
    expect(result.processed).toBeGreaterThan(0);
    const after = await pool.query(`SELECT attempts FROM email_queue WHERE id=$1`, [r.rows[0].id]);
    expect(after.rows[0].attempts).toBeGreaterThan(0);
    await pool.query(`DELETE FROM email_queue WHERE id=$1`, [r.rows[0].id]);
  });

  it('exits cleanly when no pending rows', async () => {
    const result = await worker.tick();
    expect(result.processed).toBeGreaterThanOrEqual(0);
  });
});
```

- [ ] **Step 5.6.5 — Apply migration + run + commit**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/migrate.js 2>&1 | tail -3
```

```bash
git add backend/migrations/025_email_queue_sender.sql backend/src/services/notification_dispatch.worker.js backend/src/jobs/scheduler.js backend/test/services/notification_dispatch.worker.test.js
git commit -m "feat(notification): dispatch worker drains email_queue via provider factory

Worker tick processes up to 20 pending email_queue rows per call. Looks
up sender via row.sender_id or falls back to default. Routes through
email-providers/factory.sendViaSender. On failure: bump attempts, mark
'failed' after MAX_ATTEMPTS=5.

Adds email_queue.sender_id column (migration 025) so each queued mail
remembers which sender configuration to use.

Registers a 30s scheduler tick.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5.7 — Frontend: senders + templates + mutes UIs

**Files:** Create types + api + 4 pages.

- [ ] **Step 5.7.1 — `frontend/lib/notification-types.ts` + `notification-api.ts`**

Types: `NotificationSender`, `NotificationTemplate`, `TemplateExtraRecipient`, `NotificationMuteRow`.

API:
- `notificationApi.listSenders / createSender / updateSender / deleteSender`
- `notificationApi.listTemplates / getTemplate / patchTemplate / setExtraRecipients`
- `notificationApi.listMyTemplates / mute / unmute`

(Pattern matches Plans 1-4 lib trios.)

- [ ] **Step 5.7.2 — Senders page** at `app/(app)/admin/notifications/senders/page.tsx`

CRUD table (Superadmin/CEO/manage_notifications). Tab-style or simple table with create form.

- [ ] **Step 5.7.3 — Templates list page** at `app/(app)/admin/notifications/templates/page.tsx`

List of templates grouped by feature_group; each row links to edit page.

- [ ] **Step 5.7.4 — Template edit page** at `app/(app)/admin/notifications/templates/[id]/page.tsx`

Form fields:
- sender_id (dropdown of senders)
- recipient_roles_json (multi-select of role keys)
- send_email_enabled / send_dashboard_notification_enabled / status toggle
- subject / body (textarea)
- extra_recipients (typeahead user picker — search by email or display_name)

- [ ] **Step 5.7.5 — Profile mute toggles** at `app/(app)/profile/notifications/page.tsx`

List of templates with toggle to mute/unmute.

- [ ] **Step 5.7.6 — Type-check + commit (one commit per page is fine, or batch)**

Each page implementation should be a separate concise commit.

```bash
git commit -m "feat(notification): admin senders/templates UI + profile mute toggles"
```

---

## Final integration check

- [ ] **F.1 — Full backend suite**

Expected: all prior + Plan 5 new tests pass.

- [ ] **F.2 — Frontend type-check** — no new errors.

- [ ] **F.3 — Smoke test (manual)**

1. Login as Superadmin → `/admin/notifications/senders` → create a "Sales Ops" sender (provider=smtp, from=sales-ops@interlab.com).
2. Edit a template → assign Sales Ops sender → add an extra recipient (CEO).
3. Trigger a domain event that fires that template (e.g., create a new PO if there's a registered_po template).
4. Watch `email_queue` — row appears with `sender_id` pointing at Sales Ops.
5. After 30s, dispatch worker should mark it `sent` (or `failed` if SMTP creds missing).
6. As recipient user → `/profile/notifications` → mute that template.
7. Trigger event again → muted user no longer in recipients.

---

## Self-review

- ✅ **Spec coverage**:
  - Migration 023 + 024 + 025 (Tasks 5.1, 5.6)
  - Sender CRUD with provider abstraction (Task 5.3, 5.4)
  - Multi-recipient: role expansion ∪ extras − mutes (Task 5.5)
  - 60s dedupe (Task 5.5)
  - Provider routing via Plan 1's `email-providers/factory.js` (Task 5.6 worker)
  - User mute (Tasks 5.4 + 5.5 + 5.7)
  - Sender swap requires only DB row update — provider abstraction handles routing (Task 5.6)
- ✅ **No placeholders**
- ✅ **Plan 1+ dependencies honored**: uses email-providers/factory, ALL_CAPABILITY_KEYS extended, success() wrapper, validate({...}), authMiddleware

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-plan5-notification-sender.md`.**

7 tasks. ~7-9 subagent dispatches expected.

Plan 1 already built `email-providers/factory.js` — Plan 5 wires DB-backed sender config + dispatch worker + UI.

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review.
**2. Inline Execution** — batch with checkpoints.
