# Sub-1 — Foundation: Accounts & Permissions (Design)

- **Date:** 2026-05-26
- **Working dir:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo` (infra-repo consolidated copy; commits land in the `interlab-infra` repo)
- **Target env:** local dev → shared staging via Tailscale (`npm run dev` locally, DB + MinIO remote)
- **Status:** approved design, pre-implementation

---

## 0. Context: this is a delta on a mature codebase

The originating request ("MVP Extension: PO Tracking, Dynamic Roles, 2FA, Multi-Payment,
Communication Channel") is written greenfield-style, but the webapp already implements
~60% of it. Following the spec literally would create **duplicate tables** and parallel
endpoints. After exploring the codebase we agreed on a **REUSE principle** and a
**4-sub-project decomposition**. This document covers **Sub-1 only**.

### REUSE principle (binds all sub-projects)
Reuse what exists (2FA, `user_invitations`, RBAC `roles`/`role_levels`/`role_permissions`/
`feature_definitions`/`capability_definitions`, `chat_*`, `notifications`) and **only add**
columns / feature-rows / endpoints. The spec's proposed duplicate tables
(`role_feature_permissions`, `conversations`, `conversation_participants`, `messages`) are
**not created**; the spec is mapped onto existing structures. This also honors the hard rule
"don't rename/remove existing features."

### Decomposition (each gets its own spec → plan → implement)
1. **Sub-1 — Foundation: Accounts & Permissions** *(this doc — small)*
2. **Sub-2 — PO Type & Multi-cycle (backend)** *(risky: generalizes the hardcoded 11-stage state machine in `po.service.js`, additively)*
3. **Sub-3 — PO Tracking UI + Finalization Gate** *(demo centerpiece; adds a chart library + react-pdf)*
4. **Sub-4 — Dummy Data Seeder** *(depends on Sub-1 + Sub-2)*

### Credential / config corrections to the original spec (apply throughout)
- DB login is **`interlab_staging01`** owning **`interlab_db_staging`**, not `supabase_admin`/`interlab_staging`.
  `DATABASE_URL=postgresql://interlab_staging01:<pw>@127.0.0.1:5440/interlab_db_staging`.
- MinIO bucket env names must match `backend/src/config/env.js`: `MINIO_BUCKET_ATTACHMENTS` /
  `MINIO_BUCKET_AVATARS` (or shared `MINIO_BUCKET`/`S3_BUCKET`) — **not** the spec's
  `MINIO_BUCKET_PRIVATE`/`MINIO_BUCKET_PUBLIC`.

---

## 1. Sub-1 scope

What Sub-1 delivers:
1. Remap the 8 seed accounts to the real emails, resolve the superadmin↔CEO swap, assign the
   6 division users the **manager (rank-2)** level, and drive passwords from `SEED_PW_*` env.
2. Add a **recovery-password** mechanism (`users.backup_password_hash`) + an admin
   "reset to backup" endpoint — without changing the existing activation-link invite flow.
3. Apply the **minimal RBAC matrix adjustment** (trim `advance_stage` from hrga/tax) and add a
   `reset_user_password` capability.
4. Add a **soft, UI-only** "superadmin/CEO must enable 2FA before inviting" gate.
5. Wire `.env` / `.env.example` for the local-dev → staging target.

Non-goals (handled in later sub-projects, or already done):
- The 2FA flow itself — already fully implemented (`two_factor.service.js`, `/login/2fa`).
- PO type / multi-cycle (Sub-2), PO tracking UI (Sub-3), dummy data (Sub-4).
- No `is_manager` / `department` columns (modeled via `role_levels` + `role`).
- No hard backend block on the 2FA-before-invite rule (spec says soft / UI).

---

## 2. Modeling decisions (resolved)

- **"manager" = `role_levels` rank-2.** A user is a manager when `user.level_id` points to the
  role's rank-2 level (`{role}_manager`, seeded with `data_scope_default='role'`). Add a helper
  `isManager(user)` (resolves the user's level and checks `level_rank >= 2`). No `is_manager` column.
- **"department" = the role itself** (`sales`, `finance`, …). No `department` column.
- **Recovery = hybrid.** Keep the existing activation-link invite (invitee sets their own
  password). Add `users.backup_password_hash` as the recovery lever; superadmin can only **reset
  to backup**, never view plaintext.

---

## 3. Data model change — one migration

**`backend/migrations/030_backup_password.sql`** (must contain both `-- +migrate Up` and
`-- +migrate Down` markers, per the runner contract):

```sql
-- +migrate Up
ALTER TABLE users ADD COLUMN IF NOT EXISTS backup_password_hash text NULL;

-- +migrate Down
ALTER TABLE users DROP COLUMN IF EXISTS backup_password_hash;
```

No `is_manager`, `department`, `conversations`, `role_feature_permissions`, etc.

---

## 4. Seeder changes — `backend/scripts/seed.js`

### 4.1 Remap the 8 accounts
Replace the `USERS` array. Roles are unchanged; emails + level assignment change:

| Role | Email | Level (rank) |
|---|---|---|
| superadmin | zakyindrasatriaputra@gmail.com | — (bypass resolver) |
| ceo | zakyindrasatriap@gmail.com | — (bypass resolver) |
| sales | putra.zakyindras@gmail.com | manager (2) |
| admin_log | adminlog@issi-interlab.com | manager (2) |
| finance | zaky.putra@integrity-indonesia.com | manager (2) |
| technical | pancaaindrawati@gmail.com | manager (2) |
| hrga | pancaindrawati27@gmail.com | manager (2) |
| tax_insurance | pancaindrawati2704@gmail.com | manager (2) |

Note the swap: the email previously seeded as superadmin (`zakyindrasatriap@gmail.com`) becomes
**CEO**; the new superadmin is `zakyindrasatriaputra@gmail.com`.

### 4.2 Passwords from `SEED_PW_*`
- Each account's password = `process.env.SEED_PW_{ROLE}` (e.g. `SEED_PW_SUPERADMIN`,
  `SEED_PW_ADMINLOG`, `SEED_PW_TAX`), hashed with bcrypt. Fall back to `DEMO_PASSWORD` when a
  `SEED_PW_*` is unset so local dev still works without filling all eight.
- Map role → env var explicitly (role keys use `admin_log`/`tax_insurance`; env uses
  `SEED_PW_ADMINLOG`/`SEED_PW_TAX`).

### 4.3 Manager level assignment
- The 6 division users get the **rank-2 manager** `level_id` (currently the backfill assigns
  rank-1 staff). The existing `MANAGER_LEVELS` seed block already creates the rank-2 levels;
  change the user backfill to select rank-2 for these seeded division users.
- Superadmin/CEO keep `level_id = NULL` (resolver bypass) — unchanged.

### 4.4 Seed `backup_password_hash`
- For each seeded account set `backup_password_hash = bcrypt(SEED_PW_{ROLE})` (same value as the
  active password at seed time). "Reset to backup" therefore returns the account to the
  operator-known seed password.
- Keep the upsert idempotent (`ON CONFLICT (email) DO UPDATE`), now also setting
  `backup_password_hash`.

### 4.5 Idempotency note
On the fresh `interlab_db_staging` this is clean. If the DB had been seeded with the old
`*@interlab-portal.com` demo rows, those rows are **not** auto-removed by the email remap (they
become orphaned, inactive-by-neglect). Acceptable for fresh staging; optional cleanup can delete
non-listed `*@interlab-portal.com` demo users if desired.

---

## 5. Backend changes (additive)

### 5.1 Extend the invite flow for recovery password
The invite already generates an initial password: `invitation.service.js#create` stores
`user_invitations.initial_password_hash`, and `accept` creates the user row with
`must_change_password=true`. Two additive changes:
- **`create` (`POST /api/admin/invitations`)**: return the generated initial password
  **plaintext exactly once** in the create response, so the frontend can show it in a
  toast/modal ("backup recovery password — shown once"). It is never returned again.
- **`accept`**: copy `user_invitations.initial_password_hash` → `users.backup_password_hash`
  on the newly created user. (Plaintext is never persisted; only the hash moves.)

### 5.2 Reset-to-backup endpoint
- **`POST /api/admin/reset-to-backup`** (body: `{ userId }`). (Mounted under `/api/admin`
  alongside the other admin RBAC routes — `invitations`, `permissions`, etc. — rather than
  under `/api/auth`, since it is an admin action gated by `admin_rbac` capabilities.)
- Authz: new capability **`reset_user_password`** on the `admin_rbac` feature; held by
  superadmin/CEO (via resolver bypass) and grantable to managers later if needed. For Sub-1,
  superadmin/CEO only.
- Behavior: set target `users.password_hash = users.backup_password_hash`,
  `must_change_password = true`, write an `activity_logs` row (actor, target user, action
  `auth.password.reset_to_backup`). Returns no password material.
- There is **no** "view password" endpoint. Superadmin cannot read any plaintext password.

### 5.3 New capability registration
Add `['reset_user_password', 'Reset user password to backup']` to the seeder's capability
registry (idempotent `ON CONFLICT DO NOTHING`).

---

## 6. RBAC matrix mapping (mostly already correct)

Map the spec's §3.3 matrix onto existing rows. The only behavioral change:
- **Trim `advance_stage`** (on `sales_po`) from **hrga** and **tax_insurance** — the seeder
  currently grants it to all six division roles, but the spec wants hrga/tax to be read-only for
  PO context. Remove these two roles from that grant loop.

Everything else maps to existing structures (no new tables, no new feature keys):

| Spec matrix item | Existing mapping |
|---|---|
| `po_tracking_view_all` (superadmin, ceo) | resolver bypass (see everything) |
| `po_tracking_view_scoped` (division roles) | `po_tracking` feature, `view_own` granted to all division roles |
| `po_advance_stage` (superadmin, sales, admin_log, finance, technical) | `advance_stage` cap on `sales_po`; **trim hrga/tax** |
| `user_invite` any (superadmin, ceo) | resolver bypass |
| `user_invite` own-dept (managers) | `invite_user` cap on `admin_rbac`, granted to rank-2 managers; same-role scope enforced in `invitation.service.js` |
| `comm_channel` (all) | `chat` feature, `view_own` for all roles |
| `notifications` (all) | `notifications` feature, `view_own` for all roles |

Known acceptable divergence: CEO bypasses the resolver, so CEO technically *can* advance stages
even though the spec's matrix marks `po_advance_stage` "–" for CEO. We keep the bypass model
(consistent with the codebase invariant); CEO simply won't be a stage owner in practice. Noted,
not blocking.

---

## 7. 2FA-before-invite (soft, UI-only)

- Frontend: on the invite page/button, if the current user is `superadmin`/`ceo` **and**
  `two_factor_method === 'disabled'`, disable the invite action and show a prompt linking to the
  Security settings to enable 2FA.
- No backend hard-block (spec explicitly says soft enforcement in UI). The `two_factor_method`
  is already available on the authenticated user payload.

---

## 8. `.env` / `.env.example` (app repo-root)

The backend reads the **repo-root** `.env` via `backend/src/config/env.js`. Update
`.env.example` with the staging block (real values go in the gitignored `.env`):

```
# ── Postgres (staging via Tailscale SSH local-forward) ──
DATABASE_URL=postgresql://interlab_staging01:${DB_PASSWORD}@127.0.0.1:5440/interlab_db_staging
DB_PASSWORD=
SSH_HOST=100.117.214.25
SSH_PORT=2223
SSH_USER=zaky

# ── MinIO Global (names aligned to env.js; NOT the spec's PRIVATE/PUBLIC) ──
MINIO_ENDPOINT=http://100.117.214.25:9101
MINIO_ACCESS_KEY=mgroot_8c8e8edb
MINIO_SECRET_KEY=
MINIO_BUCKET_ATTACHMENTS=interlab-private
MINIO_BUCKET_AVATARS=interlab-public

# ── 2FA ──
TOTP_ISSUER=Interlab ISSI
# TOTP secret-encryption key (required when any user enables TOTP) — see env.js
TOTP_ENCRYPTION_KEY=

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

At implement time, confirm exact `env.js` names for the TOTP encryption key and bucket vars and
match them precisely. Do not commit real secrets (Pilihan B: `.env` gitignored + Bitwarden).

---

## 9. Testing / Definition of Done (Sub-1)

1. **No regression** on existing login + captcha + remember-me + forgot-password — manual smoke
   test (and/or a minimal vitest hitting the auth routes).
2. **8 accounts log in**; each lands on its dashboard and sees only permitted menus
   (manual + a vitest unit on the RBAC resolver for a division-manager vs superadmin).
3. **Invite scope**: a division manager can invite only their own role (server returns 403 for
   other roles); superadmin can invite any role.
4. **Recovery**: `reset-to-backup` lets the target log in with the backup password and is then
   forced to change it (`must_change_password`); an `activity_logs` row is written.
5. **Invite create** returns the initial password plaintext exactly once; subsequent reads never
   expose it.
6. **2FA gate**: with 2FA disabled, the superadmin/CEO invite action is disabled in the UI.

Verification uses real commands (`node scripts/migrate.js`, `node scripts/seed.js`,
`npm run dev`, vitest) against `interlab_db_staging` over the tunnel — evidence before claiming done.

---

## 10. Risks & notes
- **Orphaned demo rows** if the staging DB was previously seeded with `*@interlab-portal.com`
  (see §4.5). Mitigation: optional cleanup, or accept on fresh DB.
- **CEO bypass vs. matrix** (see §6) — accepted divergence.
- **MinIO bucket naming** must be reconciled with `env.js` at implement time (§8); the spec's
  names are wrong.
- Sub-1 touches `seed.js`, `invitation.service.js`, the auth routes, one migration, the RBAC
  grant loops, and a frontend invite-button guard — all additive; no renames/removals.
</content>
</invoke>
