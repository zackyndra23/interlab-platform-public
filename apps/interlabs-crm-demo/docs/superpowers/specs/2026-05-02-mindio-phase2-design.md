# MindIO Interlab Phase 2 — Design Spec

**Date:** 2026-05-02
**Project:** `interlabs-crm-demo` (extending existing codebase)
**Mode:** Option A — extend existing implementation, additive only, no rebuild
**Owner:** Zaky / PT. Interlab Sentra Solutions Indonesia

---

## 1. Scope

This spec defines the design for five Phase 2 features built on top of the existing `interlabs-crm-demo` codebase. All work is **additive**: existing tables, services, and routes remain in place; new tables and services extend them.

The five features:

1. **F1 — Email Invitation & Account Activation** (net-new)
2. **F2 — Dynamic Role-Based Permission System** (extend existing RBAC)
3. **F3 — Avatar Upload via S3/MinIO** (net-new flow on top of existing storage)
4. **F4 — Global PO Document → Stage Trigger Map** (extend existing 11-stage PO lifecycle)
5. **F5 — Dynamic Notification with Configurable Sender** (extend existing notification gateway)

### Non-goals

- Rebuilding the 8-role RBAC matrix, the 11-stage PO lifecycle, the chat/channel system, the `email_queue` outbox, or the `file_attachments` storage layer. All exist and are reused.
- Replacing the existing notification gateway (`services/notification.service.js`) — only extending it.
- Changing the canonical 11-stage PO lifecycle (`Registered → Processed → Production → Shipped → Customs → Arrived → Inspected → Delivery → Installation → BAST → Invoice`). The user confirmed this stays.

---

## 2. Architectural decisions (locked from brainstorming)

| Decision | Choice | Why |
|---|---|---|
| Project identity | Extend `interlabs-crm-demo` (Option A) | Existing codebase already has 70%+ overlap with the requested features |
| PO lifecycle | Keep 11 stages including `Arrived` | Non-negotiable per `CLAUDE.md`; user confirmed |
| Permission model | Hybrid B+C+D — per-(role, level) template **+** within-role inheritance **+** data scope by level | User selected; covers all use cases |
| Level scope | Per-role independent levels with free-form names | User selected; each division uses its own nomenclature |
| Level CRUD authority | Top-rank Manager (within own role) **plus** Superadmin/CEO | User selected |
| CEO/Superadmin level | Bypass — no `level_id`, always treated as global scope, all capabilities granted | User selected |
| Per-user override | Both `grant` and `deny`, with `deny` always winning over `grant` | User selected |
| Cross-department interaction | Explicit `cross_dept_grants` table per (grantee, target_role, feature, capability) | User selected; auditable, fits existing chat/channel model |
| Initial password storage | Hash with argon2id (preferred) or bcrypt cost 12; **never** reversible. Resend regenerates a new token + password | Best practice; user explicitly asked for hashing-vs-encryption clarification |

---

## 3. Permission Resolution Engine (heart of F2)

### Capabilities formula

```
final_capabilities(user, feature) =
    if user.role ∈ {superadmin, ceo}:
        return ALL_CAPABILITIES                                          // bypass

    result = ∅

    // Step 2 — Template + within-role inheritance (B + C)
    result ∪= role_permissions
              WHERE role_id     = user.role_id
                AND level_id   IN (SELECT id FROM role_levels
                                     WHERE role_id    = user.role_id
                                       AND level_rank ≤ user.level_rank)
                AND feature_id  = feature.id

    // Step 3 — Per-user grant
    result ∪= user_capability_overrides
              WHERE user_id       = user.id
                AND feature_id    = feature.id
                AND override_type = 'grant'
                AND revoked_at   IS NULL
                AND (expires_at  IS NULL OR expires_at > now())

    // Step 4 — Cross-dept grant (adds capability for this user on this feature)
    result ∪= cross_dept_grants
              WHERE grantee_user_id = user.id
                AND feature_id      = feature.id
                AND revoked_at     IS NULL
                AND (expires_at    IS NULL OR expires_at > now())

    // Step 5 — Per-user deny (ALWAYS LAST; deny wins over grant + cross-dept)
    result -= user_capability_overrides
              WHERE user_id       = user.id
                AND feature_id    = feature.id
                AND override_type = 'deny'
                AND revoked_at   IS NULL
                AND (expires_at  IS NULL OR expires_at > now())

    return result
```

### Data scope formula (separate from capabilities)

```
data_scope(user, feature) =
    base = level.data_scope_default               // own | team | role | global

    // Cross-dept grant: when accessing a record owned by another role's user,
    // bump scope to 'role' for records whose owner_role matches a granted target_role.
    granted_target_roles = SELECT target_role_key FROM cross_dept_grants
                             WHERE grantee_user_id = user.id
                               AND feature_id      = feature.id
                               AND revoked_at IS NULL
                               AND (expires_at IS NULL OR expires_at > now())
    // applied at query time as: WHERE record.owner_role = user.role
    //                              OR record.owner_role = ANY(granted_target_roles)

    return base                                   // CEO/Superadmin always 'global'
```

with rank `own (1) < team (2) < role (3) < global (4)`. CEO/Superadmin bypass always returns `global`.

### Resolution order (deterministic, fixed)

1. **CEO/Superadmin bypass** — return all capabilities, scope `global`
2. **Template + within-role inheritance** — union of `role_permissions` rows where `level_rank ≤ user.level_rank` for the same role
3. **Per-user grant override** — union with `user_capability_overrides` (active, not expired) of type `grant`
4. **Cross-department grant** — union with `cross_dept_grants` (active, not expired) for this user/feature
5. **Per-user deny override** — set difference; subtracted **last** so deny always wins

Step 5 is non-commutative with steps 3 and 4. Implementations must apply deny in this order or behavior diverges from spec.

### Caching

- Redis key `perm:user:{user_id}` TTL 5 minutes
- Explicit invalidation triggers: write to `role_permissions`, `role_levels`, `user_capability_overrides`, `cross_dept_grants`, or change to `users.role` / `users.level_id`
- Existing codebase does not yet use Redis for RBAC — this is net-new but is one shared module, not per-feature

---

## 4. Database Schema (net-new, all additive)

> **Migration numbering note:** the migration filenames below (`017_*` through `024_*`) are illustrative, presented in feature order F1 → F5 for readability. The **actual migration sequence at implementation time follows Section 8's sprint order** — F2 lands first, then F1, F3, F4, F5. The runtime constraint that forces this ordering: `user_invitations.level_id` references `role_levels(id)`, so `role_levels` must migrate before `user_invitations`. The implementer assigns concrete numbers at execution time.

### F1 — Invitation system

Migration: `017_user_invitations.sql` (illustrative; actual number ≥ 020 because F2 migrations land first per Section 8)

```sql
CREATE TABLE user_invitations (
    id                    uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    email                 text         NOT NULL,
    role_key              text         NOT NULL REFERENCES roles(role_key),
    level_id              uuid         NULL REFERENCES role_levels(id),
    invited_by_user_id    uuid         NOT NULL REFERENCES users(id) ON DELETE RESTRICT,
    inviter_role_key      text         NOT NULL,
    activation_token_hash text         NOT NULL,                 -- SHA-256 of random 32-byte token
    initial_password_hash text         NOT NULL,                 -- argon2id or bcrypt cost 12
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
```

Also add to `users`:

```sql
ALTER TABLE users ADD COLUMN must_change_password boolean NOT NULL DEFAULT false;
```

### F2 — Levels + dynamic permissions + cross-dept

Migration: `018_role_levels.sql`

```sql
CREATE TABLE role_levels (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    role_id            uuid         NOT NULL REFERENCES roles(id) ON DELETE CASCADE,
    level_key          text         NOT NULL,
    level_name         text         NOT NULL,
    level_rank         int          NOT NULL,                       -- 1=lowest, monotonic per role
    data_scope_default text         NOT NULL DEFAULT 'own',
    created_at         timestamptz  NOT NULL DEFAULT now(),
    updated_at         timestamptz  NOT NULL DEFAULT now(),
    deleted_at         timestamptz  NULL,
    CONSTRAINT role_levels_unique_key UNIQUE (role_id, level_key),
    CONSTRAINT role_levels_unique_rank UNIQUE (role_id, level_rank),
    CONSTRAINT role_levels_scope_chk CHECK (data_scope_default IN ('own','team','role','global'))
);

ALTER TABLE users ADD COLUMN level_id uuid NULL REFERENCES role_levels(id);

-- Extend role_permissions to be (role, level)-aware. Backfill: every existing
-- row gets the lowest-rank level per role; then SET NOT NULL.
ALTER TABLE role_permissions ADD COLUMN level_id uuid NULL REFERENCES role_levels(id);
-- (post-backfill) ALTER COLUMN level_id SET NOT NULL;
-- (post-backfill) DROP CONSTRAINT role_permissions_triple_unique;
-- (post-backfill) ADD CONSTRAINT role_permissions_quad_unique UNIQUE (role_id, level_id, feature_id, capability_id);
```

Migration: `019_user_capability_overrides.sql`

```sql
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
```

Migration: `020_cross_dept_grants.sql`

```sql
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
```

### F3 — Avatar upload

Migration: `021_user_avatars.sql`

```sql
ALTER TABLE users
    ADD COLUMN avatar_file_id    uuid NULL REFERENCES file_attachments(id) ON DELETE SET NULL,
    ADD COLUMN avatar_updated_at timestamptz NULL;
```

No new table — reuses `file_attachments` with `related_module='users'`, `related_entity_id=user.id`. Storage path convention: `avatars/users/{user_id}/{hash}.webp`. Default fallback: `avatars/defaults/{role}.png` (already in the MinIO bucket per `CTX_architecture.txt`).

### F4 — PO document → stage trigger map

Migration: `022_po_document_types.sql`

```sql
CREATE TABLE po_document_types (
    id                 uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    doc_key            text         NOT NULL UNIQUE,
    doc_name           text         NOT NULL,
    triggers_stage     text         NULL,                  -- which stage_code this doc triggers
    required_for_stage text         NULL,                  -- stage cannot advance without this doc
    uploader_role_keys jsonb        NOT NULL DEFAULT '[]'::jsonb,
    is_active          boolean      NOT NULL DEFAULT true,
    created_at         timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT po_document_types_triggers_chk CHECK (triggers_stage IS NULL OR triggers_stage IN (
        'Registered','Processed','Production','Shipped','Customs','Arrived',
        'Inspected','Delivery','Installation','BAST','Invoice'))
);

ALTER TABLE file_attachments
    ADD COLUMN po_document_type_id uuid NULL REFERENCES po_document_types(id);

ALTER TABLE purchase_order_status_history
    ADD COLUMN is_rejection         boolean NOT NULL DEFAULT false,
    ADD COLUMN is_admin_override    boolean NOT NULL DEFAULT false,
    ADD COLUMN reject_count_after   int     NULL;
```

Seed `po_document_types` rows (initial mapping):
- `awb` → triggers `Shipped`, uploader `[admin_log]`
- `arrival_doc` → triggers `Arrived`, uploader `[admin_log]`
- `do` → triggers `Delivery`, uploader `[admin_log]`
- `pr_po_out` → triggers `Production`, uploader `[finance]`
- `bast` → triggers `BAST`, uploader `[technical]`
- `invoice_customer` → triggers `Invoice`, uploader `[finance]`

### F5 — Dynamic notification sender + multi-recipient

Migration: `023_notification_senders.sql`

```sql
CREATE TABLE notification_senders (
    id                  uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    sender_key          text         NOT NULL UNIQUE,
    display_name        text         NOT NULL,
    from_email          text         NOT NULL,
    reply_to_email      text         NULL,
    provider            text         NOT NULL,
    provider_config_key text         NOT NULL,                 -- pointer to app_settings row
    is_active           boolean      NOT NULL DEFAULT true,
    created_at          timestamptz  NOT NULL DEFAULT now(),
    updated_at          timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_senders_provider_chk CHECK (provider IN ('smtp','gmail','ses','postmark','resend'))
);

ALTER TABLE notification_templates
    ADD COLUMN sender_id uuid NULL REFERENCES notification_senders(id);
```

Migration: `024_notification_template_extras.sql`

```sql
CREATE TABLE notification_template_extra_recipients (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    created_at   timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_template_extra_recipients_unique UNIQUE (template_id, user_id)
);

CREATE TABLE notification_user_mutes (
    id           uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id      uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    template_id  uuid         NOT NULL REFERENCES notification_templates(id) ON DELETE CASCADE,
    muted_at     timestamptz  NOT NULL DEFAULT now(),
    CONSTRAINT notification_user_mutes_unique UNIQUE (user_id, template_id)
);
```

---

## 5. Security: hashing vs encryption (resolves F1 user concern)

**Use hashing, not encryption, for passwords.**

| Aspect | Hashing (bcrypt / argon2id) | Encryption (AES) |
|---|---|---|
| Reversible? | No (one-way) | Yes |
| Suitable for passwords? | Yes — best practice | No — anti-pattern |
| If DB leaks? | Attacker faces work-factor cost (e.g. bcrypt cost 12) | Attacker who recovers the key decrypts every password |
| Resend password? | No, and must not | Yes, but opens attack surface |

**Resend flow (when user loses initial password):** do NOT decrypt the old hash. Instead, `POST /api/admin/invitations/:id/resend` regenerates a new token + new initial password, marks the old invitation row `revoked`, and emails the new credentials.

The plaintext initial password exists only for the duration of the single email send call; it is never stored in plaintext, logs, or memory beyond that.

---

## 6. Email provider strategy

Build a provider abstraction in `backend/src/services/email-providers/`:

```
email-providers/
├── factory.js      // resolves notification_senders.provider → adapter
├── smtp.js         // wraps existing nodemailer SMTP path
├── gmail.js        // Gmail SMTP via app password (dev/demo only)
├── ses.js          // AWS SES (recommended for production)
├── postmark.js     // alternative
└── resend.js       // alternative
```

Default provider mapping:

| Environment | Provider | Reason |
|---|---|---|
| Development / demo | `smtp` or `gmail` | Easy setup, low volume |
| Production VPS | `ses` (recommended) | Unlimited scale, $0.10/1k, bounce/complaint webhooks |

The existing `email_queue` table remains the outbox. The dispatch worker reads pending rows, looks up the sender row's provider, and routes through the adapter. **No business code touches the provider directly** — they all call `notification.service.emit()`.

---

## 7. Top-3 risks per feature

### F1 — Invitation
1. **Email enumeration** via response-shape leakage. Mitigation: identical 200-OK response for valid/invalid emails on lookup endpoints; per-IP rate limit 5/min on activation lookup.
2. **Token replay**. Mitigation: one-shot tokens (mark used after acceptance), 48h expiry, revocable.
3. **Manager invitation abuse** (mass spam). Mitigation: per-inviter rate limit 10/h, 50/day, audited via `activity_logs`.

### F2 — Permission system
1. **Resolution non-determinism**. Mitigation: fixed resolution order (template → grant → cross-dept → deny), unit tests for each step.
2. **Cache staleness**. Mitigation: 5-minute TTL plus explicit invalidation on every write that affects resolution.
3. **Privilege escalation via grant override**. Mitigation: capability `override_grant` is itself a capability; default-granted only to CEO/Superadmin.

### F3 — Avatar
1. **Stored XSS via SVG upload**. Mitigation: whitelist `image/jpeg|png|webp`; reject SVG.
2. **DoS via giant image**. Mitigation: presigned URL with content-length limit (5 MB); backend re-validates after upload.
3. **PII leak via EXIF**. Mitigation: backend resize + EXIF strip via sharp; final stored image is metadata-clean webp.

### F4 — PO
1. **Race on stage transition**. Mitigation: `SELECT … FOR UPDATE` on `purchase_orders` row inside the transition transaction; verify `current_status` before advancing.
2. **Document-stage map drift**. Mitigation: startup validator scans `po_document_types.triggers_stage` against the canonical 11-stage enum; fail fast.
3. **Reject loop**. Mitigation: `reject_count_after` column with threshold; over threshold escalates to Superadmin via notification template.

### F5 — Notification
1. **Email bombardment**. **MVP mitigations**: (a) the `notification_user_mutes` table lets users opt out per-template; (b) per-(template, recipient, entity_id) deduplication window of 60 seconds at `notification.service.emit()` time, so 50 file-uploads in a row on one PO produce at most one email per recipient per minute. **Backlog**: full digest mode (immediate / hourly / daily per-user toggle) — Sprint 6+, see Q11.
2. **Sender impersonation**. Mitigation: prefer providers that verify domain (SES/Postmark); UI warning when SMTP custom sender is used.
3. **Queue backlog stuck**. Mitigation: max 5 attempts with exponential backoff, dead-letter to `failed`, dashboard alert for Superadmin.

---

## 8. Implementation order

### Sprint 0 — Foundation (shared modules)

Build before any feature work:

- `backend/src/services/permission.service.js` — resolution engine + Redis cache
- `backend/src/services/email-providers/` — provider abstraction
- Extend `backend/src/services/activity_log.service.js` — new event types for invitations, overrides, level CRUD, sender changes
- Extend rate-limit middleware

### Sprint 1 — F2 Permission system core

- Migrations: `role_levels` (and add `users.level_id`, extend `role_permissions` with `level_id`), `user_capability_overrides`, `cross_dept_grants`. These are the **first** new migrations to land — see Section 4 numbering note.
- Services: `role_level.service.js`, `permission_override.service.js`
- Update `middleware/rbac.js` to call `permission.service.resolveCapabilities()`
- Seed: a top-rank Manager level + lowest-rank Staff level for each of the 6 invitable roles
- Frontend: `admin/permissions`, `admin/levels`, `admin/users/[id]/overrides`

### Sprint 2 — F1 Invitation system

- Migration: `user_invitations`
- Services: `invitation.service.js`
- Routes: `POST /api/admin/invitations`, `POST /accept`, `POST /:id/revoke`, `POST /:id/resend`
- Email template `invitation_pending` registered into `notification_templates`
- Frontend: `admin/invitations`, `admin/invitations/new`, `activate/[token]`
- Login flow: post-login check `must_change_password` → force redirect to change-password page

### Sprint 3 — F3 Avatar upload

- Migration: `user_avatars`
- Backend endpoints: presign, commit (download/validate/resize/re-upload), get
- Frontend: `<AvatarUploader />` component + integration in topbar/profile

### Sprint 4 — F4 PO document → stage trigger map

- Migration: `po_document_types` + `file_attachments.po_document_type_id` + `purchase_order_status_history.is_rejection / is_admin_override / reject_count_after`
- Update `services/po.service.js`: `advanceStage`, `rejectStage`, `adminOverrideStage`
- Wire file upload → stage advance (post-insert hook)
- RBAC: register new generic capability keys in `capability_definitions` — `advance_stage`, `reject_stage`, `admin_override_stage`. Permissions are then attached to `(role, level, feature='purchase_orders', capability)` tuples in `role_permissions` (consistent with existing capability registry pattern; capability keys themselves are feature-agnostic).
- Seed `po_document_types` rows (AWB, DO, PR-PO-Out, BAST, Invoice Customer, etc.)

### Sprint 5 — F5 Dynamic notification + sender

- Migrations: `notification_senders`, `notification_template_extras`
- Service: `notification_sender.service.js`
- Update `notification.service.js`: resolve sender, expand recipients (roles + extras − mutes), enqueue per recipient via provider abstraction
- Optional webhook endpoints: `/api/webhooks/email/{provider}` for bounce/complaint
- Frontend: `admin/notifications/senders`, `admin/notifications/templates/[id]`, `profile/notifications` (mute toggles)

### Parallelism opportunities

After Sprint 1, Sprints 3 and 4 can run in parallel — different surface areas, no shared mutation. Sprint 2 (invitations) blocks any user-creation flows but does not block F3/F4 feature work itself.

---

## 9. Shared modules summary

| Module | File | Used by |
|---|---|---|
| Permission Resolution | `backend/src/services/permission.service.js` | All five features (every authenticated request) |
| Email Provider Abstraction | `backend/src/services/email-providers/*` | F1, F5 |
| Activity Log (extension) | `backend/src/services/activity_log.service.js` | F1, F2, F4, F5 |
| Rate Limiter (extension) | `backend/src/middleware/rate_limit.js` | F1, F3 |
| File Service (existing) | `backend/src/services/file.service.js` | F3, F4 |
| Notification Gateway (extend) | `backend/src/services/notification.service.js` | F4, F5 |

---

## 10. Settled defaults (Q1–Q14)

| # | Question | Default |
|---|---|---|
| Q1 | Token type | Random 32-byte token, SHA-256 hash stored |
| Q2 | Initial password | Random passphrase generated, emailed once, force-change on first login |
| Q3 | Token expiry | 48 hours |
| Q4 | Invitation rate limit per inviter | 10/h, 50/day |
| Q5 | Level deletion when users still assigned | Block delete; require manual reassign first |
| Q6 | Per-user override approval workflow | None — direct apply, audit-logged |
| Q7 | Cross-dept grant default expiry | NULL (no expiry); UI optional date picker |
| Q8 | Avatar output | 256×256 webp + 64×64 thumb |
| Q9 | Production email provider | AWS SES (with provider abstraction allowing override) |
| Q10 | i18n templates | Indonesian only in Sprint 5; English added later |
| Q11 | Digest / batched notifications | Backlog (not MVP) |
| Q12 | Bounce/complaint webhooks | Sprint 5 stretch goal |
| Q13 | Bootstrap CEO/Superadmin | Seed script (existing `scripts/seed.js`); not via invitation |
| Q14 | Custom non-system roles | Allowed via existing `roles.is_system_role=false`; manual permission setup |

---

## 11. Acceptance criteria summary

- **F1**: CEO invites `staff@interlab.com` as Sales/Staff; user receives email, clicks link, must change password on first login, then has perms matching template `(sales, staff)`. Expired/revoked tokens return generic error (no email enumeration). Resend flow generates new token + password and revokes the old one.
- **F2**: Sales Manager creates level `Senior Sales` rank 2; existing Sales Staff (rank 1) does not get promoted. CEO grants `cross_dept_view` to Finance Director on feature `sales_po`; resolver returns it. User with `deny: po.approve` cannot approve even if template allows.
- **F3**: User uploads PNG ≤ 5 MB → backend resizes to webp ≤ 100 KB; old avatar soft-deleted. SVG and oversized files rejected. User without uploaded avatar falls back to `avatars/defaults/{role}.png`.
- **F4**: Uploading AWB while PO is at `Processed` advances it to `Shipped`, writes `purchase_order_status_history` row, writes `purchase_order_tracking_events` row, and triggers any matching notification template. Concurrent uploads result in only one transition (`FOR UPDATE` lock). Reject from `Inspected` to `Arrived` requires `po.reject_stage`; reason is recorded.
- **F5**: Stage-`Shipped` transition emits an email from sender `sales-ops@interlab.com`; recipients = role Finance + role Admin&Log + extra user CEO; users who muted that template are skipped. Switching the sender from SMTP to SES requires only a row update in `notification_senders` — no code change. SES bounce hits the webhook and updates the `email_queue` row to `failed`.

---

## 12. Out of scope

- Multi-tenancy (single PT. Interlab Sentra Solutions Indonesia tenant)
- Mobile native apps (web responsive only)
- Real-time presence beyond existing WebSocket (`/api/ws`)
- New PO stages or stage reorder
- Replacing existing chat/channel system
- Offline / PWA support
- Self-service password reset for active users (covered separately from F1 invitation flow)

---

## 13. References

- `CLAUDE.md` — non-negotiable architectural invariants
- `backend/migrations/001_users_and_sessions.sql` through `016_app_settings_and_email_queue.sql` — existing schema
- `backend/src/services/notification.service.js` — existing notification gateway
- `backend/src/services/po.service.js` — existing PO state-machine helper
- `interlabs-crm-demo/docs/CTX_architecture.txt` — system layers, MinIO bucket strategy, WebSocket event catalogue
- `interlabs-crm-demo/docs/CTX_master_context.txt` — domain model, RBAC matrix, 11-stage PO lifecycle
