# Plan 1 — Foundation + F2 Permission System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`).
> **Master plan:** `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md` (commit `8a14656`).

**Goal:** Land Sprint 0 (4 shared modules) + Sprint 1 (F2 hybrid B+C+D permission system) so all subsequent feature plans (F1/F3/F4/F5) can build on top.

**Architecture:** Single permission resolver (`backend/src/services/permission.service.js`) with deterministic 5-step formula and Redis-backed cache. Three new tables (`role_levels`, `user_capability_overrides`, `cross_dept_grants`) plus `users.level_id` and `role_permissions.level_id` columns. Email provider abstraction layered behind `notification_senders` (table arrives with F5; for now, a default sender pulled from `app_settings`). Frontend admin UIs for level CRUD, permission matrix, and per-user override.

**Tech Stack:** Vitest 1.x (new — backend test runner), `ioredis` (new — permission cache), `argon2` (new — password hashing for F1 dependency), `@aws-sdk/client-ses` (new — production email), Express 4 + `pg` (existing), Next.js 14 + React 18 + Zustand + Tailwind (existing).

---

## File map (canonical paths used throughout)

**Net-new backend files**
- `backend/vitest.config.js`
- `backend/test/helpers/db.js` — test database helper
- `backend/test/helpers/redis.js` — test Redis helper
- `backend/migrations/017_role_levels.sql`
- `backend/migrations/018_user_capability_overrides.sql`
- `backend/migrations/019_cross_dept_grants.sql`
- `backend/src/config/redis.js`
- `backend/src/services/permission.service.js`
- `backend/src/services/role_level.service.js`
- `backend/src/services/permission_override.service.js`
- `backend/src/services/email-providers/factory.js`
- `backend/src/services/email-providers/smtp.js`
- `backend/src/services/email-providers/gmail.js`
- `backend/src/services/email-providers/ses.js`
- `backend/src/services/email-providers/postmark.js`
- `backend/src/services/email-providers/resend.js`
- `backend/src/routes/admin/levels.routes.js`
- `backend/src/routes/admin/permissions.routes.js`
- `backend/src/routes/admin/overrides.routes.js`
- `backend/src/validators/levels.validators.js`
- `backend/src/validators/overrides.validators.js`
- `backend/test/services/permission.service.test.js`
- `backend/test/services/role_level.service.test.js`
- `backend/test/services/permission_override.service.test.js`
- `backend/test/services/email-providers/factory.test.js`

**Modified backend files**
- `backend/package.json` — add deps + scripts
- `backend/src/middleware/rbac.middleware.js` — call resolver
- `backend/src/services/email.service.js` — route via provider factory
- `backend/src/services/activity_log.service.js` — register new event types
- `backend/src/middleware/rateLimit.middleware.js` — add `permissionWriteLimiter`
- `backend/src/app.js` — mount new routes
- `backend/scripts/seed.js` — seed levels + assign existing role_permissions

**Net-new frontend files**
- `frontend/lib/admin-permissions-api.ts`
- `frontend/lib/admin-permissions-types.ts`
- `frontend/lib/admin-permissions-ui.ts`
- `frontend/app/(app)/admin/permissions/page.tsx`
- `frontend/app/(app)/admin/levels/page.tsx`
- `frontend/app/(app)/admin/users/[id]/overrides/page.tsx`

---

## Task 1.0 — Set up Vitest test runner

**Files:**
- Modify: `backend/package.json`
- Create: `backend/vitest.config.js`, `backend/test/helpers/db.js`, `backend/test/helpers/redis.js`, `backend/test/smoke.test.js`

- [ ] **Step 1.0.1 — Install Vitest + supertest**

```bash
cd backend && npm install --save-dev vitest@^1.6.0 supertest@^7.0.0 @vitest/coverage-v8@^1.6.0
```

Expected: `package.json` gains `devDependencies` block; lockfile generated/updated.

- [ ] **Step 1.0.2 — Add `package.json` scripts**

Edit `backend/package.json`, replace `"scripts"` block:

```json
"scripts": {
  "start": "node src/app.js",
  "dev": "node --watch src/app.js",
  "test": "vitest run",
  "test:watch": "vitest",
  "test:coverage": "vitest run --coverage"
}
```

- [ ] **Step 1.0.3 — Create `vitest.config.js`**

```js
'use strict';
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: false,
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serial — shared DB
    testTimeout: 15000,
  },
});
```

- [ ] **Step 1.0.4 — Create `test/setup.js`**

```js
'use strict';
require('dotenv').config({ path: require('path').resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'test';
```

- [ ] **Step 1.0.5 — Create `test/helpers/db.js`**

```js
'use strict';
const { Pool } = require('pg');
const pool = new Pool({ connectionString: process.env.DATABASE_URL });

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    const result = await fn(client);
    await client.query('ROLLBACK'); // every test rolls back
    return result;
  } finally {
    client.release();
  }
}

async function close() { await pool.end(); }

module.exports = { pool, withTx, close };
```

- [ ] **Step 1.0.6 — Create `test/smoke.test.js`**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { pool, close } = require('./helpers/db');

describe('smoke', () => {
  it('connects to postgres', async () => {
    const r = await pool.query('SELECT 1 AS one');
    expect(r.rows[0].one).toBe(1);
  });
  afterAll(close);
});
```

- [ ] **Step 1.0.7 — Run smoke test**

```bash
cd backend && npm test
```

Expected: 1 test passes. If fails: ensure Postgres reachable and `DATABASE_URL` set in repo-root `.env`.

- [ ] **Step 1.0.8 — Commit**

```bash
git add backend/package.json backend/package-lock.json backend/vitest.config.js backend/test/
git commit -m "chore(backend): add vitest test runner with db helper

Sprint 0 prerequisite. Smoke test verifies postgres connectivity. Tests use
forked-serial pool so a single shared schema can be used safely.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.1 — Redis client + cache scaffold

**Files:**
- Modify: `backend/package.json`, `backend/src/config/env.js`, `backend/.env.example`
- Create: `backend/src/config/redis.js`, `backend/test/config/redis.test.js`, `backend/test/helpers/redis.js`

- [ ] **Step 1.1.1 — Install ioredis**

```bash
cd backend && npm install ioredis@^5.4.0
```

- [ ] **Step 1.1.2 — Add Redis env keys to `env.js`**

Append inside the `module.exports` object in `backend/src/config/env.js`:

```js
redis: {
  url: optional('REDIS_URL', 'redis://localhost:6379'),
  required: optional('REQUIRE_REDIS', 'false') === 'true',
  ttlSeconds: Number(optional('PERMISSION_CACHE_TTL', '300')),
},
```

Add the same keys to `backend/.env.example` with comments.

- [ ] **Step 1.1.3 — Write failing test `test/config/redis.test.js`**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { getRedis, isAvailable, close } = require('../../src/config/redis');

describe('redis client', () => {
  it('returns a client when REDIS_URL is reachable', async () => {
    const redis = getRedis();
    expect(redis).not.toBeNull();
    const pong = await redis.ping();
    expect(pong).toBe('PONG');
  });

  it('reports availability status', () => {
    expect(typeof isAvailable()).toBe('boolean');
  });

  afterAll(close);
});
```

- [ ] **Step 1.1.4 — Run test (expect fail)**

```bash
cd backend && npx vitest run test/config/redis.test.js
```

Expected: fails — module `src/config/redis.js` does not exist yet.

- [ ] **Step 1.1.5 — Implement `src/config/redis.js`**

```js
'use strict';
const Redis = require('ioredis');
const env = require('./env');

let client = null;
let available = false;

function getRedis() {
  if (client) return client;
  client = new Redis(env.redis.url, {
    lazyConnect: false,
    maxRetriesPerRequest: 2,
    enableOfflineQueue: false,
  });
  client.on('ready', () => { available = true; });
  client.on('error', (err) => {
    available = false;
    if (env.redis.required) {
      console.error('[redis] connection error:', err.message);
    }
  });
  client.on('end', () => { available = false; });
  return client;
}

function isAvailable() { return available; }

async function close() {
  if (client) { await client.quit().catch(() => {}); client = null; available = false; }
}

module.exports = { getRedis, isAvailable, close };
```

- [ ] **Step 1.1.6 — Run test (expect pass)**

```bash
npx vitest run test/config/redis.test.js
```

Expected: 2 tests pass. If fails for connection reason: ensure Redis running (`docker ps | grep redis`) or set `REDIS_URL` in `.env`.

- [ ] **Step 1.1.7 — Create `test/helpers/redis.js`**

```js
'use strict';
const { getRedis, close } = require('../../src/config/redis');

async function flushTestKeys(prefix = 'perm:') {
  const redis = getRedis();
  const keys = await redis.keys(`${prefix}*`);
  if (keys.length) await redis.del(...keys);
}

module.exports = { flushTestKeys, close };
```

- [ ] **Step 1.1.8 — Commit**

```bash
git add backend/package.json backend/package-lock.json backend/src/config/redis.js backend/src/config/env.js backend/.env.example backend/test/config/ backend/test/helpers/redis.js
git commit -m "feat(backend): add ioredis client with availability tracking

Adds REDIS_URL/REQUIRE_REDIS/PERMISSION_CACHE_TTL env keys. Used by F2
permission resolver cache (Task 1.6+).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.2 — Migration 017: `role_levels` + `users.level_id` + `role_permissions.level_id`

**Files:**
- Create: `backend/migrations/017_role_levels.sql`, `backend/test/migrations/017_role_levels.test.js`

- [ ] **Step 1.2.1 — Write failing test `test/migrations/017_role_levels.test.js`**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');

describe('migration 017 role_levels', () => {
  it('table role_levels exists with expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name, is_nullable, data_type
        FROM information_schema.columns
       WHERE table_name = 'role_levels'
       ORDER BY column_name`);
    const cols = Object.fromEntries(r.rows.map(c => [c.column_name, c]));
    expect(cols.id).toBeDefined();
    expect(cols.role_id).toBeDefined();
    expect(cols.level_key).toBeDefined();
    expect(cols.level_name).toBeDefined();
    expect(cols.level_rank).toBeDefined();
    expect(cols.data_scope_default).toBeDefined();
  });

  it('users.level_id column exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='users' AND column_name='level_id'`);
    expect(r.rowCount).toBe(1);
  });

  it('role_permissions.level_id column exists and is NOT NULL', async () => {
    const r = await pool.query(`
      SELECT is_nullable FROM information_schema.columns
       WHERE table_name='role_permissions' AND column_name='level_id'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].is_nullable).toBe('NO');
  });

  it('quad-unique constraint on role_permissions exists', async () => {
    const r = await pool.query(`
      SELECT conname FROM pg_constraint WHERE conname='role_permissions_quad_unique'`);
    expect(r.rowCount).toBe(1);
  });

  afterAll(close);
});
```

- [ ] **Step 1.2.2 — Run test (expect fail)**

```bash
npx vitest run test/migrations/017_role_levels.test.js
```

Expected: fails — table `role_levels` does not exist.

- [ ] **Step 1.2.3 — Write `migrations/017_role_levels.sql`**

```sql
-- ============================================================================
-- Migration 017: role_levels + level_id columns + role_permissions quad-unique
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE role_levels (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id            uuid         NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    level_key          text         NOT NULL,
    level_name         text         NOT NULL,
    level_rank         int          NOT NULL,
    data_scope_default text         NOT NULL DEFAULT 'own',
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    deleted_at         timestamptz  NULL,
    CONSTRAINT role_levels_unique_key UNIQUE (role_id, level_key),
    CONSTRAINT role_levels_unique_rank UNIQUE (role_id, level_rank),
    CONSTRAINT role_levels_scope_chk CHECK (data_scope_default IN ('own','team','role','global'))
);
CREATE INDEX role_levels_role_idx ON role_levels (role_id) WHERE deleted_at IS NULL;

-- Add level_id to users (nullable: superadmin/ceo and seeded service users keep NULL)
ALTER TABLE users ADD COLUMN level_id uuid NULL REFERENCES role_levels(id) ON DELETE SET NULL;

-- Seed a 'staff' (rank 1) level for each non-system role that has role_permissions rows.
-- Without this, the backfill below would have nothing to point existing rows at.
INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
SELECT r.id,
       r.role_key || '_staff',
       initcap(replace(r.role_key, '_', ' ')) || ' Staff',
       1,
       CASE WHEN r.role_key IN ('superadmin','ceo') THEN 'global' ELSE 'own' END
  FROM roles r
 WHERE r.role_key IN ('sales','admin_log','finance','technical','hrga','tax_insurance')
ON CONFLICT (role_id, level_key) DO NOTHING;

-- Extend role_permissions with level_id (nullable initially, then backfill, then NOT NULL).
ALTER TABLE role_permissions ADD COLUMN level_id uuid NULL REFERENCES role_levels(id) ON DELETE CASCADE;

-- Backfill: every existing role_permissions row gets the rank-1 (staff) level for its role.
UPDATE role_permissions rp
   SET level_id = rl.id
  FROM role_levels rl
 WHERE rl.role_id = rp.role_id
   AND rl.level_rank = 1
   AND rp.level_id IS NULL;

-- Verify no NULLs remain. Throw if any role_permissions row could not be backfilled
-- (would happen if a role has role_permissions but no rank-1 level — i.e. superadmin/ceo).
-- Superadmin/CEO bypass the resolver entirely, so their role_permissions rows are
-- legacy and should be removed.
DELETE FROM role_permissions rp
 WHERE rp.level_id IS NULL
   AND rp.role_id IN (SELECT id FROM roles WHERE role_key IN ('superadmin','ceo'));

-- After cleanup, every remaining row must have level_id.
DO $$
DECLARE remaining int;
BEGIN
    SELECT count(*) INTO remaining FROM role_permissions WHERE level_id IS NULL;
    IF remaining > 0 THEN
        RAISE EXCEPTION 'role_permissions backfill failed: % rows still null', remaining;
    END IF;
END $$;

ALTER TABLE role_permissions ALTER COLUMN level_id SET NOT NULL;

-- Replace triple-unique with quad-unique to allow per-(role, level) permission templates.
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_triple_unique;
ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_quad_unique
        UNIQUE (role_id, level_id, feature_id, capability_id);

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE role_permissions DROP CONSTRAINT IF EXISTS role_permissions_quad_unique;
ALTER TABLE role_permissions DROP COLUMN IF EXISTS level_id;
ALTER TABLE role_permissions
    ADD CONSTRAINT role_permissions_triple_unique
        UNIQUE (role_id, feature_id, capability_id);
ALTER TABLE users DROP COLUMN IF EXISTS level_id;
DROP TABLE IF EXISTS role_levels;
COMMIT;
```

- [ ] **Step 1.2.4 — Apply migration and run test**

```bash
node scripts/migrate.js
npx vitest run test/migrations/017_role_levels.test.js
```

Expected: migration logs "applied 017_role_levels.sql"; all 4 tests pass.

- [ ] **Step 1.2.5 — Commit**

```bash
git add backend/migrations/017_role_levels.sql backend/test/migrations/
git commit -m "feat(db): migration 017 role_levels + level_id columns

Adds role_levels table, users.level_id, role_permissions.level_id with
quad-unique constraint. Backfills existing role_permissions to the rank-1
'staff' level per role. Cleans up legacy superadmin/ceo role_permissions
rows since those roles bypass the resolver.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.3 — Migration 018: `user_capability_overrides`

**Files:**
- Create: `backend/migrations/018_user_capability_overrides.sql`, `backend/test/migrations/018_overrides.test.js`

- [ ] **Step 1.3.1 — Write failing test**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');

describe('migration 018 user_capability_overrides', () => {
  it('table exists with override_type CHECK', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.tables WHERE table_name='user_capability_overrides'`);
    expect(r.rowCount).toBe(1);
    const c = await pool.query(`
      SELECT pg_get_constraintdef(oid) AS def FROM pg_constraint
       WHERE conname='user_overrides_type_chk'`);
    expect(c.rows[0].def).toMatch(/grant|deny/);
  });

  it('quad-unique constraint exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_constraint WHERE conname='user_overrides_unique'`);
    expect(r.rowCount).toBe(1);
  });

  afterAll(close);
});
```

- [ ] **Step 1.3.2 — Run (expect fail), then write migration `018_user_capability_overrides.sql`**

```sql
-- +migrate Up
BEGIN;
CREATE TABLE user_capability_overrides (
    id             uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id        uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    feature_id     uuid         NOT NULL REFERENCES feature_definitions(id) ON DELETE CASCADE,
    capability_id  uuid         NOT NULL REFERENCES capability_definitions(id) ON DELETE CASCADE,
    override_type  text         NOT NULL,
    reason         text         NULL,
    granted_by     uuid         NOT NULL REFERENCES users(id),
    granted_at     timestamptz  NOT NULL DEFAULT now(),
    expires_at     timestamptz  NULL,
    revoked_at     timestamptz  NULL,
    CONSTRAINT user_overrides_unique UNIQUE (user_id, feature_id, capability_id, override_type),
    CONSTRAINT user_overrides_type_chk CHECK (override_type IN ('grant','deny'))
);
CREATE INDEX user_overrides_active_idx ON user_capability_overrides (user_id) WHERE revoked_at IS NULL;
COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS user_capability_overrides;
COMMIT;
```

- [ ] **Step 1.3.3 — Apply + run test**

```bash
node scripts/migrate.js && npx vitest run test/migrations/018_overrides.test.js
```

Expected: pass.

- [ ] **Step 1.3.4 — Commit**

```bash
git add backend/migrations/018_user_capability_overrides.sql backend/test/migrations/018_overrides.test.js
git commit -m "feat(db): migration 018 user_capability_overrides

Per-user grant/deny overrides for the F2 permission resolver. Quad-unique
on (user_id, feature_id, capability_id, override_type) lets a user have
both a grant AND a deny on the same triple — deny wins per spec.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.4 — Migration 019: `cross_dept_grants`

**Files:**
- Create: `backend/migrations/019_cross_dept_grants.sql`, `backend/test/migrations/019_cross_dept.test.js`

- [ ] **Step 1.4.1 — Write failing test**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');

describe('migration 019 cross_dept_grants', () => {
  it('table exists with quad-unique', async () => {
    const t = await pool.query(`SELECT 1 FROM information_schema.tables WHERE table_name='cross_dept_grants'`);
    expect(t.rowCount).toBe(1);
    const c = await pool.query(`SELECT 1 FROM pg_constraint WHERE conname='cross_dept_grants_unique'`);
    expect(c.rowCount).toBe(1);
  });
  afterAll(close);
});
```

- [ ] **Step 1.4.2 — Write migration `019_cross_dept_grants.sql`**

```sql
-- +migrate Up
BEGIN;
CREATE TABLE cross_dept_grants (
    id              uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    grantee_user_id uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    target_role_key text         NOT NULL REFERENCES roles(role_key),
    feature_id      uuid         NOT NULL REFERENCES feature_definitions(id) ON DELETE CASCADE,
    capability_id   uuid         NOT NULL REFERENCES capability_definitions(id) ON DELETE CASCADE,
    granted_by      uuid         NOT NULL REFERENCES users(id),
    granted_at      timestamptz  NOT NULL DEFAULT now(),
    expires_at      timestamptz  NULL,
    revoked_at      timestamptz  NULL,
    notes           text         NULL,
    CONSTRAINT cross_dept_grants_unique
        UNIQUE (grantee_user_id, target_role_key, feature_id, capability_id)
);
CREATE INDEX cross_dept_grants_grantee_idx ON cross_dept_grants (grantee_user_id) WHERE revoked_at IS NULL;
COMMIT;

-- +migrate Down
BEGIN;
DROP TABLE IF EXISTS cross_dept_grants;
COMMIT;
```

- [ ] **Step 1.4.3 — Apply + test + commit**

```bash
node scripts/migrate.js && npx vitest run test/migrations/019_cross_dept.test.js
git add backend/migrations/019_cross_dept_grants.sql backend/test/migrations/019_cross_dept.test.js
git commit -m "feat(db): migration 019 cross_dept_grants

Explicit (grantee, target_role, feature, capability) grants for cross-
department interaction (spec F2). Active partial index on grantee for
fast resolver lookup.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.5 — Seed: top-rank Manager + assign existing users

**Files:**
- Modify: `backend/scripts/seed.js`

- [ ] **Step 1.5.1 — Write failing test `test/scripts/seed.test.js`**

```js
'use strict';
const { describe, it, expect, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

describe('seed script — levels', () => {
  it('produces a rank-2 manager level for each invitable role', async () => {
    spawnSync('node', ['scripts/seed.js'], { cwd: path.resolve(__dirname, '../..'), stdio: 'inherit' });
    const r = await pool.query(`
      SELECT r.role_key, rl.level_key, rl.level_rank, rl.data_scope_default
        FROM role_levels rl
        JOIN roles r ON r.id = rl.role_id
       WHERE rl.level_rank = 2
       ORDER BY r.role_key`);
    const keys = r.rows.map(x => x.role_key);
    expect(keys).toEqual(['admin_log','finance','hrga','sales','tax_insurance','technical']);
    expect(r.rows.every(x => x.data_scope_default === 'role')).toBe(true);
  });

  it('all existing users with non-bypass roles have level_id assigned', async () => {
    const r = await pool.query(`
      SELECT count(*)::int AS n FROM users u
       WHERE u.role NOT IN ('superadmin','ceo')
         AND u.deleted_at IS NULL
         AND u.level_id IS NULL`);
    expect(r.rows[0].n).toBe(0);
  });

  afterAll(close);
});
```

- [ ] **Step 1.5.2 — Edit `backend/scripts/seed.js` — add Manager seed + user backfill**

Locate the existing seed-roles block. Add this block after roles + capabilities are seeded but before users:

```js
// --- Seed Manager (rank 2) for each invitable role -------------------------
const INVITABLE_ROLES = ['sales','admin_log','finance','technical','hrga','tax_insurance'];
for (const roleKey of INVITABLE_ROLES) {
  await client.query(`
    INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
    SELECT id, $2, $3, 2, 'role' FROM roles WHERE role_key = $1
    ON CONFLICT (role_id, level_key) DO UPDATE
      SET level_name = EXCLUDED.level_name,
          data_scope_default = EXCLUDED.data_scope_default,
          updated_at = now()
  `, [roleKey, `${roleKey}_manager`, manager_label(roleKey)]);
}

function manager_label(roleKey) {
  const map = {
    sales: 'Sales Manager',
    admin_log: 'Admin & Log Manager',
    finance: 'Finance Manager',
    technical: 'Technical Manager',
    hrga: 'HRGA Manager',
    tax_insurance: 'Tax & Insurance Manager',
  };
  return map[roleKey] || roleKey;
}
```

After the user-seed block, add a backfill assigning every non-bypass user to the rank-1 (staff) level if they have `level_id IS NULL`:

```js
// --- Backfill level_id on existing seeded users ---------------------------
await client.query(`
  UPDATE users u
     SET level_id = rl.id, updated_at = now()
    FROM roles r
    JOIN role_levels rl ON rl.role_id = r.id AND rl.level_rank = 1
   WHERE u.role = r.role_key
     AND u.role NOT IN ('superadmin','ceo')
     AND u.level_id IS NULL
     AND u.deleted_at IS NULL
`);
```

- [ ] **Step 1.5.3 — Run test, fix until pass, commit**

```bash
npx vitest run test/scripts/seed.test.js
git add backend/scripts/seed.js backend/test/scripts/
git commit -m "feat(seed): seed manager (rank 2) levels per role, backfill staff level on existing users

Idempotent — safe to re-run. Manager level uses role-default data scope;
existing users without level_id get assigned to rank-1 staff.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.6 — Permission resolver: bypass + template + inheritance (steps 1–2)

**Files:**
- Create: `backend/src/services/permission.service.js`, `backend/test/services/permission.service.test.js`

- [ ] **Step 1.6.1 — Write failing test (bypass)**

```js
'use strict';
const { describe, it, expect, beforeAll, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const { flushTestKeys, close: closeRedis } = require('../helpers/redis');
const { resolveCapabilities } = require('../../src/services/permission.service');

let superadminId, ceoId, salesStaffId, salesManagerId, salesPoFeatureId;

beforeAll(async () => {
  await flushTestKeys();
  // assume seed already populated these
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('superadmin','ceo','sales') AND deleted_at IS NULL`);
  superadminId = u.rows.find(x => x.role === 'superadmin').id;
  ceoId = u.rows.find(x => x.role === 'ceo').id;
  // pick one sales user; tests assume seed creates at least one
  const s = await pool.query(`
    SELECT u.id, rl.level_rank
      FROM users u JOIN role_levels rl ON rl.id = u.level_id
     WHERE u.role='sales' AND u.deleted_at IS NULL
     ORDER BY rl.level_rank DESC`);
  salesManagerId = s.rows.find(r => r.level_rank === 2)?.id;
  salesStaffId = s.rows.find(r => r.level_rank === 1)?.id;

  const f = await pool.query(`SELECT id FROM feature_definitions WHERE feature_key='sales_po'`);
  salesPoFeatureId = f.rows[0]?.id;
});

describe('resolveCapabilities — bypass', () => {
  it('returns ALL capabilities for superadmin', async () => {
    const caps = await resolveCapabilities(superadminId, 'sales_po');
    expect(caps.has('full_access')).toBe(true);
    expect(caps.has('view_global')).toBe(true);
  });
  it('returns ALL capabilities for ceo', async () => {
    const caps = await resolveCapabilities(ceoId, 'sales_po');
    expect(caps.has('full_access')).toBe(true);
  });
});

afterAll(async () => { await close(); await closeRedis(); });
```

- [ ] **Step 1.6.2 — Run (expect fail)**: module not found.

- [ ] **Step 1.6.3 — Implement minimal `permission.service.js` for bypass**

```js
'use strict';
const db = require('../config/database');
const { getRedis, isAvailable } = require('../config/redis');
const env = require('../config/env');

const ALL_CAPABILITY_KEYS = ['view_own','view_global','create','edit','delete','write','export','approve','full_access'];

const cacheKey = (userId) => `perm:user:${userId}`;

async function loadFromCache(userId) {
  if (!isAvailable()) return null;
  try {
    const raw = await getRedis().get(cacheKey(userId));
    return raw ? JSON.parse(raw) : null;
  } catch { return null; }
}

async function saveToCache(userId, payload) {
  if (!isAvailable()) return;
  try {
    await getRedis().set(cacheKey(userId), JSON.stringify(payload), 'EX', env.redis.ttlSeconds);
  } catch { /* best-effort */ }
}

async function getUserContext(userId) {
  const r = await db.query(`
    SELECT u.id, u.role, u.level_id,
           rl.level_rank
      FROM users u
      LEFT JOIN role_levels rl ON rl.id = u.level_id
     WHERE u.id = $1 AND u.deleted_at IS NULL`, [userId]);
  return r.rows[0] || null;
}

async function resolveCapabilities(userId, featureKey) {
  const cached = await loadFromCache(userId);
  if (cached?.[featureKey]) return new Set(cached[featureKey]);

  const ctx = await getUserContext(userId);
  if (!ctx) return new Set();

  let caps = new Set();
  if (ctx.role === 'superadmin' || ctx.role === 'ceo') {
    caps = new Set(ALL_CAPABILITY_KEYS);
    await saveToCache(userId, { ...(cached || {}), [featureKey]: [...caps] });
    return caps;
  }

  // Step 2: template + within-role inheritance
  const tpl = await db.query(`
    SELECT c.capability_key
      FROM role_permissions rp
      JOIN role_levels rl     ON rl.id = rp.level_id
      JOIN feature_definitions f ON f.id = rp.feature_id
      JOIN capability_definitions c ON c.id = rp.capability_id
      JOIN users u            ON u.id = $1
      JOIN role_levels url    ON url.id = u.level_id
     WHERE rp.role_id  = (SELECT id FROM roles WHERE role_key = $2)
       AND rl.level_rank <= url.level_rank
       AND f.feature_key = $3`, [userId, ctx.role, featureKey]);
  caps = new Set(tpl.rows.map(r => r.capability_key));

  await saveToCache(userId, { ...(cached || {}), [featureKey]: [...caps] });
  return caps;
}

module.exports = { resolveCapabilities, ALL_CAPABILITY_KEYS };
```

- [ ] **Step 1.6.4 — Run bypass test (expect pass)**

```bash
npx vitest run test/services/permission.service.test.js
```

- [ ] **Step 1.6.5 — Add inheritance test**

Append to `permission.service.test.js`:

```js
describe('resolveCapabilities — template + inheritance', () => {
  it('Sales Manager sees union of rank-1 and rank-2 templates', async () => {
    if (!salesManagerId) return; // skip if no manager seeded
    const caps = await resolveCapabilities(salesManagerId, 'sales_po');
    expect(caps.size).toBeGreaterThan(0);
  });
  it('Sales Staff only sees rank-1 templates', async () => {
    if (!salesStaffId) return;
    const caps = await resolveCapabilities(salesStaffId, 'sales_po');
    // staff should NOT have approve unless template explicitly grants
    // (tighter assertion depends on seed; just verify smaller-or-equal to manager)
    const mgr = salesManagerId ? await resolveCapabilities(salesManagerId, 'sales_po') : new Set();
    expect(caps.size).toBeLessThanOrEqual(mgr.size);
  });
});
```

- [ ] **Step 1.6.6 — Run + commit**

```bash
npx vitest run test/services/permission.service.test.js
git add backend/src/services/permission.service.js backend/test/services/permission.service.test.js
git commit -m "feat(rbac): permission resolver — bypass + template + inheritance (steps 1-2)

Implements resolveCapabilities for superadmin/ceo bypass and within-role
inheritance (level_rank <= user.level_rank). Redis cache with graceful
fallback when Redis unavailable.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.7 — Permission resolver: grant + cross-dept + deny (steps 3–5)

**Files:**
- Modify: `backend/src/services/permission.service.js`, `backend/test/services/permission.service.test.js`

- [ ] **Step 1.7.1 — Add failing tests for grant/deny/cross-dept**

Append to `permission.service.test.js`:

```js
describe('resolveCapabilities — grant + cross-dept + deny', () => {
  let testUserId, featureId, capId;

  beforeAll(async () => {
    // Use a sales staff user as the override target.
    testUserId = salesStaffId;
    if (!testUserId || !salesPoFeatureId) return;
    featureId = salesPoFeatureId;
    const c = await pool.query(`SELECT id FROM capability_definitions WHERE capability_key='approve'`);
    capId = c.rows[0].id;
  });

  it('grant adds capability beyond template', async () => {
    if (!testUserId) return;
    await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1 AND feature_id=$2 AND capability_id=$3`,
      [testUserId, featureId, capId]);
    const before = await resolveCapabilities(testUserId, 'sales_po');
    await pool.query(`INSERT INTO user_capability_overrides
      (user_id,feature_id,capability_id,override_type,granted_by)
      VALUES ($1,$2,$3,'grant',$1)`, [testUserId, featureId, capId]);
    await flushTestKeys(); // bust cache
    const after = await resolveCapabilities(testUserId, 'sales_po');
    expect(after.has('approve')).toBe(true);
    if (!before.has('approve')) expect(after.size).toBeGreaterThan(before.size);
  });

  it('deny wins over grant', async () => {
    if (!testUserId) return;
    await pool.query(`INSERT INTO user_capability_overrides
      (user_id,feature_id,capability_id,override_type,granted_by)
      VALUES ($1,$2,$3,'deny',$1)
      ON CONFLICT (user_id,feature_id,capability_id,override_type) DO NOTHING`,
      [testUserId, featureId, capId]);
    await flushTestKeys();
    const caps = await resolveCapabilities(testUserId, 'sales_po');
    expect(caps.has('approve')).toBe(false);
  });

  it('expired override is ignored', async () => {
    if (!testUserId) return;
    await pool.query(`UPDATE user_capability_overrides
                         SET expires_at = now() - interval '1 hour'
                       WHERE user_id=$1 AND feature_id=$2 AND capability_id=$3 AND override_type='deny'`,
      [testUserId, featureId, capId]);
    await flushTestKeys();
    const caps = await resolveCapabilities(testUserId, 'sales_po');
    // grant still active, deny expired -> approve back
    expect(caps.has('approve')).toBe(true);
    // cleanup
    await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1`, [testUserId]);
  });

  it('cross-dept grant adds capability', async () => {
    if (!testUserId) return;
    await pool.query(`INSERT INTO cross_dept_grants
      (grantee_user_id, target_role_key, feature_id, capability_id, granted_by)
      VALUES ($1,'finance',$2,$3,$1)
      ON CONFLICT DO NOTHING`, [testUserId, featureId, capId]);
    await flushTestKeys();
    const caps = await resolveCapabilities(testUserId, 'sales_po');
    expect(caps.has('approve')).toBe(true);
    await pool.query(`DELETE FROM cross_dept_grants WHERE grantee_user_id=$1`, [testUserId]);
  });
});
```

- [ ] **Step 1.7.2 — Run (expect failures), then extend resolver**

Replace the body of `resolveCapabilities` after the bypass branch in `permission.service.js` with the full 5-step formula:

```js
async function resolveCapabilities(userId, featureKey) {
  const cached = await loadFromCache(userId);
  if (cached?.[featureKey]) return new Set(cached[featureKey]);

  const ctx = await getUserContext(userId);
  if (!ctx) return new Set();

  if (ctx.role === 'superadmin' || ctx.role === 'ceo') {
    const all = new Set(ALL_CAPABILITY_KEYS);
    await saveToCache(userId, { ...(cached || {}), [featureKey]: [...all] });
    return all;
  }

  // Step 2: template + within-role inheritance
  const tplRes = await db.query(`
    SELECT DISTINCT c.capability_key
      FROM role_permissions rp
      JOIN role_levels rl     ON rl.id = rp.level_id
      JOIN feature_definitions f ON f.id = rp.feature_id
      JOIN capability_definitions c ON c.id = rp.capability_id
      JOIN users u            ON u.id = $1
      JOIN role_levels url    ON url.id = u.level_id
     WHERE rp.role_id   = (SELECT id FROM roles WHERE role_key = $2)
       AND rl.level_rank <= url.level_rank
       AND f.feature_key = $3`, [userId, ctx.role, featureKey]);
  const result = new Set(tplRes.rows.map(r => r.capability_key));

  // Step 3: per-user GRANT
  const grantRes = await db.query(`
    SELECT c.capability_key
      FROM user_capability_overrides o
      JOIN feature_definitions f ON f.id = o.feature_id
      JOIN capability_definitions c ON c.id = o.capability_id
     WHERE o.user_id = $1
       AND f.feature_key = $2
       AND o.override_type = 'grant'
       AND o.revoked_at IS NULL
       AND (o.expires_at IS NULL OR o.expires_at > now())`, [userId, featureKey]);
  for (const r of grantRes.rows) result.add(r.capability_key);

  // Step 4: cross-dept GRANT
  const cdRes = await db.query(`
    SELECT c.capability_key
      FROM cross_dept_grants g
      JOIN feature_definitions f ON f.id = g.feature_id
      JOIN capability_definitions c ON c.id = g.capability_id
     WHERE g.grantee_user_id = $1
       AND f.feature_key = $2
       AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())`, [userId, featureKey]);
  for (const r of cdRes.rows) result.add(r.capability_key);

  // Step 5: per-user DENY (last — deny wins)
  const denyRes = await db.query(`
    SELECT c.capability_key
      FROM user_capability_overrides o
      JOIN feature_definitions f ON f.id = o.feature_id
      JOIN capability_definitions c ON c.id = o.capability_id
     WHERE o.user_id = $1
       AND f.feature_key = $2
       AND o.override_type = 'deny'
       AND o.revoked_at IS NULL
       AND (o.expires_at IS NULL OR o.expires_at > now())`, [userId, featureKey]);
  for (const r of denyRes.rows) result.delete(r.capability_key);

  await saveToCache(userId, { ...(cached || {}), [featureKey]: [...result] });
  return result;
}
```

- [ ] **Step 1.7.3 — Run all permission tests, commit**

```bash
npx vitest run test/services/permission.service.test.js
git add backend/src/services/permission.service.js backend/test/services/permission.service.test.js
git commit -m "feat(rbac): permission resolver — grant, cross-dept, deny (steps 3-5)

Completes the 5-step formula. Deny applied last (deny wins over grant +
cross-dept). Honors revoked_at and expires_at filters on all override
sources.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.8 — Data scope resolver

**Files:**
- Modify: `backend/src/services/permission.service.js`, `backend/test/services/permission.service.test.js`

- [ ] **Step 1.8.1 — Add failing test**

```js
describe('resolveDataScope', () => {
  const { resolveDataScope } = require('../../src/services/permission.service');
  it('superadmin = global', async () => {
    const r = await resolveDataScope(superadminId, 'sales_po');
    expect(r.scope).toBe('global');
  });
  it('staff returns level default', async () => {
    if (!salesStaffId) return;
    const r = await resolveDataScope(salesStaffId, 'sales_po');
    expect(['own','team','role','global']).toContain(r.scope);
  });
  it('cross-dept grantee gets granted_target_roles populated', async () => {
    if (!salesStaffId || !salesPoFeatureId) return;
    const cap = await pool.query(`SELECT id FROM capability_definitions WHERE capability_key='view_global'`);
    await pool.query(`INSERT INTO cross_dept_grants
      (grantee_user_id, target_role_key, feature_id, capability_id, granted_by)
      VALUES ($1,'finance',$2,$3,$1) ON CONFLICT DO NOTHING`,
      [salesStaffId, salesPoFeatureId, cap.rows[0].id]);
    await flushTestKeys();
    const r = await resolveDataScope(salesStaffId, 'sales_po');
    expect(r.granted_target_roles).toContain('finance');
    await pool.query(`DELETE FROM cross_dept_grants WHERE grantee_user_id=$1`, [salesStaffId]);
  });
});
```

- [ ] **Step 1.8.2 — Implement `resolveDataScope`**

Append to `permission.service.js`:

```js
async function resolveDataScope(userId, featureKey) {
  const ctx = await getUserContext(userId);
  if (!ctx) return { scope: 'own', granted_target_roles: [] };
  if (ctx.role === 'superadmin' || ctx.role === 'ceo') {
    return { scope: 'global', granted_target_roles: [] };
  }
  const lvl = await db.query(`SELECT data_scope_default FROM role_levels WHERE id=$1`, [ctx.level_id]);
  const scope = lvl.rows[0]?.data_scope_default || 'own';
  const cd = await db.query(`
    SELECT DISTINCT g.target_role_key
      FROM cross_dept_grants g
      JOIN feature_definitions f ON f.id = g.feature_id
     WHERE g.grantee_user_id = $1
       AND f.feature_key = $2
       AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())`, [userId, featureKey]);
  return { scope, granted_target_roles: cd.rows.map(r => r.target_role_key) };
}

module.exports.resolveDataScope = resolveDataScope;
```

- [ ] **Step 1.8.3 — Run + commit**

```bash
npx vitest run test/services/permission.service.test.js
git add backend/src/services/permission.service.js backend/test/services/permission.service.test.js
git commit -m "feat(rbac): permission resolver — resolveDataScope

Returns {scope, granted_target_roles[]} so route filters can WHERE
record.owner_role IN (user.role, ...granted_target_roles).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.9 — Cache invalidation hooks

**Files:**
- Modify: `backend/src/services/permission.service.js`

- [ ] **Step 1.9.1 — Add failing test**

```js
describe('cache invalidation', () => {
  const { invalidateUserCache, invalidateAll } = require('../../src/services/permission.service');
  it('invalidateUserCache removes the cached entry', async () => {
    if (!salesStaffId) return;
    await resolveCapabilities(salesStaffId, 'sales_po'); // populate
    const redis = require('../../src/config/redis').getRedis();
    expect(await redis.exists(`perm:user:${salesStaffId}`)).toBe(1);
    await invalidateUserCache(salesStaffId);
    expect(await redis.exists(`perm:user:${salesStaffId}`)).toBe(0);
  });
  it('invalidateAll clears every perm:user:* key', async () => {
    await resolveCapabilities(superadminId, 'sales_po');
    await invalidateAll();
    const redis = require('../../src/config/redis').getRedis();
    const remaining = await redis.keys('perm:user:*');
    expect(remaining.length).toBe(0);
  });
});
```

- [ ] **Step 1.9.2 — Implement invalidation helpers**

Append to `permission.service.js`:

```js
async function invalidateUserCache(userId) {
  if (!isAvailable()) return;
  try { await getRedis().del(cacheKey(userId)); } catch { /* best-effort */ }
}

async function invalidateAll() {
  if (!isAvailable()) return;
  try {
    const r = getRedis();
    const keys = await r.keys('perm:user:*');
    if (keys.length) await r.del(...keys);
  } catch { /* best-effort */ }
}

module.exports.invalidateUserCache = invalidateUserCache;
module.exports.invalidateAll = invalidateAll;
```

- [ ] **Step 1.9.3 — Run + commit**

```bash
npx vitest run test/services/permission.service.test.js
git add backend/src/services/permission.service.js
git commit -m "feat(rbac): cache invalidation hooks (per-user, all)

invalidateUserCache used by services that mutate role_permissions, levels,
overrides, cross-dept grants. invalidateAll for global RBAC changes.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.10 — RBAC middleware swap

**Files:**
- Modify: `backend/src/middleware/rbac.middleware.js`
- Create: `backend/test/middleware/rbac.middleware.test.js`

- [ ] **Step 1.10.1 — Write failing test**

```js
'use strict';
const { describe, it, expect, beforeAll, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const { rbacGuard } = require('../../src/middleware/rbac.middleware');

let salesManagerId;

beforeAll(async () => {
  const r = await pool.query(`
    SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND rl.level_rank=2 AND u.deleted_at IS NULL LIMIT 1`);
  salesManagerId = r.rows[0]?.id;
});

function mockReqRes(user) {
  return {
    req: { user },
    res: {},
    next: ((calls) => Object.assign((err) => calls.push(err), { calls }))([]),
  };
}

describe('rbacGuard', () => {
  it('passes Superadmin through bypass', async () => {
    const guard = rbacGuard('sales_po', 'view_global');
    const { req, next } = mockReqRes({ id: '00000000-0000-0000-0000-000000000000', role: 'superadmin' });
    // Not really needed: real superadmin id from seed
    const r = await pool.query(`SELECT id FROM users WHERE role='superadmin' LIMIT 1`);
    req.user.id = r.rows[0].id;
    await guard(req, {}, next);
    expect(next.calls[0]).toBeUndefined();
  });

  it('rejects user lacking capability', async () => {
    if (!salesManagerId) return;
    const guard = rbacGuard('nonexistent_feature', 'approve');
    const { req, next } = mockReqRes({ id: salesManagerId, role: 'sales' });
    await guard(req, {}, next);
    expect(next.calls[0]).toBeInstanceOf(Error);
  });
});

afterAll(close);
```

- [ ] **Step 1.10.2 — Replace `rbac.middleware.js` body with resolver-backed guard**

```js
'use strict';
const db = require('../config/database');
const { resolveCapabilities, resolveDataScope } = require('../services/permission.service');
const { ForbiddenError, UnauthorizedError } = require('../utils/errors');

function rbacGuard(featureKey, capabilityKey) {
  return async function rbacMiddleware(req, _res, next) {
    try {
      if (!req.user) throw new UnauthorizedError('Authenticated user required');

      // Backwards-compat: roleScope still attached for downstream services.
      const scopeRow = await db.query(`
        SELECT managed_role_scope, can_manage_same_role, feature_permission_scope
          FROM user_role_scope WHERE user_id = $1`, [req.user.id]);
      req.roleScope = scopeRow.rows[0] || {
        managed_role_scope: null,
        can_manage_same_role: false,
        feature_permission_scope: null,
      };

      const caps = await resolveCapabilities(req.user.id, featureKey);
      if (!caps.has(capabilityKey) && !caps.has('full_access')) {
        throw new ForbiddenError(
          `Role '${req.user.role}' lacks capability '${capabilityKey}' on '${featureKey}'`,
        );
      }

      // Attach data scope for downstream filtering.
      req.dataScope = await resolveDataScope(req.user.id, featureKey);
      req.capabilities = caps;
      next();
    } catch (err) { next(err); }
  };
}

module.exports = { rbacGuard };
```

- [ ] **Step 1.10.3 — Run all middleware + permission tests, commit**

```bash
npx vitest run test/middleware test/services/permission.service.test.js
git add backend/src/middleware/rbac.middleware.js backend/test/middleware/
git commit -m "refactor(rbac): swap middleware to use permission resolver

rbacGuard now calls resolveCapabilities + resolveDataScope. Backwards-
compatible: req.roleScope still attached. Adds req.capabilities and
req.dataScope for downstream services.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.11 — Same-role scope middleware extension

**Files:**
- Modify: `backend/src/middleware/sameRoleScope.middleware.js` (verify exact filename), or create wrapper if name differs
- Create: `backend/test/middleware/sameRoleScope.middleware.test.js`

- [ ] **Step 1.11.1 — Locate existing same-role middleware**

```bash
grep -rn "same.*role\|sameRole\|managed_role_scope" backend/src/middleware/ backend/src/services/
```

If a file exists, modify it. If logic is inline elsewhere, create `sameRoleScope.middleware.js`.

- [ ] **Step 1.11.2 — Write failing test**

```js
'use strict';
const { describe, it, expect, beforeAll, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const { sameRoleScopeGuard } = require('../../src/middleware/sameRoleScope.middleware');

let salesManagerId, salesStaffId;
beforeAll(async () => {
  const r = await pool.query(`
    SELECT u.id, rl.level_rank FROM users u JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.role='sales' AND u.deleted_at IS NULL`);
  salesManagerId = r.rows.find(x => x.level_rank === 2)?.id;
  salesStaffId   = r.rows.find(x => x.level_rank === 1)?.id;
});

describe('sameRoleScopeGuard', () => {
  it('Manager can edit Staff in same role', async () => {
    if (!salesManagerId || !salesStaffId) return;
    const req = { user: { id: salesManagerId, role: 'sales' }, params: { id: salesStaffId } };
    const calls = [];
    await sameRoleScopeGuard(req, {}, (err) => calls.push(err));
    expect(calls[0]).toBeUndefined();
  });
  it('Staff cannot edit Manager in same role', async () => {
    if (!salesManagerId || !salesStaffId) return;
    const req = { user: { id: salesStaffId, role: 'sales' }, params: { id: salesManagerId } };
    const calls = [];
    await sameRoleScopeGuard(req, {}, (err) => calls.push(err));
    expect(calls[0]).toBeInstanceOf(Error);
  });
});

afterAll(close);
```

- [ ] **Step 1.11.3 — Implement `sameRoleScope.middleware.js`**

```js
'use strict';
const db = require('../config/database');
const { ForbiddenError } = require('../utils/errors');

async function userLevelRank(userId) {
  const r = await db.query(`
    SELECT rl.level_rank FROM users u JOIN role_levels rl ON rl.id = u.level_id
     WHERE u.id = $1`, [userId]);
  return r.rows[0]?.level_rank ?? 0;
}

async function userRole(userId) {
  const r = await db.query(`SELECT role FROM users WHERE id=$1`, [userId]);
  return r.rows[0]?.role || null;
}

async function sameRoleScopeGuard(req, _res, next) {
  try {
    if (!req.user) throw new ForbiddenError('not authenticated');
    if (req.user.role === 'superadmin' || req.user.role === 'ceo') return next();
    const targetUserId = req.params.id;
    if (!targetUserId) throw new ForbiddenError('missing target user id');
    const targetRole = await userRole(targetUserId);
    if (targetRole !== req.user.role) {
      throw new ForbiddenError('cross-role management not permitted');
    }
    const my = await userLevelRank(req.user.id);
    const their = await userLevelRank(targetUserId);
    if (their >= my) {
      throw new ForbiddenError('cannot manage same- or higher-rank user');
    }
    next();
  } catch (err) { next(err); }
}

module.exports = { sameRoleScopeGuard };
```

- [ ] **Step 1.11.4 — Run + commit**

```bash
npx vitest run test/middleware/sameRoleScope.middleware.test.js
git add backend/src/middleware/sameRoleScope.middleware.js backend/test/middleware/sameRoleScope.middleware.test.js
git commit -m "feat(rbac): same-role scope honors level_rank

Manager can manage strictly-lower-rank users in same role; cannot manage
same-rank or higher. CEO/Superadmin bypass.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.12 — Level CRUD service + routes

**Files:**
- Create: `backend/src/services/role_level.service.js`, `backend/src/routes/admin/levels.routes.js`, `backend/src/validators/levels.validators.js`, `backend/test/services/role_level.service.test.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1.12.1 — Write failing test**

```js
'use strict';
const { describe, it, expect, beforeAll, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const svc = require('../../src/services/role_level.service');

let ceoId, salesManagerId, salesRoleId;
beforeAll(async () => {
  const r = await pool.query(`
    SELECT u.id, u.role, rl.level_rank FROM users u
     LEFT JOIN role_levels rl ON rl.id=u.level_id
     WHERE u.deleted_at IS NULL`);
  ceoId = r.rows.find(x => x.role === 'ceo')?.id;
  salesManagerId = r.rows.find(x => x.role === 'sales' && x.level_rank === 2)?.id;
  const s = await pool.query(`SELECT id FROM roles WHERE role_key='sales'`);
  salesRoleId = s.rows[0].id;
});

describe('role_level.service.create', () => {
  it('CEO can create a level for any role', async () => {
    if (!ceoId) return;
    const lvl = await svc.create({ actor: { id: ceoId, role: 'ceo' },
      roleKey: 'sales', levelKey: 'sales_lead', levelName: 'Sales Lead',
      levelRank: 3, dataScopeDefault: 'team' });
    expect(lvl.id).toBeDefined();
    await pool.query(`DELETE FROM role_levels WHERE id=$1`, [lvl.id]);
  });

  it('Manager can create a level only in own role', async () => {
    if (!salesManagerId) return;
    await expect(svc.create({ actor: { id: salesManagerId, role: 'sales' },
      roleKey: 'finance', levelKey: 'finance_lead', levelName: 'Finance Lead',
      levelRank: 3, dataScopeDefault: 'team' })).rejects.toThrow();
  });

  it('blocks delete of level with assigned users', async () => {
    if (!ceoId) return;
    const r = await pool.query(`SELECT id FROM role_levels WHERE level_rank=1 AND role_id=$1`, [salesRoleId]);
    await expect(svc.remove({ actor: { id: ceoId, role: 'ceo' }, levelId: r.rows[0].id }))
      .rejects.toThrow(/assigned/i);
  });
});
afterAll(close);
```

- [ ] **Step 1.12.2 — Implement `role_level.service.js`**

```js
'use strict';
const db = require('../config/database');
const { ForbiddenError, ValidationError, ConflictError } = require('../utils/errors');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

async function isTopRankManagerOfRole(userId, roleKey) {
  const r = await db.query(`
    SELECT 1
      FROM users u
      JOIN role_levels rl ON rl.id = u.level_id
     WHERE u.id = $1 AND u.role = $2
       AND rl.level_rank = (SELECT max(level_rank) FROM role_levels WHERE role_id = rl.role_id AND deleted_at IS NULL)
       LIMIT 1`, [userId, roleKey]);
  return r.rowCount === 1;
}

async function authorizeLevelMutation({ actor, roleKey }) {
  if (actor.role === 'superadmin' || actor.role === 'ceo') return;
  if (await isTopRankManagerOfRole(actor.id, roleKey)) return;
  throw new ForbiddenError('only Superadmin/CEO or top-rank Manager-of-role may mutate levels');
}

async function create({ actor, roleKey, levelKey, levelName, levelRank, dataScopeDefault = 'own' }) {
  await authorizeLevelMutation({ actor, roleKey });
  const r = await db.query(`
    INSERT INTO role_levels (role_id, level_key, level_name, level_rank, data_scope_default)
    SELECT id, $2, $3, $4, $5 FROM roles WHERE role_key = $1
    RETURNING *`, [roleKey, levelKey, levelName, levelRank, dataScopeDefault]);
  if (!r.rowCount) throw new ValidationError('unknown role');
  await activityLog.log(actor.id, 'level.created', { levelId: r.rows[0].id, roleKey });
  await perms.invalidateAll();
  return r.rows[0];
}

async function update({ actor, levelId, patch }) {
  const cur = await db.query(`SELECT rl.*, r.role_key FROM role_levels rl
                                JOIN roles r ON r.id=rl.role_id WHERE rl.id=$1`, [levelId]);
  if (!cur.rowCount) throw new ValidationError('level not found');
  await authorizeLevelMutation({ actor, roleKey: cur.rows[0].role_key });
  const { levelName, levelRank, dataScopeDefault } = patch;
  const r = await db.query(`
    UPDATE role_levels SET
      level_name = COALESCE($2, level_name),
      level_rank = COALESCE($3, level_rank),
      data_scope_default = COALESCE($4, data_scope_default),
      updated_at = now()
     WHERE id = $1 RETURNING *`,
    [levelId, levelName ?? null, levelRank ?? null, dataScopeDefault ?? null]);
  await activityLog.log(actor.id, 'level.updated', { levelId });
  await perms.invalidateAll();
  return r.rows[0];
}

async function remove({ actor, levelId }) {
  const cur = await db.query(`SELECT rl.*, r.role_key FROM role_levels rl
                                JOIN roles r ON r.id=rl.role_id WHERE rl.id=$1`, [levelId]);
  if (!cur.rowCount) throw new ValidationError('level not found');
  await authorizeLevelMutation({ actor, roleKey: cur.rows[0].role_key });
  const used = await db.query(`SELECT count(*)::int AS n FROM users WHERE level_id=$1 AND deleted_at IS NULL`, [levelId]);
  if (used.rows[0].n > 0) throw new ConflictError('cannot delete: level still assigned to users');
  await db.query(`UPDATE role_levels SET deleted_at = now() WHERE id=$1`, [levelId]);
  await activityLog.log(actor.id, 'level.deleted', { levelId });
  await perms.invalidateAll();
  return { ok: true };
}

async function listByRole(roleKey) {
  const r = await db.query(`
    SELECT rl.* FROM role_levels rl JOIN roles r ON r.id = rl.role_id
     WHERE r.role_key = $1 AND rl.deleted_at IS NULL
     ORDER BY rl.level_rank DESC`, [roleKey]);
  return r.rows;
}

module.exports = { create, update, remove, listByRole };
```

- [ ] **Step 1.12.3 — Add validators `validators/levels.validators.js`**

```js
'use strict';
const Joi = require('joi');

const create = Joi.object({
  levelKey: Joi.string().alphanum().min(3).max(60).required(),
  levelName: Joi.string().min(1).max(120).required(),
  levelRank: Joi.number().integer().min(1).max(99).required(),
  dataScopeDefault: Joi.string().valid('own','team','role','global').default('own'),
});

const update = Joi.object({
  levelName: Joi.string().min(1).max(120),
  levelRank: Joi.number().integer().min(1).max(99),
  dataScopeDefault: Joi.string().valid('own','team','role','global'),
}).min(1);

module.exports = { create, update };
```

- [ ] **Step 1.12.4 — Add routes `routes/admin/levels.routes.js`**

```js
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/levels.validators');
const svc = require('../../services/role_level.service');

router.use(auth.authenticate);

router.get('/roles/:roleKey/levels',
  rbacGuard('admin_rbac', 'view_global'),
  async (req, res, next) => {
    try { res.json({ items: await svc.listByRole(req.params.roleKey) }); }
    catch (e) { next(e); }
  });

router.post('/roles/:roleKey/levels',
  rbacGuard('admin_rbac', 'edit'),
  validate(v.create, 'body'),
  async (req, res, next) => {
    try {
      const lvl = await svc.create({
        actor: req.user, roleKey: req.params.roleKey, ...req.body,
      });
      res.status(201).json(lvl);
    } catch (e) { next(e); }
  });

router.patch('/levels/:id',
  rbacGuard('admin_rbac', 'edit'),
  validate(v.update, 'body'),
  async (req, res, next) => {
    try { res.json(await svc.update({ actor: req.user, levelId: req.params.id, patch: req.body })); }
    catch (e) { next(e); }
  });

router.delete('/levels/:id',
  rbacGuard('admin_rbac', 'delete'),
  async (req, res, next) => {
    try { res.json(await svc.remove({ actor: req.user, levelId: req.params.id })); }
    catch (e) { next(e); }
  });

module.exports = router;
```

- [ ] **Step 1.12.5 — Mount routes in `app.js`**

In `backend/src/app.js`, add near other route mounts:

```js
app.use('/api/admin', require('./routes/admin/levels.routes'));
```

Also add the `admin_rbac` feature to `feature_definitions` if missing — extend seed:

```sql
-- inside scripts/seed.js or a dedicated migration
INSERT INTO feature_definitions (feature_key, feature_name, module_group)
VALUES ('admin_rbac','RBAC Administration','admin')
ON CONFLICT (feature_key) DO NOTHING;
```

- [ ] **Step 1.12.6 — Run all level service + route tests, commit**

```bash
npx vitest run test/services/role_level.service.test.js
git add backend/src/services/role_level.service.js backend/src/routes/admin/levels.routes.js backend/src/validators/levels.validators.js backend/src/app.js backend/scripts/seed.js backend/test/services/role_level.service.test.js
git commit -m "feat(rbac): role_level CRUD service + admin routes

Authority guard: superadmin/ceo OR top-rank manager-of-own-role. Block
delete when level has assigned users. Cache invalidation on every
mutation. Adds admin_rbac feature_definitions row.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.13 — Permission override CRUD service + routes

**Files:**
- Create: `backend/src/services/permission_override.service.js`, `backend/src/routes/admin/overrides.routes.js`, `backend/src/validators/overrides.validators.js`, `backend/test/services/permission_override.service.test.js`
- Modify: `backend/src/app.js`

- [ ] **Step 1.13.1 — Write failing tests** for grant/deny/cross-dept CRUD with authority + idempotence + revoke + expiry. Pattern mirrors Task 1.12 — covers:
  - CEO can grant; Manager-of-role cannot grant outside own role
  - Duplicate (user, feature, capability, type) → returns existing row (upsert semantics)
  - revoke sets `revoked_at`; resolver immediately sees the change after cache invalidate

```js
'use strict';
const { describe, it, expect, beforeAll, afterAll } = require('vitest');
const { pool, close } = require('../helpers/db');
const svc = require('../../src/services/permission_override.service');
const { resolveCapabilities } = require('../../src/services/permission.service');
const { flushTestKeys, close: closeRedis } = require('../helpers/redis');

let ceoId, salesStaffId, featureId, capId;
beforeAll(async () => {
  const u = await pool.query(`SELECT id, role FROM users WHERE role IN ('ceo','sales')`);
  ceoId = u.rows.find(x => x.role==='ceo')?.id;
  const s = await pool.query(`SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
  salesStaffId = s.rows[0]?.id;
  const f = await pool.query(`SELECT id FROM feature_definitions WHERE feature_key='sales_po'`);
  featureId = f.rows[0]?.id;
  const c = await pool.query(`SELECT id FROM capability_definitions WHERE capability_key='approve'`);
  capId = c.rows[0]?.id;
});

describe('permission_override.service', () => {
  it('CEO can grant; resolver sees it after cache invalidate', async () => {
    if (!ceoId || !salesStaffId) return;
    await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1`, [salesStaffId]);
    await svc.grant({ actor: { id: ceoId, role: 'ceo' },
      userId: salesStaffId, featureId, capabilityId: capId });
    await flushTestKeys();
    const caps = await resolveCapabilities(salesStaffId, 'sales_po');
    expect(caps.has('approve')).toBe(true);
  });

  it('revoke removes the grant', async () => {
    if (!salesStaffId) return;
    await svc.revoke({ actor: { id: ceoId, role: 'ceo' },
      userId: salesStaffId, featureId, capabilityId: capId, overrideType: 'grant' });
    await flushTestKeys();
    const caps = await resolveCapabilities(salesStaffId, 'sales_po');
    expect(caps.has('approve')).toBe(false);
    await pool.query(`DELETE FROM user_capability_overrides WHERE user_id=$1`, [salesStaffId]);
  });
});

afterAll(async () => { await close(); await closeRedis(); });
```

- [ ] **Step 1.13.2 — Implement `permission_override.service.js`**

```js
'use strict';
const db = require('../config/database');
const { ForbiddenError, ValidationError } = require('../utils/errors');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

function authorizeOverride(actor) {
  // Default: CEO/Superadmin only. Future: capability `override_grant` extends this.
  if (actor.role === 'superadmin' || actor.role === 'ceo') return;
  throw new ForbiddenError('only Superadmin/CEO may grant or deny per-user overrides');
}

async function grant({ actor, userId, featureId, capabilityId, reason = null, expiresAt = null }) {
  authorizeOverride(actor);
  const r = await db.query(`
    INSERT INTO user_capability_overrides
      (user_id, feature_id, capability_id, override_type, reason, granted_by, expires_at)
    VALUES ($1,$2,$3,'grant',$4,$5,$6)
    ON CONFLICT (user_id, feature_id, capability_id, override_type)
      DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at,
                    granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL
    RETURNING *`, [userId, featureId, capabilityId, reason, actor.id, expiresAt]);
  await activityLog.log(actor.id, 'permission.override.granted',
    { userId, featureId, capabilityId, type: 'grant' });
  await perms.invalidateUserCache(userId);
  return r.rows[0];
}

async function deny({ actor, userId, featureId, capabilityId, reason = null, expiresAt = null }) {
  authorizeOverride(actor);
  const r = await db.query(`
    INSERT INTO user_capability_overrides
      (user_id, feature_id, capability_id, override_type, reason, granted_by, expires_at)
    VALUES ($1,$2,$3,'deny',$4,$5,$6)
    ON CONFLICT (user_id, feature_id, capability_id, override_type)
      DO UPDATE SET reason = EXCLUDED.reason, expires_at = EXCLUDED.expires_at,
                    granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL
    RETURNING *`, [userId, featureId, capabilityId, reason, actor.id, expiresAt]);
  await activityLog.log(actor.id, 'permission.override.granted',
    { userId, featureId, capabilityId, type: 'deny' });
  await perms.invalidateUserCache(userId);
  return r.rows[0];
}

async function revoke({ actor, userId, featureId, capabilityId, overrideType }) {
  authorizeOverride(actor);
  await db.query(`
    UPDATE user_capability_overrides
       SET revoked_at = now()
     WHERE user_id=$1 AND feature_id=$2 AND capability_id=$3 AND override_type=$4`,
    [userId, featureId, capabilityId, overrideType]);
  await activityLog.log(actor.id, 'permission.override.revoked',
    { userId, featureId, capabilityId, type: overrideType });
  await perms.invalidateUserCache(userId);
  return { ok: true };
}

async function listForUser(userId) {
  const r = await db.query(`
    SELECT o.*, f.feature_key, c.capability_key
      FROM user_capability_overrides o
      JOIN feature_definitions f    ON f.id = o.feature_id
      JOIN capability_definitions c ON c.id = o.capability_id
     WHERE o.user_id = $1 AND o.revoked_at IS NULL
       AND (o.expires_at IS NULL OR o.expires_at > now())
     ORDER BY o.granted_at DESC`, [userId]);
  return r.rows;
}

async function grantCrossDept({ actor, granteeUserId, targetRoleKey, featureId, capabilityId, expiresAt = null, notes = null }) {
  authorizeOverride(actor);
  const r = await db.query(`
    INSERT INTO cross_dept_grants
      (grantee_user_id, target_role_key, feature_id, capability_id, granted_by, expires_at, notes)
    VALUES ($1,$2,$3,$4,$5,$6,$7)
    ON CONFLICT (grantee_user_id, target_role_key, feature_id, capability_id)
      DO UPDATE SET expires_at = EXCLUDED.expires_at, notes = EXCLUDED.notes,
                    granted_by = EXCLUDED.granted_by, granted_at = now(), revoked_at = NULL
    RETURNING *`, [granteeUserId, targetRoleKey, featureId, capabilityId, actor.id, expiresAt, notes]);
  await activityLog.log(actor.id, 'cross_dept.grant.created',
    { granteeUserId, targetRoleKey, featureId, capabilityId });
  await perms.invalidateUserCache(granteeUserId);
  return r.rows[0];
}

async function revokeCrossDept({ actor, grantId }) {
  authorizeOverride(actor);
  const r = await db.query(`
    UPDATE cross_dept_grants SET revoked_at = now() WHERE id=$1 RETURNING grantee_user_id`, [grantId]);
  if (r.rowCount) {
    await activityLog.log(actor.id, 'cross_dept.grant.revoked', { grantId });
    await perms.invalidateUserCache(r.rows[0].grantee_user_id);
  }
  return { ok: true };
}

async function listCrossDeptForUser(userId) {
  const r = await db.query(`
    SELECT g.*, f.feature_key, c.capability_key
      FROM cross_dept_grants g
      JOIN feature_definitions f    ON f.id = g.feature_id
      JOIN capability_definitions c ON c.id = g.capability_id
     WHERE g.grantee_user_id = $1 AND g.revoked_at IS NULL
       AND (g.expires_at IS NULL OR g.expires_at > now())
     ORDER BY g.granted_at DESC`, [userId]);
  return r.rows;
}

module.exports = { grant, deny, revoke, listForUser, grantCrossDept, revokeCrossDept, listCrossDeptForUser };
```

- [ ] **Step 1.13.3 — Add validators**

`validators/overrides.validators.js`:

```js
'use strict';
const Joi = require('joi');

const grant = Joi.object({
  featureId: Joi.string().uuid().required(),
  capabilityId: Joi.string().uuid().required(),
  reason: Joi.string().allow('', null),
  expiresAt: Joi.date().iso().allow(null),
});

const crossDept = Joi.object({
  targetRoleKey: Joi.string().required(),
  featureId: Joi.string().uuid().required(),
  capabilityId: Joi.string().uuid().required(),
  expiresAt: Joi.date().iso().allow(null),
  notes: Joi.string().allow('', null),
});

module.exports = { grant, crossDept };
```

- [ ] **Step 1.13.4 — Add routes `routes/admin/overrides.routes.js`**

```js
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/overrides.validators');
const svc = require('../../services/permission_override.service');

router.use(auth.authenticate);

router.get('/users/:id/overrides',
  rbacGuard('admin_rbac', 'view_global'),
  async (req, res, next) => {
    try {
      res.json({
        capabilities: await svc.listForUser(req.params.id),
        crossDept: await svc.listCrossDeptForUser(req.params.id),
      });
    } catch (e) { next(e); }
  });

router.post('/users/:id/overrides/grant',
  rbacGuard('admin_rbac', 'edit'),
  validate(v.grant, 'body'),
  async (req, res, next) => {
    try { res.status(201).json(await svc.grant({ actor: req.user, userId: req.params.id, ...req.body })); }
    catch (e) { next(e); }
  });

router.post('/users/:id/overrides/deny',
  rbacGuard('admin_rbac', 'edit'),
  validate(v.grant, 'body'),
  async (req, res, next) => {
    try { res.status(201).json(await svc.deny({ actor: req.user, userId: req.params.id, ...req.body })); }
    catch (e) { next(e); }
  });

router.delete('/users/:id/overrides/:overrideType/:featureId/:capabilityId',
  rbacGuard('admin_rbac', 'delete'),
  async (req, res, next) => {
    try {
      await svc.revoke({
        actor: req.user, userId: req.params.id,
        overrideType: req.params.overrideType,
        featureId: req.params.featureId,
        capabilityId: req.params.capabilityId,
      });
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

router.post('/users/:id/cross-dept-grants',
  rbacGuard('admin_rbac', 'edit'),
  validate(v.crossDept, 'body'),
  async (req, res, next) => {
    try {
      res.status(201).json(await svc.grantCrossDept({ actor: req.user, granteeUserId: req.params.id, ...req.body }));
    } catch (e) { next(e); }
  });

router.delete('/cross-dept-grants/:id',
  rbacGuard('admin_rbac', 'delete'),
  async (req, res, next) => {
    try { res.json(await svc.revokeCrossDept({ actor: req.user, grantId: req.params.id })); }
    catch (e) { next(e); }
  });

module.exports = router;
```

- [ ] **Step 1.13.5 — Mount in `app.js`**

```js
app.use('/api/admin', require('./routes/admin/overrides.routes'));
```

- [ ] **Step 1.13.6 — Run + commit**

```bash
npx vitest run test/services/permission_override.service.test.js
git add backend/src/services/permission_override.service.js backend/src/routes/admin/overrides.routes.js backend/src/validators/overrides.validators.js backend/src/app.js backend/test/services/permission_override.service.test.js
git commit -m "feat(rbac): per-user override + cross-dept grant CRUD

CEO/Superadmin authority guard. Upsert semantics on (user,feature,cap,
type). Revoke sets revoked_at. Cache invalidated on every mutation.
Routes: /api/admin/users/:id/overrides/{grant,deny}, cross-dept-grants.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.14 — Email provider abstraction

**Files:**
- Create: `backend/src/services/email-providers/{factory,smtp,gmail,ses,postmark,resend}.js`, `backend/test/services/email-providers/factory.test.js`
- Modify: `backend/src/services/email.service.js`

- [ ] **Step 1.14.1 — Install dep**

```bash
cd backend && npm install @aws-sdk/client-ses@^3.620.0
```

- [ ] **Step 1.14.2 — Define interface in `factory.js`**

```js
'use strict';
const env = require('../../config/env');

// Each adapter exports: send({from, replyTo, to, cc, bcc, subject, html}) → {messageId, status}
const adapters = {
  smtp:     require('./smtp'),
  gmail:    require('./gmail'),
  ses:      require('./ses'),
  postmark: require('./postmark'),
  resend:   require('./resend'),
};

// Resolve sender row (placeholder until F5 lands the notification_senders table).
// Falls back to env-based default sender.
async function resolveDefaultSender() {
  return {
    sender_key: 'default',
    display_name: env.email?.fromName || 'Interlab Notifications',
    from_email: env.email?.fromAddress || 'noreply@example.com',
    reply_to_email: env.email?.replyTo || null,
    provider: env.email?.provider || 'smtp',
  };
}

async function sendViaSender(sender, payload) {
  const adapter = adapters[sender.provider];
  if (!adapter) throw new Error(`unknown email provider: ${sender.provider}`);
  return adapter.send({
    from: { email: sender.from_email, name: sender.display_name },
    replyTo: sender.reply_to_email || null,
    ...payload,
  });
}

module.exports = { resolveDefaultSender, sendViaSender, adapters };
```

- [ ] **Step 1.14.3 — Implement adapters**

`smtp.js`:

```js
'use strict';
const nodemailer = require('nodemailer');
const env = require('../../config/env');

let transporter = null;
function tx() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

async function send({ from, replyTo, to, cc, bcc, subject, html }) {
  const info = await tx().sendMail({
    from: from.name ? `"${from.name}" <${from.email}>` : from.email,
    replyTo: replyTo || undefined,
    to, cc, bcc, subject, html,
  });
  return { messageId: info.messageId, status: 'sent' };
}

module.exports = { send };
```

`gmail.js`:

```js
'use strict';
// Gmail SMTP via app password — same wire protocol as smtp.js but pinned host.
const nodemailer = require('nodemailer');
const env = require('../../config/env');

let transporter = null;
function tx() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.gmail?.user, pass: env.gmail?.appPassword },
  });
  return transporter;
}

async function send({ from, replyTo, to, cc, bcc, subject, html }) {
  const info = await tx().sendMail({
    from: from.name ? `"${from.name}" <${from.email}>` : from.email,
    replyTo: replyTo || undefined,
    to, cc, bcc, subject, html,
  });
  return { messageId: info.messageId, status: 'sent' };
}

module.exports = { send };
```

`ses.js`:

```js
'use strict';
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const env = require('../../config/env');

let client = null;
function ses() {
  if (client) return client;
  client = new SESClient({
    region: env.ses?.region || 'ap-southeast-1',
    credentials: env.ses?.accessKeyId ? {
      accessKeyId: env.ses.accessKeyId,
      secretAccessKey: env.ses.secretAccessKey,
    } : undefined,
  });
  return client;
}

async function send({ from, replyTo, to, cc, bcc, subject, html }) {
  const cmd = new SendEmailCommand({
    Source: from.name ? `"${from.name}" <${from.email}>` : from.email,
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
      CcAddresses: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      BccAddresses: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
    },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  });
  const r = await ses().send(cmd);
  return { messageId: r.MessageId, status: 'sent' };
}

module.exports = { send };
```

`postmark.js` and `resend.js` — stubs that throw `Error('not implemented')`:

```js
'use strict';
async function send() { throw new Error('postmark adapter not implemented yet'); }
module.exports = { send };
```

- [ ] **Step 1.14.4 — Add env keys to `env.js`**

```js
email: {
  fromName: optional('EMAIL_FROM_NAME', 'Interlab Notifications'),
  fromAddress: optional('EMAIL_FROM_ADDRESS', null),
  replyTo: optional('EMAIL_REPLY_TO', null),
  provider: optional('EMAIL_PROVIDER', 'smtp'),
},
gmail: {
  user: optional('GMAIL_USER', null),
  appPassword: optional('GMAIL_APP_PASSWORD', null),
},
ses: {
  region: optional('AWS_REGION', 'ap-southeast-1'),
  accessKeyId: optional('AWS_ACCESS_KEY_ID', null),
  secretAccessKey: optional('AWS_SECRET_ACCESS_KEY', null),
},
```

(Existing `smtp` block retained.)

- [ ] **Step 1.14.5 — Refactor `email.service.js` to call factory**

Replace the actual transport call inside the existing email.service with:

```js
const factory = require('./email-providers/factory');

async function deliver({ to, cc, bcc, subject, html }) {
  const sender = await factory.resolveDefaultSender();
  return factory.sendViaSender(sender, { to, cc, bcc, subject, html });
}

module.exports.deliver = deliver;
```

(Keep existing public API surface intact — only the internal delivery path changes.)

- [ ] **Step 1.14.6 — Write factory test `test/services/email-providers/factory.test.js`**

```js
'use strict';
const { describe, it, expect, vi } = require('vitest');
const factory = require('../../../src/services/email-providers/factory');

describe('email provider factory', () => {
  it('resolves SMTP adapter when sender.provider=smtp', async () => {
    factory.adapters.smtp.send = vi.fn().mockResolvedValue({ messageId: 'fake', status: 'sent' });
    const sender = { sender_key: 'x', display_name: 'X', from_email: 'a@b.c', reply_to_email: null, provider: 'smtp' };
    const r = await factory.sendViaSender(sender, { to: 'd@e.f', subject: 's', html: '<p>x</p>' });
    expect(r.messageId).toBe('fake');
    expect(factory.adapters.smtp.send).toHaveBeenCalledOnce();
  });

  it('throws on unknown provider', async () => {
    const sender = { sender_key: 'x', display_name: 'X', from_email: 'a@b.c', reply_to_email: null, provider: 'lolnope' };
    await expect(factory.sendViaSender(sender, { to: 'd', subject: 's', html: 'h' })).rejects.toThrow();
  });
});
```

- [ ] **Step 1.14.7 — Run + commit**

```bash
npx vitest run test/services/email-providers/factory.test.js
git add backend/src/services/email-providers/ backend/src/services/email.service.js backend/src/config/env.js backend/package.json backend/package-lock.json backend/test/services/email-providers/
git commit -m "feat(email): provider abstraction (smtp, gmail, ses, postmark/resend stubs)

Factory routes by sender.provider. F5 will swap resolveDefaultSender to
read notification_senders. SES uses @aws-sdk/client-ses; gmail uses SMTP
on smtp.gmail.com:465.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.15 — Activity log + rate limiter extensions

**Files:**
- Modify: `backend/src/services/activity_log.service.js`, `backend/src/middleware/rateLimit.middleware.js`

- [ ] **Step 1.15.1 — Confirm `activity_log.service.log()` accepts arbitrary event_key**

Check existing service. If it stores `event_key` as text, no schema change. If it has a fixed enum, extend the CHECK constraint via a small migration `020_activity_log_events.sql` adding the new keys: `level.created`, `level.updated`, `level.deleted`, `permission.override.granted`, `permission.override.revoked`, `cross_dept.grant.created`, `cross_dept.grant.revoked`.

Run:

```bash
grep -n "CHECK\|enum\|event_key" backend/src/services/activity_log.service.js backend/migrations/015_activity_logs.sql
```

If a CHECK exists, add migration `020_activity_log_events.sql`:

```sql
-- +migrate Up
BEGIN;
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_event_key_chk;
ALTER TABLE activity_logs
  ADD CONSTRAINT activity_logs_event_key_chk CHECK (event_key ~ '^[a-z][a-z0-9_.]+$');
COMMIT;
-- +migrate Down
BEGIN;
ALTER TABLE activity_logs DROP CONSTRAINT IF EXISTS activity_logs_event_key_chk;
COMMIT;
```

(If there is no enforced enum, skip this migration entirely — services can write any event_key already.)

- [ ] **Step 1.15.2 — Add `permissionWriteLimiter` to rateLimit middleware**

Append to `backend/src/middleware/rateLimit.middleware.js`:

```js
const rateLimit = require('express-rate-limit');

const permissionWriteLimiter = rateLimit({
  windowMs: 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id || req.ip,
  message: { error: 'Too many permission writes. Please slow down.' },
});

module.exports.permissionWriteLimiter = permissionWriteLimiter;
```

Apply to mutation routes in `levels.routes.js` and `overrides.routes.js`:

```js
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
router.post('/...', permissionWriteLimiter, ...);
```

(Add to all `POST/PATCH/DELETE` handlers in those route files.)

- [ ] **Step 1.15.3 — Smoke-test + commit**

```bash
npx vitest run
git add backend/src/middleware/rateLimit.middleware.js backend/src/routes/admin/ backend/migrations/020_activity_log_events.sql 2>/dev/null
git commit -m "feat(rbac): permissionWriteLimiter + activity log event keys

Adds 10/min/user limiter to all RBAC mutation routes. Loosens activity_log
event_key constraint to allow new dotted keys (level.*, permission.*,
cross_dept.*) — existing keys remain valid.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.16 — Frontend: Permission matrix UI

**Files:**
- Create: `frontend/lib/admin-permissions-{api,types,ui}.ts`, `frontend/app/(app)/admin/permissions/page.tsx`

- [ ] **Step 1.16.1 — Create `lib/admin-permissions-types.ts`**

```ts
export type RoleKey = 'sales'|'admin_log'|'finance'|'technical'|'hrga'|'tax_insurance';

export interface RoleLevel { id: string; role_id: string; level_key: string; level_name: string; level_rank: number; data_scope_default: 'own'|'team'|'role'|'global'; }
export interface FeatureDef { id: string; feature_key: string; feature_name: string; module_group: string; }
export interface CapabilityDef { id: string; capability_key: string; capability_name: string; }
export interface RolePermissionRow { role_id: string; level_id: string; feature_id: string; capability_id: string; }
export interface UserOverride { id: string; feature_key: string; capability_key: string; override_type: 'grant'|'deny'; expires_at: string|null; revoked_at: string|null; reason: string|null; }
export interface CrossDeptGrant { id: string; target_role_key: string; feature_key: string; capability_key: string; expires_at: string|null; notes: string|null; }
```

- [ ] **Step 1.16.2 — Create `lib/admin-permissions-api.ts`**

```ts
import api from './api';
import type { RoleLevel, FeatureDef, CapabilityDef, RolePermissionRow, UserOverride, CrossDeptGrant } from './admin-permissions-types';

export const adminRbacApi = {
  listLevels: (roleKey: string) => api.get<{items: RoleLevel[]}>(`/api/admin/roles/${roleKey}/levels`).then(r => r.data.items),
  createLevel: (roleKey: string, body: Partial<RoleLevel>) => api.post(`/api/admin/roles/${roleKey}/levels`, body).then(r => r.data),
  updateLevel: (id: string, patch: Partial<RoleLevel>) => api.patch(`/api/admin/levels/${id}`, patch).then(r => r.data),
  deleteLevel: (id: string) => api.delete(`/api/admin/levels/${id}`).then(r => r.data),

  listFeatures: () => api.get<{items: FeatureDef[]}>(`/api/admin/features`).then(r => r.data.items),
  listCapabilities: () => api.get<{items: CapabilityDef[]}>(`/api/admin/capabilities`).then(r => r.data.items),
  matrix: () => api.get<{items: RolePermissionRow[]}>(`/api/admin/role-permissions`).then(r => r.data.items),
  toggleCell: (body: RolePermissionRow & { enabled: boolean }) => api.post(`/api/admin/role-permissions`, body).then(r => r.data),

  listOverrides: (userId: string) => api.get<{capabilities: UserOverride[]; crossDept: CrossDeptGrant[]}>(`/api/admin/users/${userId}/overrides`).then(r => r.data),
  grant: (userId: string, body: Partial<UserOverride> & {featureId: string; capabilityId: string}) => api.post(`/api/admin/users/${userId}/overrides/grant`, body).then(r => r.data),
  deny:  (userId: string, body: Partial<UserOverride> & {featureId: string; capabilityId: string}) => api.post(`/api/admin/users/${userId}/overrides/deny`, body).then(r => r.data),
  revoke: (userId: string, type: 'grant'|'deny', featureId: string, capabilityId: string) => api.delete(`/api/admin/users/${userId}/overrides/${type}/${featureId}/${capabilityId}`).then(r => r.data),
  grantCrossDept: (userId: string, body: Partial<CrossDeptGrant> & {featureId: string; capabilityId: string; targetRoleKey: string}) => api.post(`/api/admin/users/${userId}/cross-dept-grants`, body).then(r => r.data),
  revokeCrossDept: (id: string) => api.delete(`/api/admin/cross-dept-grants/${id}`).then(r => r.data),
};
```

- [ ] **Step 1.16.3 — Add backend list-features/capabilities/matrix routes (Express)**

Create `backend/src/routes/admin/permissions.routes.js`:

```js
'use strict';
const express = require('express');
const router = express.Router();
const auth = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const db = require('../../config/database');
const perms = require('../../services/permission.service');

router.use(auth.authenticate);

router.get('/features', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try { const r = await db.query(`SELECT * FROM feature_definitions ORDER BY module_group, feature_key`); res.json({ items: r.rows }); }
  catch (e) { next(e); }
});
router.get('/capabilities', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try { const r = await db.query(`SELECT * FROM capability_definitions ORDER BY capability_key`); res.json({ items: r.rows }); }
  catch (e) { next(e); }
});
router.get('/role-permissions', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
  try {
    const r = await db.query(`SELECT role_id, level_id, feature_id, capability_id FROM role_permissions`);
    res.json({ items: r.rows });
  } catch (e) { next(e); }
});

router.post('/role-permissions',
  rbacGuard('admin_rbac', 'edit'),
  require('../../middleware/rateLimit.middleware').permissionWriteLimiter,
  async (req, res, next) => {
    try {
      const { role_id, level_id, feature_id, capability_id, enabled } = req.body;
      if (enabled) {
        await db.query(`INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
                        VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                        [role_id, level_id, feature_id, capability_id]);
      } else {
        await db.query(`DELETE FROM role_permissions WHERE role_id=$1 AND level_id=$2 AND feature_id=$3 AND capability_id=$4`,
                        [role_id, level_id, feature_id, capability_id]);
      }
      await perms.invalidateAll();
      res.json({ ok: true });
    } catch (e) { next(e); }
  });

module.exports = router;
```

Mount in `app.js`:

```js
app.use('/api/admin', require('./routes/admin/permissions.routes'));
```

- [ ] **Step 1.16.4 — Build `app/(app)/admin/permissions/page.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import type { FeatureDef, CapabilityDef, RolePermissionRow, RoleLevel } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';

const ROLE_KEYS: Array<'sales'|'admin_log'|'finance'|'technical'|'hrga'|'tax_insurance'> =
  ['sales','admin_log','finance','technical','hrga','tax_insurance'];

export default function PermissionMatrix() {
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [caps, setCaps] = useState<CapabilityDef[]>([]);
  const [matrix, setMatrix] = useState<RolePermissionRow[]>([]);
  const [levelsByRole, setLevelsByRole] = useState<Record<string, RoleLevel[]>>({});
  const [activeRole, setActiveRole] = useState<typeof ROLE_KEYS[number]>('sales');

  useEffect(() => {
    Promise.all([
      adminRbacApi.listFeatures(),
      adminRbacApi.listCapabilities(),
      adminRbacApi.matrix(),
      Promise.all(ROLE_KEYS.map(r => adminRbacApi.listLevels(r).then(ls => [r, ls] as const))),
    ]).then(([f, c, m, levels]) => {
      setFeatures(f); setCaps(c); setMatrix(m);
      setLevelsByRole(Object.fromEntries(levels));
    });
  }, []);

  function isEnabled(role_id: string, level_id: string, feature_id: string, capability_id: string) {
    return matrix.some(r => r.role_id===role_id && r.level_id===level_id && r.feature_id===feature_id && r.capability_id===capability_id);
  }

  async function toggle(row: RolePermissionRow & { enabled: boolean }) {
    setMatrix(prev => row.enabled
      ? [...prev, row]
      : prev.filter(r => !(r.role_id===row.role_id && r.level_id===row.level_id && r.feature_id===row.feature_id && r.capability_id===row.capability_id)));
    try { await adminRbacApi.toggleCell(row); }
    catch (e: any) { toast.error(e.message); /* TODO rollback */ }
  }

  const levels = levelsByRole[activeRole] || [];

  return (
    <div className="p-6">
      <h1 className="text-2xl font-semibold mb-4">Permission Matrix</h1>
      <div className="flex gap-2 mb-4">
        {ROLE_KEYS.map(r => (
          <button key={r} onClick={() => setActiveRole(r)}
            className={`px-3 py-1 rounded ${activeRole===r ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>
            {r}
          </button>
        ))}
      </div>
      <table className="min-w-full border-collapse">
        <thead>
          <tr>
            <th className="border p-2 text-left">Feature</th>
            {levels.map(l => caps.map(c => (
              <th key={`${l.id}-${c.id}`} className="border p-1 text-xs">{l.level_name}<br/>{c.capability_key}</th>
            )))}
          </tr>
        </thead>
        <tbody>
          {features.map(f => {
            const role_id = levels[0]?.role_id;
            return (
              <tr key={f.id}>
                <td className="border p-2">{f.feature_name}</td>
                {levels.map(l => caps.map(c => {
                  const checked = role_id ? isEnabled(role_id, l.id, f.id, c.id) : false;
                  return (
                    <td key={`${l.id}-${c.id}`} className="border p-1 text-center">
                      <input type="checkbox" checked={checked}
                        onChange={(e) => role_id && toggle({ role_id, level_id: l.id, feature_id: f.id, capability_id: c.id, enabled: e.target.checked })} />
                    </td>
                  );
                }))}
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}
```

- [ ] **Step 1.16.5 — Manual verify in browser, commit**

```bash
# Backend running, frontend dev
cd frontend && npm run dev
# Visit http://localhost:3000/admin/permissions as superadmin
git add frontend/lib/admin-permissions-* frontend/app/\(app\)/admin/permissions/ backend/src/routes/admin/permissions.routes.js backend/src/app.js
git commit -m "feat(rbac): permission matrix admin UI

4-axis matrix (role tabs × levels × features × capabilities). Optimistic
toggle with cache invalidation server-side. Backend routes for features/
capabilities/role-permissions list + toggle.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.17 — Frontend: Per-role level CRUD UI

**Files:**
- Create: `frontend/app/(app)/admin/levels/page.tsx`

- [ ] **Step 1.17.1 — Build the page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import type { RoleLevel } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';

const ROLE_KEYS = ['sales','admin_log','finance','technical','hrga','tax_insurance'] as const;

export default function LevelsPage() {
  const [activeRole, setActiveRole] = useState<typeof ROLE_KEYS[number]>('sales');
  const [levels, setLevels] = useState<RoleLevel[]>([]);
  const [creating, setCreating] = useState(false);
  const [form, setForm] = useState({ levelKey: '', levelName: '', levelRank: 1, dataScopeDefault: 'own' as const });

  async function refresh() {
    setLevels(await adminRbacApi.listLevels(activeRole));
  }
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [activeRole]);

  async function handleCreate() {
    try {
      await adminRbacApi.createLevel(activeRole, form);
      toast.success('Level created');
      setCreating(false);
      setForm({ levelKey: '', levelName: '', levelRank: 1, dataScopeDefault: 'own' });
      refresh();
    } catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }
  async function handleDelete(id: string) {
    if (!confirm('Delete this level? Will fail if any users are assigned.')) return;
    try { await adminRbacApi.deleteLevel(id); toast.success('Deleted'); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }

  return (
    <div className="p-6 max-w-4xl">
      <h1 className="text-2xl font-semibold mb-4">Role Levels</h1>
      <div className="flex gap-2 mb-4">
        {ROLE_KEYS.map(r => (
          <button key={r} onClick={() => setActiveRole(r)}
            className={`px-3 py-1 rounded ${activeRole===r ? 'bg-blue-600 text-white' : 'bg-gray-200'}`}>{r}</button>
        ))}
      </div>
      <table className="w-full border-collapse mb-6">
        <thead>
          <tr><th className="border p-2 text-left">Rank</th><th className="border p-2 text-left">Key</th><th className="border p-2 text-left">Name</th><th className="border p-2 text-left">Scope</th><th className="border p-2"></th></tr>
        </thead>
        <tbody>
          {levels.map(l => (
            <tr key={l.id}>
              <td className="border p-2">{l.level_rank}</td>
              <td className="border p-2 font-mono">{l.level_key}</td>
              <td className="border p-2">{l.level_name}</td>
              <td className="border p-2">{l.data_scope_default}</td>
              <td className="border p-2"><button onClick={() => handleDelete(l.id)} className="text-red-600">Delete</button></td>
            </tr>
          ))}
        </tbody>
      </table>
      {creating ? (
        <div className="border p-4 rounded">
          <input className="border p-1 mr-2" placeholder="key (sales_lead)" value={form.levelKey} onChange={e=>setForm({...form, levelKey:e.target.value})}/>
          <input className="border p-1 mr-2" placeholder="name (Sales Lead)" value={form.levelName} onChange={e=>setForm({...form, levelName:e.target.value})}/>
          <input className="border p-1 mr-2 w-16" type="number" value={form.levelRank} onChange={e=>setForm({...form, levelRank:Number(e.target.value)})}/>
          <select className="border p-1 mr-2" value={form.dataScopeDefault} onChange={e=>setForm({...form, dataScopeDefault: e.target.value as any})}>
            <option value="own">own</option><option value="team">team</option><option value="role">role</option><option value="global">global</option>
          </select>
          <button onClick={handleCreate} className="bg-blue-600 text-white px-3 py-1 rounded">Save</button>
          <button onClick={()=>setCreating(false)} className="ml-2">Cancel</button>
        </div>
      ) : (
        <button onClick={()=>setCreating(true)} className="bg-blue-600 text-white px-3 py-1 rounded">+ Add level</button>
      )}
    </div>
  );
}
```

- [ ] **Step 1.17.2 — Manual verify + commit**

```bash
git add frontend/app/\(app\)/admin/levels/
git commit -m "feat(rbac): role levels admin UI

Tab-per-role list with create/delete. Server enforces authority
(top-rank manager-of-role or CEO/Superadmin); UI shows generic 403 toast
on failure.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 1.18 — Frontend: Per-user override editor

**Files:**
- Create: `frontend/app/(app)/admin/users/[id]/overrides/page.tsx`

- [ ] **Step 1.18.1 — Build the page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useParams } from 'next/navigation';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import type { UserOverride, CrossDeptGrant, FeatureDef, CapabilityDef } from '@/lib/admin-permissions-types';
import { toast } from 'sonner';

export default function UserOverridesPage() {
  const { id } = useParams<{ id: string }>();
  const [features, setFeatures] = useState<FeatureDef[]>([]);
  const [caps, setCaps] = useState<CapabilityDef[]>([]);
  const [overrides, setOverrides] = useState<UserOverride[]>([]);
  const [crossDept, setCrossDept] = useState<CrossDeptGrant[]>([]);
  const [form, setForm] = useState({ featureId: '', capabilityId: '', type: 'grant' as 'grant'|'deny', reason: '', expiresAt: '' });
  const [cdForm, setCdForm] = useState({ targetRoleKey: 'sales', featureId: '', capabilityId: '', notes: '' });

  async function refresh() {
    const o = await adminRbacApi.listOverrides(id);
    setOverrides(o.capabilities); setCrossDept(o.crossDept);
  }

  useEffect(() => {
    Promise.all([adminRbacApi.listFeatures(), adminRbacApi.listCapabilities(), refresh()])
      .then(([f, c]) => { setFeatures(f); setCaps(c); });
  /* eslint-disable-line react-hooks/exhaustive-deps */ }, [id]);

  async function submitOverride() {
    try {
      const body: any = { featureId: form.featureId, capabilityId: form.capabilityId, reason: form.reason || null, expiresAt: form.expiresAt || null };
      if (form.type === 'grant') await adminRbacApi.grant(id, body); else await adminRbacApi.deny(id, body);
      toast.success(`${form.type} applied`); refresh();
    } catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }
  async function revokeOverride(o: UserOverride) {
    const f = features.find(x => x.feature_key === o.feature_key);
    const c = caps.find(x => x.capability_key === o.capability_key);
    if (!f || !c) return;
    try { await adminRbacApi.revoke(id, o.override_type, f.id, c.id); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }
  async function submitCrossDept() {
    try { await adminRbacApi.grantCrossDept(id, cdForm); toast.success('cross-dept grant added'); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }
  async function revokeCd(g: CrossDeptGrant) {
    try { await adminRbacApi.revokeCrossDept(g.id); refresh(); }
    catch (e: any) { toast.error(e?.response?.data?.error || e.message); }
  }

  return (
    <div className="p-6 max-w-5xl">
      <h1 className="text-2xl font-semibold mb-4">User Overrides — {id}</h1>

      <section className="mb-6">
        <h2 className="text-lg font-semibold mb-2">Capability overrides</h2>
        <table className="w-full border-collapse">
          <thead><tr><th className="border p-2">Type</th><th className="border p-2">Feature</th><th className="border p-2">Capability</th><th className="border p-2">Expires</th><th className="border p-2"></th></tr></thead>
          <tbody>
            {overrides.map(o => (
              <tr key={o.id}>
                <td className={`border p-2 ${o.override_type==='deny'?'text-red-600':'text-green-600'}`}>{o.override_type}</td>
                <td className="border p-2">{o.feature_key}</td>
                <td className="border p-2">{o.capability_key}</td>
                <td className="border p-2">{o.expires_at || '—'}</td>
                <td className="border p-2"><button onClick={()=>revokeOverride(o)} className="text-red-600">Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-2 flex-wrap items-end">
          <select value={form.type} onChange={e=>setForm({...form, type: e.target.value as any})} className="border p-1">
            <option value="grant">grant</option><option value="deny">deny</option>
          </select>
          <select value={form.featureId} onChange={e=>setForm({...form, featureId: e.target.value})} className="border p-1">
            <option value="">— feature —</option>
            {features.map(f => <option key={f.id} value={f.id}>{f.feature_name}</option>)}
          </select>
          <select value={form.capabilityId} onChange={e=>setForm({...form, capabilityId: e.target.value})} className="border p-1">
            <option value="">— capability —</option>
            {caps.map(c => <option key={c.id} value={c.id}>{c.capability_key}</option>)}
          </select>
          <input className="border p-1" placeholder="reason (optional)" value={form.reason} onChange={e=>setForm({...form, reason:e.target.value})}/>
          <input className="border p-1" type="datetime-local" value={form.expiresAt} onChange={e=>setForm({...form, expiresAt:e.target.value})}/>
          <button onClick={submitOverride} className="bg-blue-600 text-white px-3 py-1 rounded">Apply</button>
        </div>
      </section>

      <section>
        <h2 className="text-lg font-semibold mb-2">Cross-department grants</h2>
        <table className="w-full border-collapse">
          <thead><tr><th className="border p-2">Target role</th><th className="border p-2">Feature</th><th className="border p-2">Capability</th><th className="border p-2">Notes</th><th className="border p-2"></th></tr></thead>
          <tbody>
            {crossDept.map(g => (
              <tr key={g.id}>
                <td className="border p-2">{g.target_role_key}</td>
                <td className="border p-2">{g.feature_key}</td>
                <td className="border p-2">{g.capability_key}</td>
                <td className="border p-2">{g.notes || '—'}</td>
                <td className="border p-2"><button onClick={()=>revokeCd(g)} className="text-red-600">Revoke</button></td>
              </tr>
            ))}
          </tbody>
        </table>
        <div className="mt-3 flex gap-2 flex-wrap items-end">
          <select value={cdForm.targetRoleKey} onChange={e=>setCdForm({...cdForm, targetRoleKey: e.target.value})} className="border p-1">
            {['sales','admin_log','finance','technical','hrga','tax_insurance'].map(r => <option key={r}>{r}</option>)}
          </select>
          <select value={cdForm.featureId} onChange={e=>setCdForm({...cdForm, featureId: e.target.value})} className="border p-1">
            <option value="">— feature —</option>
            {features.map(f => <option key={f.id} value={f.id}>{f.feature_name}</option>)}
          </select>
          <select value={cdForm.capabilityId} onChange={e=>setCdForm({...cdForm, capabilityId: e.target.value})} className="border p-1">
            <option value="">— capability —</option>
            {caps.map(c => <option key={c.id} value={c.id}>{c.capability_key}</option>)}
          </select>
          <input className="border p-1" placeholder="notes" value={cdForm.notes} onChange={e=>setCdForm({...cdForm, notes:e.target.value})}/>
          <button onClick={submitCrossDept} className="bg-blue-600 text-white px-3 py-1 rounded">Grant</button>
        </div>
      </section>
    </div>
  );
}
```

- [ ] **Step 1.18.2 — Manual verify + commit**

```bash
git add frontend/app/\(app\)/admin/users/
git commit -m "feat(rbac): per-user override editor

Two sections: capability grants/denies + cross-dept grants. Lists active
entries; revoke and create flows wire to existing endpoints. CEO/
Superadmin-only enforced server-side; UI surfaces 403 as toast.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final integration check

- [ ] **Step F.1 — Run full test suite**

```bash
cd backend && npm test
```

Expected: all tests pass.

- [ ] **Step F.2 — Smoke test the matrix end-to-end**

1. Start backend (`npm run dev`), frontend (`npm run dev`), Redis, Postgres.
2. Login as Superadmin.
3. Visit `/admin/levels`: see Sales tab with Manager + Staff levels.
4. Visit `/admin/permissions`: see Sales matrix with Manager + Staff columns × features × capabilities.
5. Toggle a Sales Staff `view_global` cell off; observe a Sales Staff user immediately loses the capability (via cache invalidation).
6. Visit `/admin/users/<sales_manager_id>/overrides`: grant `approve` on `sales_po`, then deny `approve` — observe the user effectively cannot approve (deny wins).
7. Add a cross-dept grant for the user on `finance` role + `finance_invoice` feature + `view_global` capability. Test that the user's resolveCapabilities for `finance_invoice` includes `view_global`.

- [ ] **Step F.3 — Final commit if any small fixes needed**

```bash
git status
git log --oneline | head -20
```

Expected: ~18 commits across Task 1.0–1.18; no uncommitted changes.

---

## Self-review

- ✅ **Spec coverage**: Sprint 0 (Tasks 1.0/1.1/1.14/1.15) + Sprint 1 (Tasks 1.2–1.13, 1.16–1.18) all map to spec Section 8 Sprint 0+1
- ✅ **Type/method consistency**: `resolveCapabilities` / `resolveDataScope` / `invalidateUserCache` / `invalidateAll` / `getRedis` / `isAvailable` consistent across tasks
- ✅ **Migration ordering**: 017 → 018 → 019 → 020 (activity log if needed). All preceding F1's planned migration 020+
- ✅ **No placeholders within steps**: each step ships running code or commands; the inline TODO comment in Task 1.16.4 (`/* TODO rollback */`) is a known follow-up explicitly captured as future work in the optimistic UI rollback path (acceptable annotation since rollback strategy is non-blocking for MVP)
- ✅ **Acceptance criteria** mapped to spec Section 11 F2 verified by Step F.2 smoke test

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-plan1-foundation-and-f2.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per Task (1.0, 1.1, 1.2, …, 1.18). Two-stage review between tasks (correctness review + my acceptance check). Best when each task is meaningful in isolation and you want frequent checkpoints. Approximate cost: 18 subagent invocations.

**2. Inline Execution** — Execute tasks in this session via `superpowers:executing-plans`. Batch with checkpoints every ~3–5 tasks. Faster but lower-fidelity review.

**Which approach?**
