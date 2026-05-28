# Sub-1 — Foundation: Accounts & Permissions — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Remap the 8 seed accounts to real emails with manager levels and per-role passwords, add a `backup_password_hash` recovery mechanism (+ admin reset endpoint), align the invite route so managers can invite their own role, and wire `.env` for local-dev→staging — all additively, reusing the existing RBAC / invite / 2FA machinery.

**Architecture:** Backend is Node/Express with raw `pg` + numbered SQL migrations (runner `scripts/migrate.js`, markers `-- +migrate Up/Down`). RBAC lives in the DB (`roles`/`role_levels`/`role_permissions`/`feature_definitions`/`capability_definitions`); superadmin/CEO bypass via `full_access`. "Manager" = a user whose `level_id` points to the role's rank-2 level. The invite flow (`invitation.service.js`) already generates + returns an initial password once; we extend `accept` to copy its hash into the new `users.backup_password_hash`. Tests run on vitest against a derived `crmdemo_test` database (see `test/setup.js`).

**Tech Stack:** Node 20, Express, `pg`, bcryptjs (seed) + argon2id (runtime), vitest + supertest, Next.js 14 (frontend gate), MinIO, JWT.

**Spec:** `docs/superpowers/specs/2026-05-26-sub1-accounts-permissions-design.md`

**Working dir for all paths below:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo` (commits land in the `interlab-infra` repo). Backend commands run from `backend/`.

---

## File Structure (created / modified)

**Created:**
- `backend/migrations/030_backup_password.sql` — adds `users.backup_password_hash`.
- `backend/test/migrations/030_backup_password.test.js` — migration column test.
- `backend/test/scripts/seed.accounts.test.js` — seed remap + manager-level + backup-hash + advance_stage-trim assertions.
- `backend/test/services/invitation.backup.test.js` — accept copies `initial_password_hash` → `backup_password_hash`; manager invite scoping.
- `backend/test/services/auth.resetToBackup.test.js` — reset-to-backup service behavior.
- `backend/src/routes/admin/reset-to-backup.routes.js` — `POST /api/admin/reset-to-backup`.
- `backend/src/validators/reset.validators.js` — Joi schema for the reset body.

**Modified:**
- `backend/scripts/seed.js` — USERS remap, per-role `SEED_PW_*`, `backup_password_hash`, division→manager level, `reset_user_password` capability, advance_stage trim (incl. explicit revoke), 
- `backend/src/services/invitation.service.js` — `accept` user INSERT adds `backup_password_hash`.
- `backend/src/services/auth.service.js` — add `resetToBackup()`; export it; ensure `ValidationError` imported.
- `backend/src/routes/admin/invitations.routes.js` — create-route guard `edit` → `invite_user`.
- `backend/src/app.js` — mount the reset-to-backup route.
- `.env.example` (repo root) — staging block.
- `frontend/app/(app)/admin/invitations/page.tsx` + `frontend/app/(app)/admin/invitations/new/page.tsx` — soft 2FA gate on the invite action.

---

## Task 0: Prerequisites (environment + databases)

These are operator/setup steps, not code. They make the dev DB and the test DB usable. The
SSH tunnel and admin DB creation are run by the user (interactively) — suggest typing them with
the `!` prefix in this session so output is captured.

- [ ] **Step 1: Bring up the Tailscale SSH tunnel** (keep running in a separate shell)

```bash
ssh -p 2223 zaky@100.117.214.25 -L 5440:127.0.0.1:5440 -N
```

Expected: no output; local `127.0.0.1:5440` now forwards to postgres-global. Verify with
`psql "postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/interlab_db_staging" -c '\conninfo'`.

- [ ] **Step 2: Fill `.env`** (gitignored) at repo root with real values — at minimum
`DATABASE_URL=postgresql://interlab_staging01:<pw>@127.0.0.1:5440/interlab_db_staging`,
`DB_PASSWORD`, the `MINIO_*` block, `TWO_FACTOR_ENCRYPTION_KEY` (64 hex), and the eight
`SEED_PW_*`. (Task 8 adds the documented shape to `.env.example`; you can mirror it now.)

- [ ] **Step 3: Apply migrations + seed the dev DB**

Run from `backend/`:
```bash
node scripts/migrate.js && node scripts/seed.js
```
Expected: migrate prints applied migrations (up to `029`); seed prints `[seed] done`.

- [ ] **Step 4: Create + migrate the test DB** (`crmdemo_test`, same instance — see `test/setup.js`)

The test harness rewrites `DATABASE_URL`'s dbname to `crmdemo_test`. Create it once via the admin
login, then migrate it:
```bash
psql "postgresql://supabase_admin:<superuser_pw>@127.0.0.1:5440/postgres" \
  -c "CREATE DATABASE crmdemo_test OWNER interlab_staging01;"
DATABASE_URL="postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/crmdemo_test" \
  node scripts/migrate.js
```
Expected: `CREATE DATABASE`, then migrations apply up to `029`. (Migration `030` is added in Task 1.)

- [ ] **Step 5: Confirm the suite runs green before changes**

```bash
cd backend && npm test
```
Expected: existing suite passes. If `crmdemo_test` is missing or unmigrated, tests fail fast with a
connection/relation error — fix Step 4 before continuing.

---

## Task 1: Migration 030 — `users.backup_password_hash`

**Files:**
- Create: `backend/migrations/030_backup_password.sql`
- Test: `backend/test/migrations/030_backup_password.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { pool } = require('../helpers/db');

describe('migration 030 backup password', () => {
  it('users has a nullable text backup_password_hash column', async () => {
    const r = await pool.query(`
      SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name = 'users' AND column_name = 'backup_password_hash'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toBe('text');
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- test/migrations/030_backup_password.test.js`
Expected: FAIL — `expected 0 to be 1` (column does not exist yet).

- [ ] **Step 3: Write the migration**

`backend/migrations/030_backup_password.sql`:
```sql
-- ============================================================================
-- Migration 030: backup (recovery) password hash on users
--
-- users.backup_password_hash holds a hash of the user's recovery/default
-- password. Set at seed time (= the seed password) and copied from the
-- invitation's initial_password_hash on accept. Superadmin "reset to backup"
-- copies this into password_hash. Plaintext is never stored.
--
-- Spec: docs/superpowers/specs/2026-05-26-sub1-accounts-permissions-design.md §3
-- ============================================================================

-- +migrate Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_password_hash text NULL;

-- +migrate Down
ALTER TABLE users DROP COLUMN IF EXISTS backup_password_hash;
```

- [ ] **Step 4: Apply the migration to BOTH dev and test DBs**

Run from `backend/`:
```bash
node scripts/migrate.js
DATABASE_URL="postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/crmdemo_test" node scripts/migrate.js
```
Expected: both print that `030_backup_password.sql` was applied.

- [ ] **Step 5: Run the test to verify it passes**

Run: `cd backend && npm test -- test/migrations/030_backup_password.test.js`
Expected: PASS.

- [ ] **Step 6: Commit**

```bash
git add backend/migrations/030_backup_password.sql backend/test/migrations/030_backup_password.test.js
git commit -m "feat(sub-1): add users.backup_password_hash (migration 030)"
```

---

## Task 2: Seeder — remap 8 accounts, per-role passwords, backup hash, manager levels

**Files:**
- Modify: `backend/scripts/seed.js`
- Test: `backend/test/scripts/seed.accounts.test.js`

- [ ] **Step 1: Write the failing test**

```javascript
'use strict';
const { pool } = require('../helpers/db');
const { spawnSync } = require('node:child_process');
const path = require('node:path');

function runSeed() {
  const r = spawnSync('node', ['scripts/seed.js'], {
    cwd: path.resolve(__dirname, '../..'), stdio: 'pipe', env: process.env,
  });
  if (r.status !== 0) {
    throw new Error(`seed exited ${r.status}: ${r.stderr?.toString() || r.stdout?.toString()}`);
  }
}

const EXPECTED = {
  'zakyindrasatriaputra@gmail.com': 'superadmin',
  'zakyindrasatriap@gmail.com': 'ceo',
  'putra.zakyindras@gmail.com': 'sales',
  'adminlog@issi-interlab.com': 'admin_log',
  'zaky.putra@integrity-indonesia.com': 'finance',
  'pancaaindrawati@gmail.com': 'technical',
  'pancaindrawati27@gmail.com': 'hrga',
  'pancaindrawati2704@gmail.com': 'tax_insurance',
};
const EMAILS = Object.keys(EXPECTED);

describe('seed — account remap', () => {
  beforeAll(() => runSeed());

  it('seeds the 8 real accounts with correct roles', async () => {
    const r = await pool.query(`SELECT email, role FROM users WHERE email = ANY($1)`, [EMAILS]);
    expect(Object.fromEntries(r.rows.map((x) => [x.email, x.role]))).toEqual(EXPECTED);
  });

  it('division accounts are managers (rank-2); superadmin/ceo have no level', async () => {
    const r = await pool.query(`
      SELECT u.email, rl.level_rank
        FROM users u LEFT JOIN role_levels rl ON rl.id = u.level_id
       WHERE u.email = ANY($1)`, [EMAILS]);
    const byEmail = Object.fromEntries(r.rows.map((x) => [x.email, x.level_rank]));
    expect(byEmail['zakyindrasatriaputra@gmail.com']).toBeNull();
    expect(byEmail['zakyindrasatriap@gmail.com']).toBeNull();
    expect(byEmail['putra.zakyindras@gmail.com']).toBe(2);
    expect(byEmail['pancaindrawati2704@gmail.com']).toBe(2);
  });

  it('every seeded account has a backup_password_hash', async () => {
    const r = await pool.query(
      `SELECT count(*)::int AS n FROM users WHERE email = ANY($1) AND backup_password_hash IS NOT NULL`,
      [EMAILS]);
    expect(r.rows[0].n).toBe(8);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- test/scripts/seed.accounts.test.js`
Expected: FAIL — old emails / NULL backup hashes (the remap isn't in `seed.js` yet).

- [ ] **Step 3: Replace the `USERS` array and add the env mapping**

In `backend/scripts/seed.js`, replace the existing `USERS` constant (currently lines ~102-111)
with:
```javascript
// Role → SEED_PW_* env var (operator-set per-role passwords; fallback DEMO_PASSWORD).
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
```

- [ ] **Step 4: Replace the user upsert loop to use per-role passwords + backup hash**

Replace the existing Users insert block (currently lines ~278-293, the
`const hash = await bcrypt.hash(DEMO_PASSWORD, 10);` loop) with:
```javascript
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
```

- [ ] **Step 5: Add the manager-level assignment AFTER the existing rank-1 backfill**

Immediately after the existing backfill block (the `UPDATE users u SET level_id = rl.id ... rl.level_rank = 1 ...`
at ~lines 297-307), add:
```javascript
    // Seeded division accounts are department MANAGERS → upgrade to rank-2 level
    // (the generic backfill above set them to rank-1; this overrides for the 6).
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
```

- [ ] **Step 6: Re-seed and run the test**

Run from `backend/`:
```bash
DATABASE_URL="postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/crmdemo_test" node scripts/seed.js
npm test -- test/scripts/seed.accounts.test.js
```
Expected: PASS.

- [ ] **Step 7: Fix any test that hard-codes the old demo emails**

Run: `cd backend && grep -rn "@interlab-portal.com" test/`
For each hit that asserts a specific old email (e.g. `ceo@interlab-portal.com`), update it to look
up by `role` instead (e.g. `SELECT id FROM users WHERE role='ceo' LIMIT 1`). Then run the full
suite to confirm no regression: `npm test`. Expected: PASS.

- [ ] **Step 8: Commit**

```bash
git add backend/scripts/seed.js backend/test/scripts/seed.accounts.test.js backend/test/
git commit -m "feat(sub-1): remap 8 seed accounts (real emails, manager levels, backup hash, SEED_PW_*)"
```

---

## Task 3: Trim `advance_stage` from hrga & tax (read-only PO context)

**Files:**
- Modify: `backend/scripts/seed.js`
- Test: add to `backend/test/scripts/seed.accounts.test.js`

- [ ] **Step 1: Add the failing test** (append inside the existing `describe` in `seed.accounts.test.js`)

```javascript
  it('hrga and tax do NOT have advance_stage on sales_po; the four PO roles do', async () => {
    const r = await pool.query(`
      SELECT DISTINCT r.role_key
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        JOIN feature_definitions f ON f.id = rp.feature_id
        JOIN capability_definitions c ON c.id = rp.capability_id
       WHERE f.feature_key = 'sales_po' AND c.capability_key = 'advance_stage'`);
    const roles = r.rows.map((x) => x.role_key);
    expect(roles).not.toContain('hrga');
    expect(roles).not.toContain('tax_insurance');
    expect(roles).toEqual(expect.arrayContaining(['sales', 'admin_log', 'finance', 'technical']));
  });
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- test/scripts/seed.accounts.test.js`
Expected: FAIL — hrga/tax currently hold `advance_stage` (granted to all six division roles).

- [ ] **Step 3: Split the grant and add an explicit revoke**

In `backend/scripts/seed.js`, find the block that grants `advance_stage` + `view_own` on
`sales_po` to all six division roles (currently lines ~347-359, the
`AND c.capability_key IN ('advance_stage', 'view_own')` query). Replace that single query with the
following three statements:
```javascript
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

    // Idempotent revoke: remove advance_stage from hrga/tax on already-seeded DBs.
    await pool.query(`
      DELETE FROM role_permissions rp
       USING roles r, feature_definitions f, capability_definitions c
       WHERE rp.role_id = r.id AND rp.feature_id = f.id AND rp.capability_id = c.id
         AND r.role_key IN ('hrga','tax_insurance')
         AND f.feature_key = $1
         AND c.capability_key = 'advance_stage'
    `, [PO_FEATURE_KEY]);
```

- [ ] **Step 4: Re-seed and run the test**

```bash
cd backend
DATABASE_URL="postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/crmdemo_test" node scripts/seed.js
npm test -- test/scripts/seed.accounts.test.js
```
Expected: PASS.

- [ ] **Step 5: Re-run the PO stage-action tests for regressions**

Run: `cd backend && npm test -- test/services/po.stage_actions.test.js`
Expected: PASS. If a test asserted that hrga/tax could advance a stage, update it to expect a
`ForbiddenError`/403 for those roles (the spec makes them read-only). Re-run until green.

- [ ] **Step 6: Commit**

```bash
git add backend/scripts/seed.js backend/test/
git commit -m "feat(sub-1): trim advance_stage from hrga/tax (read-only PO context)"
```

---

## Task 4: `accept` copies initial password hash → backup; register reset capability

**Files:**
- Modify: `backend/src/services/invitation.service.js`, `backend/scripts/seed.js`
- Test: `backend/test/services/invitation.backup.test.js`, append to `seed.accounts.test.js`

- [ ] **Step 1: Write the failing test for the accept→backup copy**

`backend/test/services/invitation.backup.test.js`:
```javascript
'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/invitation.service');

let ceoId;
const createdUserIds = [];

beforeAll(async () => {
  const u = await pool.query(`SELECT id FROM users WHERE role = 'ceo' LIMIT 1`);
  ceoId = u.rows[0]?.id;
});

afterAll(async () => {
  if (createdUserIds.length) {
    await pool.query(`DELETE FROM users WHERE id = ANY($1)`, [createdUserIds]);
  }
  await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'invite-backup-%@test.local'`);
});

describe('invitation.accept — backup password', () => {
  it('copies the invitation initial_password_hash into users.backup_password_hash', async () => {
    if (!ceoId) return;
    const created = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-backup-1@test.local',
      roleKey: 'sales',
    });
    const inv = await pool.query(
      `SELECT initial_password_hash FROM user_invitations WHERE id = $1`, [created.invitationId]);
    const accepted = await svc.accept({ token: created.activationToken, displayName: 'Backup Test' });
    createdUserIds.push(accepted.userId);

    const u = await pool.query(
      `SELECT password_hash, backup_password_hash FROM users WHERE id = $1`, [accepted.userId]);
    expect(u.rows[0].backup_password_hash).toBe(inv.rows[0].initial_password_hash);
    expect(u.rows[0].password_hash).toBe(inv.rows[0].initial_password_hash);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- test/services/invitation.backup.test.js`
Expected: FAIL — `backup_password_hash` is `null` (accept doesn't set it yet).

- [ ] **Step 3: Add `backup_password_hash` to the accept user INSERT**

In `backend/src/services/invitation.service.js`, in `accept` (~lines 263-270), change the user
INSERT to also write `backup_password_hash` (reusing `$2`, the `initial_password_hash`):
```javascript
        const userIns = await client.query(
            `INSERT INTO users
               (email, password_hash, backup_password_hash, role, level_id, display_name, account_status, must_change_password)
             VALUES ($1, $2, $2, $3, $4, $5, 'active', true)
             RETURNING id`,
            [row.email, row.initial_password_hash, row.role_key, row.level_id, displayName || row.email],
        );
```

- [ ] **Step 4: Run the test to verify it passes**

Run: `cd backend && npm test -- test/services/invitation.backup.test.js`
Expected: PASS.

- [ ] **Step 5: Write the failing test for the new capability**

Append inside the `describe` in `backend/test/scripts/seed.accounts.test.js`:
```javascript
  it('registers the reset_user_password capability', async () => {
    const r = await pool.query(
      `SELECT 1 FROM capability_definitions WHERE capability_key = 'reset_user_password'`);
    expect(r.rowCount).toBe(1);
  });
```

- [ ] **Step 6: Run it to verify it fails**

Run: `cd backend && npm test -- test/scripts/seed.accounts.test.js`
Expected: FAIL — capability not registered.

- [ ] **Step 7: Register the capability in the seeder**

In `backend/scripts/seed.js`, add to the `CAPABILITIES` array (lines ~63-74):
```javascript
    ['reset_user_password', 'Reset user password to backup'],
```
(Superadmin/CEO reach it via `full_access`, so no explicit grant row is needed.)

- [ ] **Step 8: Re-seed and run the test**

```bash
cd backend
DATABASE_URL="postgresql://interlab_staging01:$DB_PASSWORD@127.0.0.1:5440/crmdemo_test" node scripts/seed.js
npm test -- test/scripts/seed.accounts.test.js test/services/invitation.backup.test.js
```
Expected: PASS.

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/invitation.service.js backend/scripts/seed.js backend/test/
git commit -m "feat(sub-1): accept copies initial->backup_password_hash; register reset_user_password cap"
```

---

## Task 5: Reset-to-backup service + route

**Files:**
- Modify: `backend/src/services/auth.service.js`, `backend/src/app.js`
- Create: `backend/src/routes/admin/reset-to-backup.routes.js`, `backend/src/validators/reset.validators.js`
- Test: `backend/test/services/auth.resetToBackup.test.js`

- [ ] **Step 1: Write the failing service test**

`backend/test/services/auth.resetToBackup.test.js`:
```javascript
'use strict';
const { pool } = require('../helpers/db');
const bcrypt = require('bcryptjs');
const svc = require('../../src/services/auth.service');

let superId;
let targetId;

beforeAll(async () => {
  const s = await pool.query(`SELECT id, email, role FROM users WHERE role = 'superadmin' LIMIT 1`);
  superId = s.rows[0];
  const backup = await bcrypt.hash('Backup#Known1', 10);
  const ins = await pool.query(
    `INSERT INTO users (email, password_hash, backup_password_hash, role, display_name, account_status, must_change_password)
     VALUES ('reset-target@test.local', $1, $2, 'sales', 'Reset Target', 'active', false)
     ON CONFLICT (email) DO UPDATE SET password_hash=$1, backup_password_hash=$2, must_change_password=false
     RETURNING id`,
    [await bcrypt.hash('Original#Pw1', 10), backup]);
  targetId = ins.rows[0].id;
});

afterAll(async () => {
  if (targetId) await pool.query(`DELETE FROM users WHERE id = $1`, [targetId]);
  await pool.query(`DELETE FROM activity_logs WHERE resource_id = $1`, [targetId]);
});

describe('auth.resetToBackup', () => {
  it('copies backup_password_hash into password_hash, sets must_change_password, logs the action', async () => {
    const backupRow = await pool.query(`SELECT backup_password_hash FROM users WHERE id=$1`, [targetId]);
    const res = await svc.resetToBackup({
      actor: { id: superId.id, email: superId.email, role: superId.role },
      targetUserId: targetId,
    });
    expect(res.ok).toBe(true);

    const u = await pool.query(`SELECT password_hash, must_change_password FROM users WHERE id=$1`, [targetId]);
    expect(u.rows[0].password_hash).toBe(backupRow.rows[0].backup_password_hash);
    expect(u.rows[0].must_change_password).toBe(true);

    const log = await pool.query(
      `SELECT 1 FROM activity_logs WHERE action='auth.password.reset_to_backup' AND resource_id=$1`, [targetId]);
    expect(log.rowCount).toBeGreaterThan(0);
  });

  it('throws when the target has no backup_password_hash', async () => {
    await pool.query(`UPDATE users SET backup_password_hash = NULL WHERE id = $1`, [targetId]);
    await expect(
      svc.resetToBackup({ actor: { id: superId.id, email: superId.email, role: superId.role }, targetUserId: targetId }),
    ).rejects.toThrow(/backup password/i);
  });
});
```

- [ ] **Step 2: Run it to verify it fails**

Run: `cd backend && npm test -- test/services/auth.resetToBackup.test.js`
Expected: FAIL — `svc.resetToBackup is not a function`.

- [ ] **Step 3: Implement `resetToBackup` in `auth.service.js`**

In `backend/src/services/auth.service.js`: ensure the errors import includes `ValidationError`
(e.g. `const { UnauthorizedError, ValidationError } = require('../utils/errors');` — add
`ValidationError` if missing). Then add the function and export it:
```javascript
// Reset a user's password to their stored backup hash. Superadmin/CEO only
// (enforced at the route via rbacGuard). Never exposes plaintext.
async function resetToBackup({ actor, targetUserId }) {
    const { rows } = await db.query(
        `SELECT backup_password_hash FROM users WHERE id = $1 AND deleted_at IS NULL`,
        [targetUserId],
    );
    if (rows.length === 0) throw new ValidationError('User not found');
    const backup = rows[0].backup_password_hash;
    if (!backup) throw new ValidationError('No backup password set for this user');

    await db.query(
        `UPDATE users
            SET password_hash        = $2,
                must_change_password = true,
                updated_at           = now()
          WHERE id = $1`,
        [targetUserId, backup],
    );

    activityLog.record({
        userId: actor.id,
        userEmail: actor.email,
        userRole: actor.role,
        action: 'auth.password.reset_to_backup',
        resourceType: 'users',
        resourceId: targetUserId,
    }).catch(() => { /* logging must never break the mutation */ });

    return { ok: true };
}
```
Add `resetToBackup` to the `module.exports` of `auth.service.js`. (Confirm `activityLog` is already
required in this file — it is used by the login path; if the local binding differs, match it.)

- [ ] **Step 4: Run the service test to verify it passes**

Run: `cd backend && npm test -- test/services/auth.resetToBackup.test.js`
Expected: PASS.

- [ ] **Step 5: Create the validator**

`backend/src/validators/reset.validators.js`:
```javascript
'use strict';
const Joi = require('joi');

module.exports = {
    resetToBackup: Joi.object({
        userId: Joi.string().uuid().required(),
    }),
};
```

- [ ] **Step 6: Create the route (mirrors `invitations.routes.js` conventions)**

`backend/src/routes/admin/reset-to-backup.routes.js`:
```javascript
'use strict';
const express = require('express');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/reset.validators');
const svc = require('../../services/auth.service');
const { success } = require('../../utils/response');

const router = express.Router();
router.use(authMiddleware);

// POST /api/admin/reset-to-backup — superadmin/CEO reset a user to their backup password.
router.post(
    '/reset-to-backup',
    rbacGuard('admin_rbac', 'reset_user_password'),
    validate({ body: v.resetToBackup }),
    async (req, res, next) => {
        try {
            const r = await svc.resetToBackup({ actor: req.user, targetUserId: req.body.userId });
            res.json(success(r));
        } catch (e) { next(e); }
    },
);

module.exports = router;
```

- [ ] **Step 7: Mount the route in `app.js`**

In `backend/src/app.js`, next to the other `/api/admin` mounts (lines ~63-66), add:
```javascript
app.use('/api/admin', require('./routes/admin/reset-to-backup.routes'));
```

- [ ] **Step 8: Verify the app boots and the suite is green**

Run: `cd backend && node -e "require('./src/app.js'); console.log('app loaded ok')" && npm test -- test/services/auth.resetToBackup.test.js`
Expected: `app loaded ok` then PASS. (If boot tries to bind a port, ignore — the require should not throw on route wiring.)

- [ ] **Step 9: Commit**

```bash
git add backend/src/services/auth.service.js backend/src/routes/admin/reset-to-backup.routes.js \
        backend/src/validators/reset.validators.js backend/src/app.js \
        backend/test/services/auth.resetToBackup.test.js
git commit -m "feat(sub-1): add POST /api/admin/reset-to-backup (superadmin reset to backup password)"
```

---

## Task 6: Align invite route capability so managers can invite (AC#4)

**Files:**
- Modify: `backend/src/routes/admin/invitations.routes.js`
- Test: `backend/test/services/invitation.backup.test.js` (append manager-scope tests)

- [ ] **Step 1: Write the failing manager-scope tests**

Append to `backend/test/services/invitation.backup.test.js`:
```javascript
describe('invitation manager scope (service authorizeInvite)', () => {
  let salesMgrId;
  beforeAll(async () => {
    const r = await pool.query(`
      SELECT u.id FROM users u
        JOIN role_levels rl ON rl.id = u.level_id
       WHERE u.role = 'sales' AND rl.level_rank = 2 AND u.deleted_at IS NULL
       LIMIT 1`);
    salesMgrId = r.rows[0]?.id;
  });
  afterAll(async () => {
    await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'mgr-scope-%@test.local'`);
  });

  it('a sales manager can invite into role sales', async () => {
    if (!salesMgrId) return;
    const r = await svc.create({
      actor: { id: salesMgrId, role: 'sales' },
      email: 'mgr-scope-1@test.local',
      roleKey: 'sales',
    });
    expect(r.invitationId).toBeDefined();
  });

  it('a sales manager cannot invite into another role', async () => {
    if (!salesMgrId) return;
    await expect(
      svc.create({ actor: { id: salesMgrId, role: 'sales' }, email: 'mgr-scope-2@test.local', roleKey: 'finance' }),
    ).rejects.toThrow(/own role/i);
  });
});
```

- [ ] **Step 2: Run it to verify it passes at the service layer**

Run: `cd backend && npm test -- test/services/invitation.backup.test.js`
Expected: PASS (the service's `authorizeInvite` already enforces same-role). This confirms the
service is correct; the route guard is the remaining gap, fixed next.

- [ ] **Step 3: Change the create-route capability guard**

In `backend/src/routes/admin/invitations.routes.js`, the `POST /invitations` handler (~line 32)
currently uses `rbacGuard('admin_rbac', 'edit')`. Change it to the capability managers actually
hold (and which `authorizeInvite` checks), keeping superadmin/CEO passing via `full_access`:
```javascript
    rbacGuard('admin_rbac', 'invite_user'),
```

- [ ] **Step 4: Confirm no regression**

Run: `cd backend && npm test`
Expected: full suite PASS. (Superadmin/CEO still pass via `full_access`; managers now pass via
`invite_user`; staff without the capability still get 403.)

- [ ] **Step 5: Commit**

```bash
git add backend/src/routes/admin/invitations.routes.js backend/test/services/invitation.backup.test.js
git commit -m "fix(sub-1): invite route guards on invite_user so managers can invite own role (AC#4)"
```

---

## Task 7: `.env.example` staging block

**Files:**
- Modify: `.env.example` (repo root)

- [ ] **Step 1: Append the staging block**

Add to the repo-root `.env.example` (names aligned to `backend/src/config/env.js`):
```
# ── Postgres (staging via Tailscale SSH local-forward) ──
DATABASE_URL=postgresql://interlab_staging01:${DB_PASSWORD}@127.0.0.1:5440/interlab_db_staging
DB_PASSWORD=
SSH_HOST=100.117.214.25
SSH_PORT=2223
SSH_USER=zaky

# ── MinIO Global (env.js names; NOT spec's PRIVATE/PUBLIC) ──
MINIO_ENDPOINT=http://100.117.214.25:9101
MINIO_ACCESS_KEY=mgroot_8c8e8edb
MINIO_SECRET_KEY=
MINIO_BUCKET_ATTACHMENTS=interlab-private
MINIO_BUCKET_AVATARS=interlab-public

# ── 2FA ──
TOTP_ISSUER=Interlab ISSI
TWO_FACTOR_ENCRYPTION_KEY=

# ── Seed account passwords (used once by the seeder, then hashed) ──
SEED_PW_SUPERADMIN=
SEED_PW_CEO=
SEED_PW_SALES=
SEED_PW_ADMINLOG=
SEED_PW_FINANCE=
SEED_PW_TECHNICAL=
SEED_PW_HRGA=
SEED_PW_TAX=
```

- [ ] **Step 2: Verify the keys are present and no real secrets leaked**

Run: `grep -E 'SEED_PW_|MINIO_BUCKET_|TWO_FACTOR_ENCRYPTION_KEY|DATABASE_URL' .env.example`
Expected: the keys above appear with empty/placeholder values (no real passwords).

- [ ] **Step 3: Commit**

```bash
git add .env.example
git commit -m "docs(sub-1): document staging .env shape (postgres/minio/2fa/SEED_PW)"
```

---

## Task 8: Frontend — soft 2FA-before-invite gate

**Files:**
- Modify: `frontend/app/(app)/admin/invitations/page.tsx`, `frontend/app/(app)/admin/invitations/new/page.tsx`

Note: the frontend has no test runner; verify manually by running the dev server. The gate is
UI-only (soft) per spec — the backend is unchanged.

- [ ] **Step 1: Add the 2FA check to the invitations list page**

In `frontend/app/(app)/admin/invitations/page.tsx`, fetch the current profile's 2FA method (mirror
`profile/edit/page.tsx`) and gate the "+ New invitation" action. Add near the top of the component:
```tsx
import { useEffect, useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { isGlobalRole } from '@/lib/rbac';
import { profileApi } from '@/lib/profile-api';
import type { TwoFactorMethod } from '@/lib/twofactor-types';
```
```tsx
  const user = useAuthStore((s) => s.user);
  const [twoFactorMethod, setTwoFactorMethod] = useState<TwoFactorMethod>('disabled');
  useEffect(() => {
    profileApi.getMyProfile().then((p) => setTwoFactorMethod(p.two_factor_method ?? 'disabled')).catch(() => {});
  }, []);
  const inviteBlocked = isGlobalRole(user?.role) && twoFactorMethod === 'disabled';
```
Replace the existing `<Link href="/admin/invitations/new" ...>+ New invitation</Link>` with:
```tsx
        {inviteBlocked ? (
          <span
            title="Enable 2FA in Security settings before inviting users"
            className="bg-gray-300 text-gray-600 px-3 py-1 rounded cursor-not-allowed"
          >
            + New invitation (enable 2FA first)
          </span>
        ) : (
          <Link href="/admin/invitations/new" className="bg-blue-600 text-white px-3 py-1 rounded">
            + New invitation
          </Link>
        )}
```
(Confirm the exact import alias path for `profileApi` — `frontend/lib/profile-api.ts` exports it;
match the `import` style used in `profile/edit/page.tsx`.)

- [ ] **Step 2: Guard the form submit as defense-in-depth**

In `frontend/app/(app)/admin/invitations/new/page.tsx`, add the same `inviteBlocked` computation
(reuse the snippet from Step 1) and, when blocked, render a short notice + disable the submit
button instead of the form:
```tsx
  if (inviteBlocked) {
    return (
      <div className="p-6 max-w-md">
        <h1 className="text-2xl font-semibold">New invitation</h1>
        <p className="mt-4 text-sm text-red-600">
          Aktifkan 2FA di Settings → Security sebelum mengundang user. (Superadmin/CEO wajib 2FA.)
        </p>
      </div>
    );
  }
```

- [ ] **Step 3: Manual verification**

Run the frontend (`cd frontend && npm run dev`) and backend (`cd backend && npm run dev`) against
the tunnel. Log in as the superadmin (2FA still disabled): the "+ New invitation" action is
disabled and `/admin/invitations/new` shows the enable-2FA notice. Enable 2FA, reload: the action
becomes active. Confirm a non-global role never saw the invite entry to begin with.

- [ ] **Step 4: Commit**

```bash
git add "frontend/app/(app)/admin/invitations/page.tsx" "frontend/app/(app)/admin/invitations/new/page.tsx"
git commit -m "feat(sub-1): soft UI gate — superadmin/CEO must enable 2FA before inviting"
```

---

## Task 9: Definition-of-Done verification (no regression + acceptance)

**Files:** none (verification only)

- [ ] **Step 1: Full backend suite**

Run: `cd backend && npm test`
Expected: all PASS. Capture the summary line as evidence.

- [ ] **Step 2: Re-migrate + re-seed dev DB and smoke the 8 logins**

```bash
cd backend && node scripts/migrate.js && node scripts/seed.js && npm run dev
```
With the frontend running, log in as each of the 8 accounts using its `SEED_PW_*`. Verify each
lands on its dashboard and sees only permitted menus (AC#2). A sales manager sees Invitations;
a sales staff / hrga / tax do not get PO advance actions (AC#4 / matrix trim).

- [ ] **Step 3: Regression on protected existing auth**

Manually confirm existing login + captcha + "remember me" + forgot-password still work (AC#1) —
none were modified. Trigger a forgot-password and confirm the reset email is queued.

- [ ] **Step 4: Recovery path (AC, §5.2)**

As superadmin, `POST /api/admin/reset-to-backup` with a target user's id (e.g. via curl with the
superadmin JWT). Confirm the target can then log in with its backup/seed password and is forced to
change it (`must_change_password`), and that an `activity_logs` row `auth.password.reset_to_backup`
exists.

- [ ] **Step 5: Record outcomes**

Note pass/fail for AC#1, #2, #4, recovery, and the 2FA gate in the PR / handoff. Report failures
with output rather than asserting success.

---

## Self-Review (completed)

- **Spec coverage:** §3 migration → Task 1; §4 seed remap/SEED_PW/manager-levels/backup → Task 2;
  §5.1 accept→backup (create-returns-once already exists) → Task 4; §5.2 reset endpoint + cap →
  Tasks 4-5; §6 advance_stage trim → Task 3; AC#4 manager-invite route → Task 6; §7 2FA gate →
  Task 8; §8 .env → Task 7; §9 DoD → Task 9. No gaps.
- **Placeholder scan:** no TBD/TODO; every code/SQL/command step is concrete. Two explicit
  "confirm exact import binding" notes (auth.service `activityLog`, frontend `profileApi`) are
  verification nudges against real, named files, not missing content.
- **Type/name consistency:** `rbacGuard(feature, capability)`, `authMiddleware`, `validate({body})`,
  `success()`, `activityLog.record({...})`, `resetToBackup({actor,targetUserId})`,
  `backup_password_hash`, `SEED_PW_*`, `reset_user_password`, capability `invite_user` — used
  consistently across tasks and matched to verbatim code quoted from the codebase.
</content>
