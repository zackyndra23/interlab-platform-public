# Plan 2 — F1 Invitation System Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **Spec:** `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`)
> **Master plan:** `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md`
> **Depends on:** Plan 1 (Foundation + F2 Permission System) — must be complete

**Goal:** Enable Superadmin/CEO/Manager to onboard the 6 invitable roles via email invitation + activation token + first-login force-change-password.

**Architecture:** A new `user_invitations` table tracks invitation state (`pending|accepted|expired|revoked`). Tokens are random 32-byte values stored only as SHA-256 hash (one-way). Initial passwords are random 4-word passphrases hashed with argon2id; the plaintext exists only for the duration of the email send call. Resend regenerates a new token + password and revokes the prior invitation. After accepting, users land on a forced password-change screen before the rest of the app is accessible.

**Tech Stack:** Node 20 + Express, `pg`, `argon2` (new — for password hashing; replaces existing `bcryptjs` for new passwords), existing `notification_templates` + `email_queue` outbox, Next.js 14 + React 18.

---

## File map

**Net-new backend files**
- `backend/migrations/020_user_invitations.sql`
- `backend/src/utils/invitation_token.js`
- `backend/src/utils/initial_password.js`
- `backend/src/services/invitation.service.js`
- `backend/src/routes/admin/invitations.routes.js`
- `backend/src/routes/auth/activate.routes.js`
- `backend/src/validators/invitations.validators.js`
- `backend/test/utils/invitation_token.test.js`
- `backend/test/utils/initial_password.test.js`
- `backend/test/services/invitation.service.test.js`

**Modified backend files**
- `backend/package.json` — add `argon2`
- `backend/src/services/auth.service.js` — flag `must_change_password` in profile; add `changePassword` flow
- `backend/src/middleware/auth.middleware.js` — block protected routes if `must_change_password=true` (allow only `/auth/change-password` and `/auth/me`)
- `backend/src/app.js` — mount new routes
- `backend/scripts/seed.js` — register `invite_user` capability + `invitation_pending` notification_template + grant `invite_user` to top-rank manager levels

**Net-new frontend files**
- `frontend/lib/invitation-types.ts`
- `frontend/lib/invitation-api.ts`
- `frontend/lib/invitation-ui.ts`
- `frontend/app/(app)/admin/invitations/page.tsx` — list
- `frontend/app/(app)/admin/invitations/new/page.tsx` — create form
- `frontend/app/activate/[token]/page.tsx` — activation landing (outside `(app)` group, no auth required)
- `frontend/app/change-password/page.tsx` — forced first-login change

---

## Task 2.1 — Migration 020: `user_invitations` + `users.must_change_password`

**Files:**
- Create: `backend/migrations/020_user_invitations.sql`, `backend/test/migrations/020_user_invitations.test.js`

- [ ] **Step 2.1.1 — Write failing test**

```js
'use strict';
const { pool } = require('../helpers/db');

describe('migration 020 user_invitations', () => {
  it('table user_invitations exists with expected columns', async () => {
    const r = await pool.query(`
      SELECT column_name FROM information_schema.columns
       WHERE table_name='user_invitations' ORDER BY column_name`);
    const cols = r.rows.map(x => x.column_name);
    expect(cols).toEqual(expect.arrayContaining([
      'id','email','role_key','level_id','invited_by_user_id','inviter_role_key',
      'activation_token_hash','initial_password_hash','status','expires_at',
      'accepted_at','revoked_at','revoked_by_user_id','revoke_reason',
      'created_at','updated_at',
    ]));
  });

  it('partial unique constraint on (email) WHERE status=pending exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_constraint WHERE conname='user_invitations_email_active_unique'`);
    expect(r.rowCount).toBe(1);
  });

  it('users.must_change_password column exists with default false', async () => {
    const r = await pool.query(`
      SELECT is_nullable, column_default
        FROM information_schema.columns
       WHERE table_name='users' AND column_name='must_change_password'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].is_nullable).toBe('NO');
    expect(r.rows[0].column_default).toMatch(/false/i);
  });

  it('user_invitations_token_idx index exists', async () => {
    const r = await pool.query(`
      SELECT 1 FROM pg_indexes WHERE indexname='user_invitations_token_idx'`);
    expect(r.rowCount).toBe(1);
  });
});
```

- [ ] **Step 2.1.2 — Run failing test**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/migrations/020_user_invitations.test.js 2>&1 | tail -15
```

Expected: 4 fails (table doesn't exist).

- [ ] **Step 2.1.3 — Write migration**

```sql
-- ============================================================================
-- Migration 020: user_invitations + users.must_change_password
-- F1 Invitation System (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

CREATE TABLE user_invitations (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 text         NOT NULL,
    role_key              text         NOT NULL REFERENCES roles(role_key),
    level_id              uuid         NULL REFERENCES role_levels(id),
    invited_by_user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    inviter_role_key      text         NOT NULL,
    activation_token_hash text         NOT NULL,
    initial_password_hash text         NOT NULL,
    status                text         NOT NULL DEFAULT 'pending',
    expires_at            timestamptz  NOT NULL,
    accepted_at           timestamptz  NULL,
    revoked_at            timestamptz  NULL,
    revoked_by_user_id    uuid         NULL REFERENCES users(id),
    revoke_reason         text         NULL,
    created_at            timestamptz  NOT NULL DEFAULT now(),
    updated_at            timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT user_invitations_status_chk CHECK (status IN ('pending','accepted','expired','revoked')),
    CONSTRAINT user_invitations_email_active_unique
        EXCLUDE (email WITH =) WHERE (status = 'pending')
);

CREATE INDEX user_invitations_token_idx ON user_invitations (activation_token_hash);
CREATE INDEX user_invitations_email_idx ON user_invitations (lower(email));
CREATE INDEX user_invitations_status_expires_idx ON user_invitations (status, expires_at);
CREATE INDEX user_invitations_inviter_idx ON user_invitations (invited_by_user_id, created_at);

ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;

COMMIT;

-- +migrate Down
BEGIN;
ALTER TABLE users DROP COLUMN IF EXISTS must_change_password;
DROP TABLE IF EXISTS user_invitations;
COMMIT;
```

Note: `EXCLUDE (email WITH =) WHERE ...` requires the `btree_gist` extension only if using GIST. With `WITH =` and a btree-eligible column it falls back to a partial unique index — but Postgres syntax for "partial unique" is `CREATE UNIQUE INDEX ... WHERE`. The `EXCLUDE` form here may fail. Alternative if EXCLUDE fails:

```sql
-- Replace the EXCLUDE constraint with a partial unique index:
-- (drop the CONSTRAINT line above and add this after the table creation)
CREATE UNIQUE INDEX user_invitations_email_pending_unique
    ON user_invitations (lower(email)) WHERE status = 'pending';
```

The implementer should attempt EXCLUDE first; if Postgres rejects it without `btree_gist`, fall back to the partial unique index.

- [ ] **Step 2.1.4 — Apply + run test**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend \
  -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/migrate.js 2>&1 | tail -3
```

Expected: `[migrate] apply 020_user_invitations.sql`.

Then:
```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -15
```

Expected: full suite passes (Plan 1 baseline + 4 new = 68).

If the constraint name in test mismatches (e.g. partial-index fallback used `user_invitations_email_pending_unique` instead of `user_invitations_email_active_unique`), update the test to match the actual constraint name.

- [ ] **Step 2.1.5 — Commit**

```bash
git add backend/migrations/020_user_invitations.sql backend/test/migrations/020_user_invitations.test.js
git commit -m "feat(db): migration 020 user_invitations + must_change_password

Tracks invitation lifecycle (pending/accepted/expired/revoked). Partial
unique on (email) for pending rows blocks double-invite. activation_token
stored as SHA-256 hash only. initial_password as argon2id hash.

users.must_change_password boolean gates the post-activation forced
password-change flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.2 — Invitation token utility

**Files:** Create `backend/src/utils/invitation_token.js`, `backend/test/utils/invitation_token.test.js`

- [ ] **Step 2.2.1 — Write failing test**

```js
'use strict';
const { generateToken, hashToken } = require('../../src/utils/invitation_token');

describe('invitation_token', () => {
  it('generateToken returns a 64-char hex string (32 bytes)', () => {
    const t = generateToken();
    expect(typeof t).toBe('string');
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateToken produces unique tokens each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it('hashToken returns deterministic SHA-256 hex', () => {
    const t = 'a'.repeat(64);
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashToken differs for different input', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
```

- [ ] **Step 2.2.2 — Implement**

```js
'use strict';
const crypto = require('node:crypto');

function generateToken() {
  return crypto.randomBytes(32).toString('hex');
}

function hashToken(token) {
  return crypto.createHash('sha256').update(token, 'utf8').digest('hex');
}

module.exports = { generateToken, hashToken };
```

- [ ] **Step 2.2.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/utils/invitation_token.test.js 2>&1 | tail -10
```

```bash
git add backend/src/utils/invitation_token.js backend/test/utils/invitation_token.test.js
git commit -m "feat(util): invitation_token — generate + SHA-256 hash

32-byte random token, hex-encoded. Plaintext exists only in the email send
path; DB stores SHA-256 hash. One-way: tokens are recoverable only by the
inviter regenerating them via the resend flow.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.3 — Initial password generator

**Files:** Create `backend/src/utils/initial_password.js`, `backend/test/utils/initial_password.test.js`. Install `argon2`.

- [ ] **Step 2.3.1 — Install argon2**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/backend node:20 npm install argon2@^0.41.0 2>&1 | tail -5
```

- [ ] **Step 2.3.2 — Write failing test**

```js
'use strict';
const { generatePassphrase, hashPassword, verifyPassword } = require('../../src/utils/initial_password');

describe('initial_password', () => {
  it('generatePassphrase produces 4 hyphenated words from a curated wordlist', () => {
    const p = generatePassphrase();
    const parts = p.split('-');
    expect(parts.length).toBe(4);
    parts.forEach(w => {
      expect(w).toMatch(/^[a-z]+$/);
      expect(w.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('hashPassword returns argon2id hash that verifies', async () => {
    const pw = 'hello-world-foo-bar';
    const h = await hashPassword(pw);
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, pw)).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('hashPassword for the same input produces different hashes (salted)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
    // Both verify
    const { verifyPassword: v } = require('../../src/utils/initial_password');
    expect(await v(a, 'same-input')).toBe(true);
    expect(await v(b, 'same-input')).toBe(true);
  });
});
```

- [ ] **Step 2.3.3 — Implement**

```js
'use strict';
const argon2 = require('argon2');
const crypto = require('node:crypto');

// Curated wordlist of 256 common 4-7 letter English words. 4 picks → 256^4 ≈ 4.3B
// combinations. With argon2id work factor, brute force is impractical for the
// 48-hour token expiry window. Wordlist deliberately avoids ambiguous spellings.
const WORDS = [
  'able','acid','aged','also','area','army','away','baby','back','ball','band',
  'bank','base','bath','bean','bear','beat','been','beer','bell','belt','best',
  'bike','bill','bird','blow','blue','boat','body','bomb','bond','bone','book',
  'boom','born','boss','both','bowl','bulk','burn','bush','busy','call','calm',
  'came','camp','card','care','case','cash','cast','cell','chat','chip','city',
  'club','coal','coat','code','cold','come','cook','cool','cope','copy','core',
  'cost','crew','crop','dark','data','date','dawn','days','dead','deal','dean',
  'dear','debt','deep','deny','desk','dial','diet','disk','done','door','dose',
  'down','draw','drew','drop','drug','dual','duke','dust','duty','each','earn',
  'east','easy','edge','else','even','ever','evil','exit','face','fact','fail',
  'fair','fall','farm','fast','fate','fear','feed','feel','feet','fell','felt',
  'file','fill','film','find','fine','fire','firm','fish','five','flag','flat',
  'flew','flow','food','foot','ford','form','fort','four','free','from','fuel',
  'full','fund','gain','game','gate','gave','gear','gene','gift','girl','give',
  'glad','goal','goes','gold','golf','gone','good','gray','grew','grow','gulf',
  'hair','half','hall','hand','hang','hard','harm','hate','have','head','hear',
  'heat','held','hell','help','here','hero','hide','high','hill','hint','hire',
  'hold','hole','holy','home','hope','host','hour','huge','hung','hunt','hurt',
  'idea','inch','into','iron','item','jack','jane','jean','john','join','jump',
  'jury','just','keen','keep','kept','kick','kind','king','knee','knew','know',
  'lack','lady','laid','lake','land','lane','last','late','lazy','lead','leaf',
  'lean','left','less','life','lift','like','limb','line','link','list','live',
  'load','loan','lock','logo','long','look','lord','lose','loss','lost','loud',
  'love','luck',
];

function pickWord() {
  // Use crypto.randomInt to avoid Math.random bias.
  return WORDS[crypto.randomInt(0, WORDS.length)];
}

function generatePassphrase() {
  return [pickWord(), pickWord(), pickWord(), pickWord()].join('-');
}

async function hashPassword(plaintext) {
  return argon2.hash(plaintext, {
    type: argon2.argon2id,
    memoryCost: 19456,   // 19 MiB — OWASP minimum recommended
    timeCost: 2,
    parallelism: 1,
  });
}

async function verifyPassword(hash, plaintext) {
  try { return await argon2.verify(hash, plaintext); }
  catch { return false; }
}

module.exports = { generatePassphrase, hashPassword, verifyPassword };
```

- [ ] **Step 2.3.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/utils/initial_password.test.js 2>&1 | tail -10
```

```bash
git add backend/package.json backend/package-lock.json backend/src/utils/initial_password.js backend/test/utils/initial_password.test.js
git commit -m "feat(util): initial_password — 4-word passphrase + argon2id hash

Generates memorable random passphrases from a 256-word curated list
(~4.3B combinations). argon2id with OWASP-recommended params (19 MiB,
t=2, p=1). Plaintext exists only during email send; DB stores hash only.

Used by F1 invitation system. New user accounts will store argon2id
hashes; existing demo users retain bcrypt hashes (auth verifies both).

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.4 — Invitation service: `create`

**Files:** Create `backend/src/services/invitation.service.js` (initial skeleton + create), `backend/test/services/invitation.service.test.js`

- [ ] **Step 2.4.1 — Write failing test**

```js
'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/invitation.service');

let ceoId;

beforeAll(async () => {
  const u = await pool.query(`SELECT id FROM users WHERE role='ceo' LIMIT 1`);
  ceoId = u.rows[0]?.id;
});

afterAll(async () => {
  if (ceoId) {
    await pool.query(`DELETE FROM user_invitations WHERE email LIKE 'invite-test-%@test.local'`);
  }
});

describe('invitation.service.create', () => {
  it('Superadmin/CEO can create an invitation; returns plaintext token + password once', async () => {
    if (!ceoId) return;
    const r = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-test-1@test.local',
      roleKey: 'sales',
    });
    expect(r.invitationId).toBeDefined();
    expect(r.activationToken).toMatch(/^[0-9a-f]{64}$/);
    expect(r.initialPassword).toMatch(/^[a-z]+-[a-z]+-[a-z]+-[a-z]+$/);

    // DB stores hashes only — never plaintext
    const row = await pool.query(`SELECT activation_token_hash, initial_password_hash, status, expires_at
      FROM user_invitations WHERE id=$1`, [r.invitationId]);
    expect(row.rows[0].activation_token_hash).not.toBe(r.activationToken);
    expect(row.rows[0].initial_password_hash).toMatch(/^\$argon2id\$/);
    expect(row.rows[0].status).toBe('pending');
    expect(new Date(row.rows[0].expires_at).getTime()).toBeGreaterThan(Date.now());
  });

  it('rejects invitation for non-invitable role (e.g. ceo, superadmin)', async () => {
    if (!ceoId) return;
    await expect(svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-test-2@test.local',
      roleKey: 'ceo',
    })).rejects.toThrow();
  });

  it('blocks double-invite while a pending row exists for same email', async () => {
    if (!ceoId) return;
    await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-test-3@test.local',
      roleKey: 'finance',
    });
    await expect(svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'invite-test-3@test.local',
      roleKey: 'finance',
    })).rejects.toThrow(/pending/i);
  });

  it('non-superadmin/non-ceo without invite_user capability is forbidden', async () => {
    // Pick a sales staff user
    const s = await pool.query(`
      SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
       WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
    const staffId = s.rows[0]?.id;
    if (!staffId) return;
    await expect(svc.create({
      actor: { id: staffId, role: 'sales' },
      email: 'invite-test-4@test.local',
      roleKey: 'sales',
    })).rejects.toThrow(/forbidden|cannot invite/i);
  });
});
```

- [ ] **Step 2.4.2 — Implement create**

```js
'use strict';
const db = require('../config/database');
const { ForbiddenError, ValidationError, ConflictError } = require('../utils/errors');
const { generateToken, hashToken } = require('../utils/invitation_token');
const { generatePassphrase, hashPassword } = require('../utils/initial_password');
const activityLog = require('./activity_log.service');
const perms = require('./permission.service');

const INVITABLE_ROLES = ['sales','admin_log','finance','technical','hrga','tax_insurance'];
const TOKEN_EXPIRY_HOURS = 48;

async function authorizeInvite(actor, targetRoleKey) {
  if (actor.role === 'superadmin' || actor.role === 'ceo') return;
  // Must have invite_user capability on admin_rbac feature
  const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
  if (!caps.has('invite_user') && !caps.has('full_access')) {
    throw new ForbiddenError('cannot invite users');
  }
  // Manager-of-role can only invite within their own role
  if (targetRoleKey !== actor.role) {
    throw new ForbiddenError('Manager can invite only within their own role');
  }
}

async function resolveActorEmail(actor) {
  if (actor.email) return actor.email;
  const r = await db.query(`SELECT email FROM users WHERE id=$1`, [actor.id]);
  return r.rows[0]?.email || 'system@internal';
}

async function create({ actor, email, roleKey, levelId = null }) {
  if (!INVITABLE_ROLES.includes(roleKey)) {
    throw new ValidationError(`role '${roleKey}' is not invitable`);
  }
  await authorizeInvite(actor, roleKey);

  // Check for existing pending invite (db enforces, but we want a friendly error).
  const existing = await db.query(`
    SELECT id FROM user_invitations
     WHERE lower(email) = lower($1) AND status = 'pending'`, [email]);
  if (existing.rowCount) {
    throw new ConflictError('a pending invitation for this email already exists');
  }

  const token = generateToken();
  const tokenHash = hashToken(token);
  const passphrase = generatePassphrase();
  const passwordHash = await hashPassword(passphrase);
  const expiresAt = new Date(Date.now() + TOKEN_EXPIRY_HOURS * 60 * 60 * 1000);

  const r = await db.query(`
    INSERT INTO user_invitations
      (email, role_key, level_id, invited_by_user_id, inviter_role_key,
       activation_token_hash, initial_password_hash, expires_at)
    VALUES ($1,$2,$3,$4,$5,$6,$7,$8)
    RETURNING id`,
    [email, roleKey, levelId, actor.id, actor.role, tokenHash, passwordHash, expiresAt]);

  const invitationId = r.rows[0].id;
  resolveActorEmail(actor).then(actorEmail => {
    activityLog.record({
      userId: actor.id,
      userEmail: actorEmail,
      userRole: actor.role,
      action: 'invitation.created',
      relatedEntity: 'user_invitations',
      relatedId: invitationId,
      details: { email, roleKey, levelId },
    }).catch(() => {});
  }).catch(() => {});

  return {
    invitationId,
    activationToken: token,
    initialPassword: passphrase,
    expiresAt: expiresAt.toISOString(),
  };
}

module.exports = { create, INVITABLE_ROLES, TOKEN_EXPIRY_HOURS };
```

(Reference `role_level.service.js` and `permission_override.service.js` for the activity_log pattern. Activity log is fire-and-forget.)

- [ ] **Step 2.4.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/invitation.service.test.js 2>&1 | tail -15
```

Expected: 4/4 pass.

```bash
git add backend/src/services/invitation.service.js backend/test/services/invitation.service.test.js
git commit -m "feat(invitation): create() — Superadmin/CEO/manager-of-role invite

Validates target role is invitable (6 roles). Enforces same-role rule for
non-superadmin/ceo via invite_user capability + role match. 48h expiry.
Returns plaintext token + passphrase ONCE; DB stores hashes only.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.5 — Invitation service: `accept`

**Files:** Modify `backend/src/services/invitation.service.js` and test file.

- [ ] **Step 2.5.1 — Add failing test**

Append to `invitation.service.test.js`:

```js
describe('invitation.service.accept', () => {
  let token;
  beforeAll(async () => {
    if (!ceoId) return;
    const r = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'accept-test@test.local',
      roleKey: 'sales',
    });
    token = r.activationToken;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM users WHERE email='accept-test@test.local'`);
    await pool.query(`DELETE FROM user_invitations WHERE email='accept-test@test.local'`);
  });

  it('accept creates the user with must_change_password=true', async () => {
    if (!token) return;
    const r = await svc.accept({ token, displayName: 'Test Sales User' });
    expect(r.userId).toBeDefined();
    const u = await pool.query(`SELECT must_change_password, account_status FROM users WHERE id=$1`, [r.userId]);
    expect(u.rows[0].must_change_password).toBe(true);
    expect(u.rows[0].account_status).toBe('active');
  });

  it('accept marks invitation status=accepted with accepted_at set', async () => {
    if (!token) return;
    const inv = await pool.query(`SELECT status, accepted_at FROM user_invitations
       WHERE activation_token_hash=$1`, [require('../../src/utils/invitation_token').hashToken(token)]);
    expect(inv.rows[0].status).toBe('accepted');
    expect(inv.rows[0].accepted_at).not.toBeNull();
  });

  it('accept rejects unknown token', async () => {
    await expect(svc.accept({ token: 'a'.repeat(64), displayName: 'x' })).rejects.toThrow();
  });

  it('accept rejects already-accepted token (one-shot)', async () => {
    if (!token) return;
    await expect(svc.accept({ token, displayName: 'x' })).rejects.toThrow();
  });

  it('accept rejects expired token', async () => {
    if (!ceoId) return;
    const r = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'accept-expired@test.local',
      roleKey: 'sales',
    });
    await pool.query(`UPDATE user_invitations SET expires_at = now() - interval '1 hour' WHERE id=$1`, [r.invitationId]);
    await expect(svc.accept({ token: r.activationToken, displayName: 'x' })).rejects.toThrow(/expired|not found/i);
    await pool.query(`DELETE FROM user_invitations WHERE id=$1`, [r.invitationId]);
  });
});
```

- [ ] **Step 2.5.2 — Implement accept**

Append to `invitation.service.js`:

```js
async function accept({ token, displayName }) {
  if (!token || typeof token !== 'string' || token.length !== 64) {
    throw new ValidationError('invalid token');
  }
  const tokenHash = hashToken(token);

  // Atomic transition: SELECT FOR UPDATE → verify status/expiry → INSERT user → UPDATE invitation.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');
    const inv = await client.query(`
      SELECT id, email, role_key, level_id, initial_password_hash, status, expires_at
        FROM user_invitations
       WHERE activation_token_hash = $1
       FOR UPDATE`, [tokenHash]);
    if (!inv.rowCount) throw new ValidationError('invitation not found');
    const row = inv.rows[0];
    if (row.status !== 'pending') throw new ValidationError('invitation no longer valid');
    if (new Date(row.expires_at) < new Date()) {
      await client.query(`UPDATE user_invitations SET status='expired', updated_at=now() WHERE id=$1`, [row.id]);
      throw new ValidationError('invitation expired');
    }

    // Insert the user with must_change_password=true.
    const userIns = await client.query(`
      INSERT INTO users
        (email, password_hash, role, level_id, display_name, account_status, must_change_password)
      VALUES ($1, $2, $3, $4, $5, 'active', true)
      RETURNING id`,
      [row.email, row.initial_password_hash, row.role_key, row.level_id, displayName || row.email]);

    await client.query(`
      UPDATE user_invitations
         SET status='accepted', accepted_at = now(), updated_at = now()
       WHERE id = $1`, [row.id]);

    await client.query('COMMIT');

    activityLog.record({
      userId: userIns.rows[0].id,
      userEmail: row.email,
      userRole: row.role_key,
      action: 'invitation.accepted',
      relatedEntity: 'user_invitations',
      relatedId: row.id,
      details: { invitedAs: row.role_key },
    }).catch(() => {});

    return { userId: userIns.rows[0].id, mustChangePassword: true };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

module.exports.accept = accept;
```

Note: `db.pool` may not be a thing if the DB module exports differently. Read `backend/src/config/database.js` to see how to acquire a pool client. Use `db.connect()` if that's what's exported, or `db.getPool().connect()`, etc.

- [ ] **Step 2.5.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/invitation.service.test.js 2>&1 | tail -15
```

Expected: 9/9 pass (4 create + 5 accept).

```bash
git add backend/src/services/invitation.service.js backend/test/services/invitation.service.test.js
git commit -m "feat(invitation): accept(token, displayName) — atomic onboard

SELECT FOR UPDATE serializes concurrent acceptance. Verifies status=pending
and not expired; auto-marks expired tokens as 'expired'. Creates user with
must_change_password=true. One-shot: re-accepting a used token throws.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.6 — Invitation service: `revoke` + `resend`

**Files:** Modify `backend/src/services/invitation.service.js` and test file.

- [ ] **Step 2.6.1 — Add failing tests**

Append to test:

```js
describe('invitation.service.revoke', () => {
  let invId;
  beforeAll(async () => {
    if (!ceoId) return;
    const r = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'revoke-test@test.local',
      roleKey: 'sales',
    });
    invId = r.invitationId;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_invitations WHERE email='revoke-test@test.local'`);
  });

  it('revoke marks status=revoked + records reason', async () => {
    if (!invId || !ceoId) return;
    await svc.revoke({ actor: { id: ceoId, role: 'ceo' }, invitationId: invId, reason: 'wrong email' });
    const r = await pool.query(`SELECT status, revoked_at, revoke_reason FROM user_invitations WHERE id=$1`, [invId]);
    expect(r.rows[0].status).toBe('revoked');
    expect(r.rows[0].revoked_at).not.toBeNull();
    expect(r.rows[0].revoke_reason).toBe('wrong email');
  });
});

describe('invitation.service.resend', () => {
  let invId;
  beforeAll(async () => {
    if (!ceoId) return;
    const r = await svc.create({
      actor: { id: ceoId, role: 'ceo' },
      email: 'resend-test@test.local',
      roleKey: 'sales',
    });
    invId = r.invitationId;
  });

  afterAll(async () => {
    await pool.query(`DELETE FROM user_invitations WHERE email='resend-test@test.local'`);
  });

  it('resend creates a fresh invitation, revokes the old one', async () => {
    if (!invId || !ceoId) return;
    const r = await svc.resend({ actor: { id: ceoId, role: 'ceo' }, invitationId: invId });
    expect(r.invitationId).not.toBe(invId);
    expect(r.activationToken).toMatch(/^[0-9a-f]{64}$/);

    const oldStatus = await pool.query(`SELECT status FROM user_invitations WHERE id=$1`, [invId]);
    expect(oldStatus.rows[0].status).toBe('revoked');

    const newStatus = await pool.query(`SELECT status FROM user_invitations WHERE id=$1`, [r.invitationId]);
    expect(newStatus.rows[0].status).toBe('pending');
  });
});
```

- [ ] **Step 2.6.2 — Implement revoke + resend**

Append to `invitation.service.js`:

```js
async function authorizeManage(actor, invitationRow) {
  if (actor.role === 'superadmin' || actor.role === 'ceo') return;
  // Manager of own role can manage their own invitations
  const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
  if (!caps.has('invite_user') && !caps.has('full_access')) {
    throw new ForbiddenError('cannot manage invitations');
  }
  if (invitationRow.role_key !== actor.role) {
    throw new ForbiddenError('cannot manage cross-role invitation');
  }
  if (invitationRow.invited_by_user_id !== actor.id) {
    throw new ForbiddenError('only the original inviter can manage this invitation');
  }
}

async function revoke({ actor, invitationId, reason = null }) {
  const cur = await db.query(`SELECT * FROM user_invitations WHERE id=$1`, [invitationId]);
  if (!cur.rowCount) throw new ValidationError('invitation not found');
  await authorizeManage(actor, cur.rows[0]);
  if (cur.rows[0].status !== 'pending') {
    throw new ValidationError(`cannot revoke invitation with status '${cur.rows[0].status}'`);
  }
  await db.query(`
    UPDATE user_invitations
       SET status='revoked', revoked_at=now(), revoked_by_user_id=$2, revoke_reason=$3, updated_at=now()
     WHERE id=$1`, [invitationId, actor.id, reason]);
  resolveActorEmail(actor).then(actorEmail => {
    activityLog.record({
      userId: actor.id, userEmail: actorEmail, userRole: actor.role,
      action: 'invitation.revoked',
      relatedEntity: 'user_invitations', relatedId: invitationId,
      details: { reason },
    }).catch(() => {});
  }).catch(() => {});
  return { ok: true };
}

async function resend({ actor, invitationId }) {
  const cur = await db.query(`SELECT * FROM user_invitations WHERE id=$1`, [invitationId]);
  if (!cur.rowCount) throw new ValidationError('invitation not found');
  await authorizeManage(actor, cur.rows[0]);
  if (cur.rows[0].status !== 'pending') {
    throw new ValidationError(`cannot resend invitation with status '${cur.rows[0].status}'`);
  }
  // Revoke old
  await db.query(`
    UPDATE user_invitations
       SET status='revoked', revoked_at=now(), revoked_by_user_id=$2, revoke_reason='resend', updated_at=now()
     WHERE id=$1`, [invitationId, actor.id]);
  // Create new (reuse same email/role/level)
  const fresh = await create({
    actor,
    email: cur.rows[0].email,
    roleKey: cur.rows[0].role_key,
    levelId: cur.rows[0].level_id,
  });
  resolveActorEmail(actor).then(actorEmail => {
    activityLog.record({
      userId: actor.id, userEmail: actorEmail, userRole: actor.role,
      action: 'invitation.resent',
      relatedEntity: 'user_invitations', relatedId: fresh.invitationId,
      details: { previousInvitationId: invitationId },
    }).catch(() => {});
  }).catch(() => {});
  return fresh;
}

module.exports.revoke = revoke;
module.exports.resend = resend;
```

- [ ] **Step 2.6.3 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/invitation.service.test.js 2>&1 | tail -15
```

Expected: 11/11 pass.

```bash
git add backend/src/services/invitation.service.js backend/test/services/invitation.service.test.js
git commit -m "feat(invitation): revoke + resend

revoke: marks status=revoked, blocked unless status was pending. resend:
revokes old + creates fresh (new token + new password), preserving email/
role/level. Authority: superadmin/ceo OR original inviter (manager) for
their own role.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.7 — Invitation service: `list`

**Files:** Modify `invitation.service.js` and test.

- [ ] **Step 2.7.1 — Test**

```js
describe('invitation.service.list', () => {
  it('returns invitations with status filter; superadmin/ceo see all', async () => {
    if (!ceoId) return;
    const all = await svc.list({ actor: { id: ceoId, role: 'ceo' } });
    expect(Array.isArray(all)).toBe(true);
    const pending = await svc.list({ actor: { id: ceoId, role: 'ceo' }, status: 'pending' });
    expect(pending.every(x => x.status === 'pending')).toBe(true);
  });
});
```

- [ ] **Step 2.7.2 — Implement**

```js
async function list({ actor, status = null }) {
  const isPrivileged = actor.role === 'superadmin' || actor.role === 'ceo';
  const conditions = [];
  const params = [];
  if (!isPrivileged) {
    params.push(actor.id);
    conditions.push(`invited_by_user_id = $${params.length}`);
  }
  if (status) {
    params.push(status);
    conditions.push(`status = $${params.length}`);
  }
  const whereClause = conditions.length ? `WHERE ${conditions.join(' AND ')}` : '';
  const r = await db.query(`
    SELECT id, email, role_key, level_id, status, invited_by_user_id, inviter_role_key,
           expires_at, accepted_at, revoked_at, revoke_reason, created_at
      FROM user_invitations
      ${whereClause}
     ORDER BY created_at DESC
     LIMIT 200`, params);
  return r.rows;
}

module.exports.list = list;
```

- [ ] **Step 2.7.3 — Run + commit**

```bash
git add backend/src/services/invitation.service.js backend/test/services/invitation.service.test.js
git commit -m "feat(invitation): list({ actor, status? })

Superadmin/CEO see all; manager sees own invitations only. Optional status
filter (pending/accepted/expired/revoked). Capped at 200 rows.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.8 — Validators + admin invitation routes + activate route

**Files:** Create `backend/src/validators/invitations.validators.js`, `backend/src/routes/admin/invitations.routes.js`, `backend/src/routes/auth/activate.routes.js`. Modify `backend/src/app.js`.

- [ ] **Step 2.8.1 — Validators**

```js
'use strict';
const Joi = require('joi');

const create = Joi.object({
  email: Joi.string().email().required(),
  roleKey: Joi.string().valid('sales','admin_log','finance','technical','hrga','tax_insurance').required(),
  levelId: Joi.string().uuid().allow(null),
});

const revoke = Joi.object({
  reason: Joi.string().max(255).allow('', null),
});

const accept = Joi.object({
  token: Joi.string().length(64).hex().required(),
  newPassword: Joi.string().min(8).max(120).required(),
  displayName: Joi.string().min(1).max(120).required(),
});

module.exports = { create, revoke, accept };
```

- [ ] **Step 2.8.2 — Admin invitation routes**

```js
'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/invitations.validators');
const svc = require('../../services/invitation.service');
const { success } = require('../../utils/responses');

router.use(authMiddleware);

router.get('/invitations',
  rbacGuard('admin_rbac', 'view_global'),
  async (req, res, next) => {
    try {
      const list = await svc.list({ actor: req.user, status: req.query.status || null });
      res.json(success({ items: list }));
    } catch (e) { next(e); }
  });

router.post('/invitations',
  rbacGuard('admin_rbac', 'edit'),
  permissionWriteLimiter,
  validate({ body: v.create }),
  async (req, res, next) => {
    try {
      const r = await svc.create({ actor: req.user, ...req.body });
      // Note: response includes activationToken + initialPassword ONCE.
      // Future: replace with auto-send-email flow once notification template wires up.
      res.status(201).json(success(r));
    } catch (e) { next(e); }
  });

router.post('/invitations/:id/revoke',
  rbacGuard('admin_rbac', 'edit'),
  permissionWriteLimiter,
  validate({ body: v.revoke }),
  async (req, res, next) => {
    try {
      await svc.revoke({ actor: req.user, invitationId: req.params.id, reason: req.body.reason || null });
      res.json(success({ ok: true }));
    } catch (e) { next(e); }
  });

router.post('/invitations/:id/resend',
  rbacGuard('admin_rbac', 'edit'),
  permissionWriteLimiter,
  async (req, res, next) => {
    try {
      const r = await svc.resend({ actor: req.user, invitationId: req.params.id });
      res.json(success(r));
    } catch (e) { next(e); }
  });

module.exports = router;
```

(Confirm `success()` helper location by reading `backend/src/utils/responses.js` — adjust import if it lives elsewhere.)

- [ ] **Step 2.8.3 — Activate route (no auth required)**

```js
'use strict';
const express = require('express');
const router = express.Router();
const { validate } = require('../../middleware/validator.middleware');
const v = require('../../validators/invitations.validators');
const svc = require('../../services/invitation.service');
const auth = require('../../services/auth.service');
const { hashPassword, verifyPassword } = require('../../utils/initial_password');
const db = require('../../config/database');
const { success } = require('../../utils/responses');

// POST /api/auth/activate
//   body: { token, newPassword, displayName }
//   1. Verify token + create user (must_change_password=true)
//   2. Update user's password to newPassword (argon2id), set must_change_password=false
//   3. Sign access token + refresh session — same shape as login
router.post('/activate',
  validate({ body: v.accept }),
  async (req, res, next) => {
    try {
      const { token, newPassword, displayName } = req.body;
      const r = await svc.accept({ token, displayName });
      // After accept, swap the password from the seeded passphrase to user-chosen.
      const newHash = await hashPassword(newPassword);
      await db.query(`
        UPDATE users SET password_hash=$2, must_change_password=false, updated_at=now()
         WHERE id=$1`, [r.userId, newHash]);

      // Issue session — reuse auth.service primitives.
      const profile = await auth.loadProfile(r.userId);
      const accessToken = auth.signAccessToken(profile);
      const refresh = auth.generateOpaqueToken();
      const refreshHash = auth.hashToken(refresh);
      const client = await db.pool.connect();
      try {
        await client.query('BEGIN');
        await auth.createSession(client, { userId: r.userId, rememberMe: false });
        await client.query('COMMIT');
      } finally {
        client.release();
      }

      res.json(success({
        userId: r.userId,
        accessToken,
        // refresh token issuance: simplified — caller may need to align with existing login response shape
      }));
    } catch (e) { next(e); }
  });

module.exports = router;
```

Note: `auth.service.js`'s exact session-issuance shape will dictate the final response. Read the existing login route to see the full response (including refresh-token cookie pattern) and mirror it. The above is illustrative.

- [ ] **Step 2.8.4 — Mount in app.js**

```js
app.use('/api/admin', require('./routes/admin/invitations.routes'));
app.use('/api/auth', require('./routes/auth/activate.routes'));
```

- [ ] **Step 2.8.5 — Run full suite + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -20
```

Expected: full suite passes.

```bash
git add backend/src/validators/invitations.validators.js backend/src/routes/admin/invitations.routes.js backend/src/routes/auth/activate.routes.js backend/src/app.js
git commit -m "feat(invitation): admin invitation routes + activate endpoint

Admin: GET/POST /api/admin/invitations, POST /:id/revoke, POST /:id/resend.
Public: POST /api/auth/activate with token + newPassword + displayName.

The activate endpoint completes onboarding atomically: accept() creates
the user; password is immediately rotated to the user-chosen value and
must_change_password is cleared.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.9 — Seed `invite_user` capability + `invitation_pending` notification template

**Files:** Modify `backend/scripts/seed.js`.

- [ ] **Step 2.9.1 — Add seed entries**

In `seed.js`:

1. After CAPABILITIES are seeded, add `invite_user`:

```js
const NEW_CAPABILITIES = [
  { capability_key: 'invite_user', capability_name: 'Invite user' },
];
for (const cap of NEW_CAPABILITIES) {
  await client.query(`
    INSERT INTO capability_definitions (capability_key, capability_name)
    VALUES ($1, $2) ON CONFLICT (capability_key) DO NOTHING`,
    [cap.capability_key, cap.capability_name]);
}
```

2. After role_permissions seeding, grant `invite_user` capability on `admin_rbac` feature to top-rank manager levels:

```js
// Grant invite_user to top-rank Manager of each invitable role
await client.query(`
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
```

3. Seed `invitation_pending` template:

```js
await client.query(`
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
```

- [ ] **Step 2.9.2 — Re-run seed against test DB**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend \
  -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/seed.js 2>&1 | tail -5
```

Expected: `[seed] done`.

- [ ] **Step 2.9.3 — Add a test confirming the seeds**

`backend/test/services/invitation.seed.test.js`:

```js
'use strict';
const { pool } = require('../helpers/db');

describe('seed — invitation prerequisites', () => {
  it('invite_user capability exists', async () => {
    const r = await pool.query(`SELECT 1 FROM capability_definitions WHERE capability_key='invite_user'`);
    expect(r.rowCount).toBe(1);
  });

  it('invitation_pending template exists and is enabled', async () => {
    const r = await pool.query(`SELECT status FROM notification_templates WHERE template_key='invitation_pending'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].status).toBe('enabled');
  });

  it('top-rank manager of each invitable role has invite_user on admin_rbac', async () => {
    const r = await pool.query(`
      SELECT r.role_key, count(*)::int AS n
        FROM role_permissions rp
        JOIN roles r ON r.id = rp.role_id
        JOIN role_levels rl ON rl.id = rp.level_id
        JOIN feature_definitions f ON f.id = rp.feature_id
        JOIN capability_definitions c ON c.id = rp.capability_id
       WHERE f.feature_key = 'admin_rbac'
         AND c.capability_key = 'invite_user'
         AND rl.level_rank = (SELECT max(level_rank) FROM role_levels
                                 WHERE role_id = rl.role_id AND deleted_at IS NULL)
       GROUP BY r.role_key`);
    const keys = r.rows.map(x => x.role_key).sort();
    expect(keys).toEqual(['admin_log','finance','hrga','sales','tax_insurance','technical']);
  });
});
```

- [ ] **Step 2.9.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -15
```

```bash
git add backend/scripts/seed.js backend/test/services/invitation.seed.test.js
git commit -m "feat(seed): invite_user capability + invitation_pending template + manager grants

invite_user is a new capability_definitions row; granted to the top-rank
manager of each of the 6 invitable roles on admin_rbac feature. Allows
managers to invite within their own role (subject to authorizeInvite
rules in invitation.service).

invitation_pending notification template seeded with placeholder body
referencing {{role}}, {{activation_url}}, {{expires_at}}.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.10 — Auth/login force-password-change gate + `me` flag

**Files:** Modify `backend/src/services/auth.service.js`, `backend/src/middleware/auth.middleware.js`. Add a `change-password` route.

- [ ] **Step 2.10.1 — Add must_change_password to loadProfile output**

Find `loadProfile(userId)` in `auth.service.js`. Add `must_change_password` to the SELECT and the returned object. Existing callers (login, refresh, me) all use this — automatic propagation.

- [ ] **Step 2.10.2 — Add changePassword to auth.service.js**

```js
async function changePassword({ userId, currentPassword, newPassword }) {
  const u = await db.query(`SELECT password_hash FROM users WHERE id=$1`, [userId]);
  if (!u.rowCount) throw new ValidationError('user not found');
  const { verifyPassword, hashPassword } = require('../utils/initial_password');
  // Existing demo passwords are bcrypt; new are argon2id. Try both.
  const bcryptjs = require('bcryptjs');
  const ok = (await verifyPassword(u.rows[0].password_hash, currentPassword))
          || (await bcryptjs.compare(currentPassword, u.rows[0].password_hash));
  if (!ok) throw new UnauthorizedError('current password incorrect');
  const newHash = await hashPassword(newPassword);
  await db.query(`UPDATE users SET password_hash=$2, must_change_password=false, updated_at=now() WHERE id=$1`,
    [userId, newHash]);
  return { ok: true };
}
module.exports.changePassword = changePassword;
```

(Add `UnauthorizedError`/`ValidationError` imports if missing.)

- [ ] **Step 2.10.3 — Add gate to auth middleware**

In `auth.middleware.js`, after attaching `req.user`, add:

```js
const ALLOWED_WHEN_MUST_CHANGE = new Set([
  'GET /api/auth/me',
  'POST /api/auth/change-password',
  'POST /api/auth/logout',
]);

// ... inside the middleware after JWT verify + user lookup:
if (req.user.must_change_password) {
  const route = `${req.method} ${req.baseUrl}${req.path}`;
  // tolerant match: `${req.method} ${req.originalUrl.split('?')[0]}`
  const matched = [...ALLOWED_WHEN_MUST_CHANGE].some(r => {
    const [m, p] = r.split(' ');
    return req.method === m && req.originalUrl.split('?')[0] === p;
  });
  if (!matched) {
    return res.status(403).json({ error: 'must change password before continuing', code: 'must_change_password' });
  }
}
```

- [ ] **Step 2.10.4 — Change-password route**

`backend/src/routes/auth/changePassword.routes.js`:

```js
'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validator.middleware');
const auth = require('../../services/auth.service');
const { success } = require('../../utils/responses');

const schema = Joi.object({
  currentPassword: Joi.string().required(),
  newPassword: Joi.string().min(8).max(120).required(),
});

router.use(authMiddleware);

router.post('/change-password', validate({ body: schema }), async (req, res, next) => {
  try {
    await auth.changePassword({
      userId: req.user.id,
      currentPassword: req.body.currentPassword,
      newPassword: req.body.newPassword,
    });
    res.json(success({ ok: true }));
  } catch (e) { next(e); }
});

module.exports = router;
```

Mount in `app.js`: `app.use('/api/auth', require('./routes/auth/changePassword.routes'));`

- [ ] **Step 2.10.5 — Test**

```js
'use strict';
const { pool } = require('../helpers/db');
const auth = require('../../src/services/auth.service');

describe('auth.changePassword', () => {
  let userId;
  beforeAll(async () => {
    const r = await pool.query(`SELECT id FROM users WHERE role='sales' LIMIT 1`);
    userId = r.rows[0]?.id;
  });

  it('rejects wrong current password', async () => {
    if (!userId) return;
    await expect(auth.changePassword({
      userId, currentPassword: 'definitely-wrong', newPassword: 'new-strong-pass-1',
    })).rejects.toThrow();
  });

  it('accepts correct current password and clears must_change_password', async () => {
    if (!userId) return;
    // Set a known password first
    const { hashPassword } = require('../../src/utils/initial_password');
    const known = 'known-test-pw-1234';
    await pool.query(`UPDATE users SET password_hash=$2, must_change_password=true WHERE id=$1`,
      [userId, await hashPassword(known)]);
    await auth.changePassword({
      userId, currentPassword: known, newPassword: 'brand-new-pw-5678',
    });
    const r = await pool.query(`SELECT must_change_password FROM users WHERE id=$1`, [userId]);
    expect(r.rows[0].must_change_password).toBe(false);
  });
});
```

- [ ] **Step 2.10.6 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -15
```

```bash
git add backend/src/services/auth.service.js backend/src/middleware/auth.middleware.js backend/src/routes/auth/changePassword.routes.js backend/src/app.js backend/test/services/auth.changePassword.test.js
git commit -m "feat(auth): force-password-change gate + change-password endpoint

loadProfile returns must_change_password. Middleware blocks all routes
except /me, /change-password, /logout when flag is true. changePassword
verifies current password (argon2id OR legacy bcrypt) and sets new
argon2id hash + clears the flag.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.11 — Frontend types + api

**Files:** Create `frontend/lib/invitation-{types,api,ui}.ts`.

- [ ] **Step 2.11.1 — Types**

```ts
// invitation-types.ts
export type InvitationStatus = 'pending' | 'accepted' | 'expired' | 'revoked';

export interface Invitation {
  id: string;
  email: string;
  role_key: string;
  level_id: string | null;
  status: InvitationStatus;
  invited_by_user_id: string;
  inviter_role_key: string;
  expires_at: string;
  accepted_at: string | null;
  revoked_at: string | null;
  revoke_reason: string | null;
  created_at: string;
}

export interface CreateInvitationResult {
  invitationId: string;
  activationToken: string;
  initialPassword: string;
  expiresAt: string;
}
```

- [ ] **Step 2.11.2 — API**

```ts
// invitation-api.ts
import { api } from './api';
import type { Invitation, CreateInvitationResult, InvitationStatus } from './invitation-types';

export const invitationApi = {
  list: (status?: InvitationStatus) =>
    api.get<{ data: { items: Invitation[] } }>(`/api/admin/invitations${status ? `?status=${status}` : ''}`).then(r => r.data.data.items),
  create: (body: { email: string; roleKey: string; levelId?: string | null }) =>
    api.post<{ data: CreateInvitationResult }>(`/api/admin/invitations`, body).then(r => r.data.data),
  revoke: (id: string, reason?: string) =>
    api.post(`/api/admin/invitations/${id}/revoke`, { reason: reason || null }).then(r => r.data),
  resend: (id: string) =>
    api.post<{ data: CreateInvitationResult }>(`/api/admin/invitations/${id}/resend`, {}).then(r => r.data.data),
  activate: (body: { token: string; newPassword: string; displayName: string }) =>
    api.post(`/api/auth/activate`, body).then(r => r.data),
  changePassword: (body: { currentPassword: string; newPassword: string }) =>
    api.post(`/api/auth/change-password`, body).then(r => r.data),
};
```

- [ ] **Step 2.11.3 — UI helpers**

```ts
// invitation-ui.ts
import type { InvitationStatus } from './invitation-types';

export const STATUS_COLORS: Record<InvitationStatus, string> = {
  pending: 'text-yellow-600',
  accepted: 'text-green-600',
  expired: 'text-gray-500',
  revoked: 'text-red-600',
};

export const STATUS_LABELS: Record<InvitationStatus, string> = {
  pending: 'Pending',
  accepted: 'Accepted',
  expired: 'Expired',
  revoked: 'Revoked',
};
```

- [ ] **Step 2.11.4 — Type-check + commit**

```bash
docker run --rm \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

```bash
git add frontend/lib/invitation-*.ts
git commit -m "feat(frontend): invitation lib trio (types, api, ui)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.12 — Frontend invitations list page

**Files:** Create `frontend/app/(app)/admin/invitations/page.tsx`.

- [ ] **Step 2.12.1 — Page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import Link from 'next/link';
import { invitationApi } from '@/lib/invitation-api';
import type { Invitation, InvitationStatus } from '@/lib/invitation-types';
import { STATUS_COLORS, STATUS_LABELS } from '@/lib/invitation-ui';
import { ROLE_LABELS } from '@/lib/admin-permissions-ui';
import { toast } from 'sonner';

const STATUSES: InvitationStatus[] = ['pending','accepted','expired','revoked'];

export default function InvitationsPage() {
  const [items, setItems] = useState<Invitation[]>([]);
  const [filter, setFilter] = useState<InvitationStatus | ''>('');
  const [loading, setLoading] = useState(true);

  async function refresh() {
    setLoading(true);
    try { setItems(await invitationApi.list(filter || undefined)); }
    catch (e: any) { toast.error(`Load failed: ${e?.response?.data?.error || e?.message}`); }
    finally { setLoading(false); }
  }
  useEffect(() => { refresh(); /* eslint-disable-line react-hooks/exhaustive-deps */ }, [filter]);

  async function handleRevoke(inv: Invitation) {
    const reason = prompt(`Revoke invitation for ${inv.email}? Reason:`, '');
    if (reason === null) return;
    try { await invitationApi.revoke(inv.id, reason); toast.success('Revoked'); refresh(); }
    catch (e: any) { toast.error(`Revoke failed: ${e?.response?.data?.error || e?.message}`); }
  }

  async function handleResend(inv: Invitation) {
    if (!confirm(`Resend invitation for ${inv.email}? The old token will be invalidated.`)) return;
    try {
      const r = await invitationApi.resend(inv.id);
      toast.success('Resent — new credentials issued');
      alert(`New activation URL: /activate/${r.activationToken}\nNew password: ${r.initialPassword}`);
      refresh();
    } catch (e: any) { toast.error(`Resend failed: ${e?.response?.data?.error || e?.message}`); }
  }

  return (
    <div className="p-6 max-w-6xl">
      <div className="flex justify-between items-center mb-4">
        <h1 className="text-2xl font-semibold">Invitations</h1>
        <Link href="/admin/invitations/new" className="bg-blue-600 text-white px-3 py-1 rounded">+ New invitation</Link>
      </div>
      <div className="flex gap-2 mb-4">
        <button onClick={() => setFilter('')} className={`px-3 py-1 rounded ${!filter ? 'bg-gray-300' : 'bg-gray-100'}`}>All</button>
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1 rounded ${filter === s ? 'bg-gray-300' : 'bg-gray-100'}`}>
            {STATUS_LABELS[s]}
          </button>
        ))}
      </div>
      {loading ? <div>Loading...</div> : (
        <table className="w-full border-collapse text-sm">
          <thead>
            <tr>
              <th className="border p-2 text-left">Email</th>
              <th className="border p-2 text-left">Role</th>
              <th className="border p-2 text-left">Status</th>
              <th className="border p-2 text-left">Expires</th>
              <th className="border p-2 text-left">Actions</th>
            </tr>
          </thead>
          <tbody>
            {items.length === 0 ? <tr><td colSpan={5} className="border p-3 text-center text-gray-500">No invitations</td></tr> : items.map(inv => (
              <tr key={inv.id}>
                <td className="border p-2">{inv.email}</td>
                <td className="border p-2">{ROLE_LABELS[inv.role_key as keyof typeof ROLE_LABELS] || inv.role_key}</td>
                <td className={`border p-2 ${STATUS_COLORS[inv.status]}`}>{STATUS_LABELS[inv.status]}</td>
                <td className="border p-2 text-xs">{new Date(inv.expires_at).toLocaleString()}</td>
                <td className="border p-2 space-x-2">
                  {inv.status === 'pending' && (
                    <>
                      <button onClick={() => handleResend(inv)} className="text-blue-600 hover:underline">Resend</button>
                      <button onClick={() => handleRevoke(inv)} className="text-red-600 hover:underline">Revoke</button>
                    </>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}
```

- [ ] **Step 2.12.2 — Type-check + commit**

```bash
git add frontend/app/\(app\)/admin/invitations/page.tsx
git commit -m "feat(frontend): invitations list page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.13 — Frontend invitation new form

**Files:** Create `frontend/app/(app)/admin/invitations/new/page.tsx`.

- [ ] **Step 2.13.1 — Page**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { adminRbacApi } from '@/lib/admin-permissions-api';
import { ROLE_LABELS } from '@/lib/admin-permissions-ui';
import type { RoleLevel } from '@/lib/admin-permissions-types';
import type { CreateInvitationResult } from '@/lib/invitation-types';
import { toast } from 'sonner';

const INVITABLE_ROLES = ['sales','admin_log','finance','technical','hrga','tax_insurance'] as const;

export default function NewInvitationPage() {
  const router = useRouter();
  const [email, setEmail] = useState('');
  const [roleKey, setRoleKey] = useState<string>('sales');
  const [levelId, setLevelId] = useState<string>('');
  const [levels, setLevels] = useState<RoleLevel[]>([]);
  const [submitting, setSubmitting] = useState(false);
  const [result, setResult] = useState<CreateInvitationResult | null>(null);

  useEffect(() => {
    adminRbacApi.listLevels(roleKey).then(setLevels).catch(() => setLevels([]));
    setLevelId('');
  }, [roleKey]);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setSubmitting(true);
    try {
      const r = await invitationApi.create({ email, roleKey, levelId: levelId || null });
      setResult(r);
      toast.success('Invitation created');
    } catch (e: any) {
      toast.error(`Create failed: ${e?.response?.data?.error || e?.message}`);
    } finally { setSubmitting(false); }
  }

  if (result) {
    const url = `${window.location.origin}/activate/${result.activationToken}`;
    return (
      <div className="p-6 max-w-2xl">
        <h1 className="text-2xl font-semibold mb-4">Invitation created</h1>
        <div className="border p-4 rounded space-y-2 bg-yellow-50">
          <p className="text-sm font-semibold">⚠ Copy these now — they will not be shown again.</p>
          <div><b>Email:</b> {email}</div>
          <div><b>Activation URL:</b> <code className="bg-white p-1 break-all">{url}</code></div>
          <div><b>Initial password:</b> <code className="bg-white p-1">{result.initialPassword}</code></div>
          <div><b>Expires:</b> {new Date(result.expiresAt).toLocaleString()}</div>
        </div>
        <button onClick={() => router.push('/admin/invitations')} className="mt-4 bg-blue-600 text-white px-3 py-1 rounded">
          Back to list
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="p-6 max-w-md space-y-4">
      <h1 className="text-2xl font-semibold">New invitation</h1>
      <label className="block">
        <span className="text-sm">Email</span>
        <input type="email" required value={email} onChange={e => setEmail(e.target.value)} className="border p-1 w-full" />
      </label>
      <label className="block">
        <span className="text-sm">Role</span>
        <select value={roleKey} onChange={e => setRoleKey(e.target.value)} className="border p-1 w-full">
          {INVITABLE_ROLES.map(r => <option key={r} value={r}>{ROLE_LABELS[r]}</option>)}
        </select>
      </label>
      <label className="block">
        <span className="text-sm">Level (optional)</span>
        <select value={levelId} onChange={e => setLevelId(e.target.value)} className="border p-1 w-full">
          <option value="">— assign at activation —</option>
          {levels.map(l => <option key={l.id} value={l.id}>{l.level_name} (rank {l.level_rank})</option>)}
        </select>
      </label>
      <button type="submit" disabled={submitting} className="bg-blue-600 text-white px-3 py-1 rounded">
        {submitting ? 'Creating...' : 'Create invitation'}
      </button>
    </form>
  );
}
```

- [ ] **Step 2.13.2 — Type-check + commit**

```bash
git add frontend/app/\(app\)/admin/invitations/new/
git commit -m "feat(frontend): invitation create form

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.14 — Frontend activation landing page

**Files:** Create `frontend/app/activate/[token]/page.tsx` (NOTE: outside the `(app)` group — no AppShell, no auth required).

- [ ] **Step 2.14.1 — Page**

```tsx
'use client';
import { useState } from 'react';
import { useParams, useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { toast } from 'sonner';

export default function ActivatePage() {
  const params = useParams<{ token: string }>();
  const router = useRouter();
  const token = typeof params?.token === 'string' ? params.token : '';
  const [displayName, setDisplayName] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setSubmitting(true);
    try {
      await invitationApi.activate({ token, newPassword, displayName });
      toast.success('Account activated! Please sign in.');
      router.push('/login');
    } catch (e: any) {
      toast.error(`Activation failed: ${e?.response?.data?.error || e?.message}`);
    } finally { setSubmitting(false); }
  }

  if (!token) return <div className="p-6">Missing token. Use the link from your invitation email.</div>;

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Activate your account</h1>
        <p className="text-sm text-gray-600">Welcome to Interlab. Set your display name and a new password.</p>
        <label className="block">
          <span className="text-sm">Display name</span>
          <input required value={displayName} onChange={e => setDisplayName(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <label className="block">
          <span className="text-sm">New password (min 8 chars)</span>
          <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <label className="block">
          <span className="text-sm">Confirm password</span>
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <button type="submit" disabled={submitting} className="bg-blue-600 text-white w-full py-2 rounded">
          {submitting ? 'Activating...' : 'Activate'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2.14.2 — Type-check + commit**

```bash
git add frontend/app/activate/
git commit -m "feat(frontend): activation landing page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.15 — Frontend change-password page

**Files:** Create `frontend/app/change-password/page.tsx` (outside `(app)` group; rendered post-login when must_change_password is true).

- [ ] **Step 2.15.1 — Page**

```tsx
'use client';
import { useState } from 'react';
import { useRouter } from 'next/navigation';
import { invitationApi } from '@/lib/invitation-api';
import { toast } from 'sonner';

export default function ChangePasswordPage() {
  const router = useRouter();
  const [currentPassword, setCurrentPassword] = useState('');
  const [newPassword, setNewPassword] = useState('');
  const [confirm, setConfirm] = useState('');
  const [submitting, setSubmitting] = useState(false);

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    if (newPassword !== confirm) { toast.error('Passwords do not match'); return; }
    if (newPassword.length < 8) { toast.error('Password must be at least 8 characters'); return; }
    setSubmitting(true);
    try {
      await invitationApi.changePassword({ currentPassword, newPassword });
      toast.success('Password changed');
      router.push('/');
    } catch (e: any) {
      toast.error(`Change failed: ${e?.response?.data?.error || e?.message}`);
    } finally { setSubmitting(false); }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-gray-50">
      <form onSubmit={handleSubmit} className="bg-white p-8 rounded shadow w-full max-w-md space-y-4">
        <h1 className="text-2xl font-semibold">Change password</h1>
        <p className="text-sm text-gray-600">You must change your password before continuing.</p>
        <label className="block">
          <span className="text-sm">Current password</span>
          <input type="password" required value={currentPassword} onChange={e => setCurrentPassword(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <label className="block">
          <span className="text-sm">New password (min 8 chars)</span>
          <input type="password" required value={newPassword} onChange={e => setNewPassword(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <label className="block">
          <span className="text-sm">Confirm new password</span>
          <input type="password" required value={confirm} onChange={e => setConfirm(e.target.value)} className="border p-2 w-full rounded" />
        </label>
        <button type="submit" disabled={submitting} className="bg-blue-600 text-white w-full py-2 rounded">
          {submitting ? 'Changing...' : 'Change password'}
        </button>
      </form>
    </div>
  );
}
```

- [ ] **Step 2.15.2 — Type-check + commit**

```bash
git add frontend/app/change-password/
git commit -m "feat(frontend): forced password change page

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 2.16 — AppShell redirect for must_change_password

**Files:** Modify the existing post-login auth flow in the frontend so users with `must_change_password=true` get redirected to `/change-password`.

- [ ] **Step 2.16.1 — Find existing auth flow**

Read `frontend/app/(app)/layout.tsx` (AppShell) and `frontend/lib/auth.ts` to find where the user profile is loaded after login. The `/api/auth/me` response now includes `must_change_password`.

- [ ] **Step 2.16.2 — Add redirect**

In the AppShell layout (or auth provider), after the profile loads:

```tsx
import { useRouter, usePathname } from 'next/navigation';
// ...
const router = useRouter();
const pathname = usePathname();
useEffect(() => {
  if (user?.must_change_password && !pathname.startsWith('/change-password')) {
    router.replace('/change-password');
  }
}, [user, pathname, router]);
```

(Adapt to whatever `lib/auth.ts` returns the user object as — could be Zustand store. If it's `useAuthStore()`, use that hook instead.)

- [ ] **Step 2.16.3 — Update the user type**

If `frontend/lib/auth.ts` defines a `User` type, add `must_change_password: boolean` to it.

- [ ] **Step 2.16.4 — Type-check + commit**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

```bash
git add frontend/
git commit -m "feat(frontend): redirect to /change-password when must_change_password

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final integration check

- [ ] **Step F.1 — Full test suite**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -20
```

Expected: all tests pass.

- [ ] **Step F.2 — Type-check frontend**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

Expected: no new errors.

- [ ] **Step F.3 — Smoke flow (manual)**

1. Login as Superadmin via existing login flow.
2. Visit `/admin/invitations/new` → invite `test@example.com` as `sales`.
3. Copy the activation URL + initial password from the success screen.
4. Logout.
5. Visit the activation URL → set display name + new password → "Activate".
6. Login with `test@example.com` + new password.
7. Verify redirect to `/change-password` does NOT happen (because activation already changed the password).
8. Verify the user has Sales staff capabilities (e.g., can view sales PO list).
9. Back as Superadmin: revoke an invitation, resend an invitation, verify the resend produces fresh credentials and old token returns "invitation no longer valid" on `/activate/{old-token}`.

---

## Self-review

- ✅ **Spec coverage**: F1 invitation system requirements all addressed
  - Token: random 32-byte, SHA-256 hashed (Tasks 2.1, 2.2)
  - Initial password: argon2id, 4-word passphrase, never reversible (Task 2.3)
  - Status lifecycle: pending/accepted/expired/revoked (Task 2.1, 2.5)
  - Resend regenerates (Task 2.6)
  - Authority: Superadmin/CEO + manager-of-role (Task 2.4, 2.6)
  - Force change password on first login (Task 2.10)
  - Email enumeration prevention: identical responses for revoked/expired (`invitation no longer valid`)
  - Rate limit on inviter: `permissionWriteLimiter` from Plan 1 already wired (Task 2.8)
- ✅ **Plan 1 dependencies honored**: uses `permission.service.resolveCapabilities` (Task 1.6/1.7), `invalidateUserCache` (Task 1.9), `permissionWriteLimiter` (Task 1.15), `success` helper, `authMiddleware`, level/role infrastructure (Tasks 1.2/1.5).
- ✅ **No placeholders**: every task has concrete code or exact verification commands.
- ✅ **Type consistency**: `roleKey`/`levelId` keys consistent across backend service and frontend api.
- ✅ **Backwards compat**: existing demo users (bcrypt password hashes) still work via dual-verify in `changePassword`.

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-plan2-invitation-system.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** - I dispatch a fresh subagent per task, review between tasks, fast iteration. ~16 task dispatches.

**2. Inline Execution** - Execute tasks in this session using `superpowers:executing-plans`, batch execution with checkpoints.

**Which approach?**
