# MindIO Phase 2 Master Implementation Plan

> **For agentic workers:** This is a **coarse-grained master plan** that decomposes Phase 2 into five sub-plans. **Do not execute this document directly via `superpowers:executing-plans` or `superpowers:subagent-driven-development`.** Each sub-plan section below must first be **expanded into a full bite-sized TDD plan** (via `superpowers:writing-plans`) before execution. Coarse tasks here become bite-sized steps there.
>
> Spec source: `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`).

**Goal:** Ship five Phase 2 features (invitation, dynamic RBAC, avatar, PO doc-stage map, dynamic notification sender) on top of the existing `interlabs-crm-demo` codebase, additive only.

**Architecture:** Each feature reuses existing infrastructure (8-role RBAC, MinIO `file_attachments`, `email_queue` outbox, `notification_templates` gateway, 11-stage PO state machine, chat channels). New tables and services extend — never replace — what's already there. The hybrid B+C+D permission model lives behind a shared `permission.service.js` resolver with Redis-backed caching and deterministic resolution order (template → grant → cross-dept → deny-wins).

**Tech Stack:** Node 20 + Express + `pg` (backend), Next.js 14 + React 18 + Zustand + Tailwind (frontend), PostgreSQL 16, MinIO (S3-compatible), Redis (new — for permission cache), node-cron (existing scheduler), `argon2` or existing `bcrypt` for password hashing, `sharp` (new — for avatar resize), AWS SDK for SES (new — for production email).

---

## Plan structure overview

| Sub-plan | Sprint | Scope | Hard dependencies | Working software at end |
|---|---|---|---|---|
| **Plan 1** — Foundation + F2 Permission System | Sprint 0 + 1 | 4 shared modules + role_levels/overrides/cross-dept tables + permission resolver + 3 admin UIs | Existing codebase only | Hybrid B+C+D RBAC working end-to-end with deny-wins overrides and cross-dept grants |
| **Plan 2** — F1 Invitation System | Sprint 2 | `user_invitations` table + service + activation flow + force-change-password | Plan 1 (level_id FK; capability `invite_user`) | CEO/Manager can invite, accept, revoke, resend |
| **Plan 3** — F3 Avatar Upload | Sprint 3 | Presign/commit/get endpoints + `<AvatarUploader/>` + sharp resize pipeline | Plan 1 | Users upload/replace avatar, fallback to per-role default |
| **Plan 4** — F4 PO Document → Stage Trigger Map | Sprint 4 | `po_document_types` + `advanceStage`/`rejectStage`/`adminOverrideStage` services + file-upload hook | Plan 1 (capabilities `advance_stage`, `reject_stage`, `admin_override_stage`) | PO stages auto-advance via doc upload, with reject/override |
| **Plan 5** — F5 Dynamic Notification Sender | Sprint 5 | `notification_senders` + extra recipients + user mutes + provider abstraction + dispatch worker routing | Plan 1, Plan 4 (stage events) | Per-template sender selection, multi-provider routing, opt-out |

**Parallelism:** After Plan 1 ships, Plan 3 and Plan 4 can run in parallel (different surface areas, no shared mutation). Plan 2 should land before Plan 4/5 if you want to demo invitation-driven onboarding before notification work.

---

## Plan 1 — Foundation + F2 Permission System

### Goal
Land all shared infrastructure (Sprint 0) **and** the dynamic permission system (Sprint 1) in one ship-able unit. Without this, the other four plans cannot start.

### File structure

**Net-new files:**
- `backend/src/services/permission.service.js` — resolver with Redis cache
- `backend/src/services/role_level.service.js` — level CRUD with manager-of-role guard
- `backend/src/services/permission_override.service.js` — grant/deny/cross-dept CRUD
- `backend/src/services/email-providers/factory.js` — provider router
- `backend/src/services/email-providers/smtp.js` — wraps existing SMTP path
- `backend/src/services/email-providers/gmail.js` — Gmail SMTP adapter
- `backend/src/services/email-providers/ses.js` — AWS SES adapter
- `backend/src/services/email-providers/postmark.js` — Postmark stub
- `backend/src/services/email-providers/resend.js` — Resend stub
- `backend/src/config/redis.js` — Redis client (new dependency)
- `backend/migrations/017_role_levels.sql` — role_levels + users.level_id + role_permissions.level_id backfill
- `backend/migrations/018_user_capability_overrides.sql`
- `backend/migrations/019_cross_dept_grants.sql`
- `backend/src/routes/admin/levels.routes.js`
- `backend/src/routes/admin/permissions.routes.js`
- `backend/src/routes/admin/overrides.routes.js`
- `backend/src/validators/levels.validators.js`
- `backend/src/validators/overrides.validators.js`
- `frontend/app/(app)/admin/permissions/page.tsx` — role × level × feature × capability matrix
- `frontend/app/(app)/admin/levels/page.tsx` — per-role level CRUD
- `frontend/app/(app)/admin/users/[id]/overrides/page.tsx` — per-user grant/deny/cross-dept editor
- `frontend/lib/admin-permissions-api.ts`
- `frontend/lib/admin-permissions-types.ts`
- `frontend/lib/admin-permissions-ui.ts`

**Modified files:**
- `backend/src/middleware/rbac.js` — call `permission.service.resolveCapabilities()` instead of direct `role_permissions` join
- `backend/src/middleware/sameRoleScope.js` — extend to honor level rank (Manager-of-role authority)
- `backend/src/services/email.service.js` — route via `email-providers/factory.js`
- `backend/src/services/activity_log.service.js` — register new event types
- `backend/src/middleware/rate_limit.js` — add `permissionWriteLimiter` (CRUD endpoints)
- `backend/scripts/seed.js` — seed top-rank Manager + lowest-rank Staff per invitable role
- `backend/package.json` — add `ioredis`, `argon2`
- `frontend/lib/rbac.ts` — frontend-side capability check helper

### Tasks (high-level — expand before execution)

#### Task 1.1 — Add Redis client + permission cache scaffold
**Files:** `backend/src/config/redis.js`, `backend/package.json`
**Deliverable:** `getRedis()` exported, env wiring (`REDIS_URL`), graceful no-Redis fallback for dev
**Test surface:** unit test for cache hit/miss, unit test for graceful fallback when Redis disconnected

#### Task 1.2 — Migration 017: role_levels + users.level_id + role_permissions.level_id
**Files:** `backend/migrations/017_role_levels.sql`
**Deliverable:** Table + columns + unique constraints + backfill (existing role_permissions rows get the lowest-rank level per role; quad-unique constraint replaces triple-unique)
**Test surface:** migration round-trip (Up → Down → Up); seed data assertions

#### Task 1.3 — Migration 018: user_capability_overrides
**Files:** `backend/migrations/018_user_capability_overrides.sql`
**Deliverable:** Table with `(user_id, feature_id, capability_id, override_type)` quad-unique + active partial index
**Test surface:** insert grant + insert deny succeed; duplicate same-type fails; index used by EXPLAIN

#### Task 1.4 — Migration 019: cross_dept_grants
**Files:** `backend/migrations/019_cross_dept_grants.sql`
**Deliverable:** Table with `(grantee_user_id, target_role_key, feature_id, capability_id)` quad-unique + active partial index
**Test surface:** insert + revoke + soft-delete via `revoked_at`; FK on `roles.role_key` blocks bad target_role

#### Task 1.5 — Seed Manager + Staff levels for 6 invitable roles
**Files:** `backend/scripts/seed.js`
**Deliverable:** Idempotent seed inserts for `(sales, manager rank 2 / staff rank 1)`, same for admin_log/finance/technical/hrga/tax_insurance. Backfill existing seeded users with `level_id = staff` (or appropriate). Existing `role_permissions` rows get level_id = staff (lowest rank).
**Test surface:** seed twice → no duplicate rows; user count and capability count unchanged

#### Task 1.6 — Permission resolver: bypass + template + inheritance (steps 1–2 of formula)
**Files:** `backend/src/services/permission.service.js`
**Deliverable:** `resolveCapabilities(userId, featureKey)` returning `Set<capability_key>`. Steps 1–2 only. Cache integration with Redis (5-min TTL, key `perm:user:{user_id}`).
**Test surface:**
- CEO/Superadmin returns all-capabilities (bypass)
- Sales Manager (rank 2) returns union of rank 1 + rank 2 templates
- Sales Staff (rank 1) returns only rank 1 templates
- Cache hit on second call (no DB query)
- Cache invalidate on `role_permissions` change

#### Task 1.7 — Permission resolver: grant + cross-dept + deny (steps 3–5)
**Files:** `backend/src/services/permission.service.js`
**Deliverable:** Extend resolver with grant union, cross-dept union, deny subtraction. Honor `expires_at` and `revoked_at` filters.
**Test surface:**
- Active grant adds capability
- Expired grant ignored
- Revoked grant ignored
- Cross-dept grant adds capability
- Deny removes a template-granted capability
- Deny removes a granted capability (deny wins over grant)
- Deny does NOT remove cross-dept grant if implementer reads spec wrong → asserted as wrong, deny removes everything

#### Task 1.8 — Data scope resolver
**Files:** `backend/src/services/permission.service.js`
**Deliverable:** `resolveDataScope(userId, featureKey)` returning `'own'|'team'|'role'|'global'` plus `granted_target_roles[]` for cross-dept query expansion
**Test surface:** Sales Staff returns `own`; Sales Manager returns `role`; CEO/Superadmin returns `global`; cross-dept grantee returns own scope but `granted_target_roles` populated

#### Task 1.9 — Cache invalidation hooks
**Files:** `backend/src/services/permission.service.js`, `backend/src/services/role_level.service.js`, `backend/src/services/permission_override.service.js`
**Deliverable:** `invalidateUserCache(userId)`, `invalidateRoleCache(roleKey)`, `invalidateAllCache()`. Called from every mutation that affects resolution.
**Test surface:** mutation X → cache key absent; mutation Y → cache hit still valid

#### Task 1.10 — RBAC middleware swap
**Files:** `backend/src/middleware/rbac.js`
**Deliverable:** Replace direct DB join with `permission.service.resolveCapabilities()`. Existing route consumers untouched (same `req.capabilities` set).
**Test surface:** all existing route integration tests still pass; new test for cache hit path

#### Task 1.11 — Same-role-scope middleware extension
**Files:** `backend/src/middleware/sameRoleScope.js`
**Deliverable:** Honor `users.level_id`. Top-rank manager-of-role can manage same-role users at lower ranks; cannot manage own rank or above.
**Test surface:** Manager edits Staff → allowed; Staff edits Manager → 403; Manager edits Manager → 403 (unless CEO/Superadmin)

#### Task 1.12 — Level CRUD service + routes
**Files:** `backend/src/services/role_level.service.js`, `backend/src/routes/admin/levels.routes.js`, `backend/src/validators/levels.validators.js`
**Deliverable:** `POST/PATCH/DELETE /api/admin/roles/:roleKey/levels`. Authority guard: top-rank manager-of-role OR CEO/Superadmin. Block delete if level has assigned users.
**Test surface:** authority tests (manager-of-role allowed, staff denied), block-on-assigned, audit log row written

#### Task 1.13 — Permission override CRUD service + routes
**Files:** `backend/src/services/permission_override.service.js`, `backend/src/routes/admin/overrides.routes.js`, `backend/src/validators/overrides.validators.js`
**Deliverable:** `POST/PATCH/DELETE /api/admin/users/:id/overrides` (grant/deny) and `POST /api/admin/users/:id/cross-dept-grants`. Authority: CEO/Superadmin only by default; capability `override_grant` extends authority.
**Test surface:** authority, time-bounded grants, deny-wins resolution end-to-end

#### Task 1.14 — Email provider factory + adapters
**Files:** `backend/src/services/email-providers/*.js`, `backend/src/services/email.service.js`
**Deliverable:** Factory routes by `notification_senders.provider` (read-through to spec table; until F5 lands, use a default sender from `app_settings`). Adapters: smtp (wraps existing), gmail, ses, postmark/resend stubs.
**Test surface:** factory selects correct adapter; smtp adapter compatibility test; ses adapter mock test

#### Task 1.15 — Activity log + rate limiter extensions
**Files:** `backend/src/services/activity_log.service.js`, `backend/src/middleware/rate_limit.js`
**Deliverable:** Register event types: `level.created`, `level.updated`, `level.deleted`, `permission.override.granted`, `permission.override.revoked`, `cross_dept.grant.created`, `cross_dept.grant.revoked`. Add `permissionWriteLimiter` (10/min/user).
**Test surface:** event row written on each mutation; rate limit returns 429 after threshold

#### Task 1.16 — Frontend: Permission matrix UI
**Files:** `frontend/app/(app)/admin/permissions/page.tsx`, `frontend/lib/admin-permissions-*.ts`
**Deliverable:** 4-axis matrix view (role × level × feature × capability). Cell toggle persists. Optimistic UI; rollback on error.
**Test surface:** Playwright/manual: Superadmin loads page → matrix renders; toggle saves; non-Superadmin gets 403

#### Task 1.17 — Frontend: Per-role level CRUD UI
**Files:** `frontend/app/(app)/admin/levels/page.tsx`
**Deliverable:** Tab per role (6 tabs); list levels with rank; create/rename/delete; rank reorder via drag.
**Test surface:** manager-of-role sees only own role tab; CEO/Superadmin sees all; rank uniqueness enforced UI-side

#### Task 1.18 — Frontend: Per-user override editor
**Files:** `frontend/app/(app)/admin/users/[id]/overrides/page.tsx`
**Deliverable:** Two sections: capability override (grant/deny per feature × capability), cross-dept grants (target role × feature × capability picker). Show effective resolved capabilities preview ("With these overrides, this user can: …").
**Test surface:** preview matches resolver output; revoke restores resolution

### Acceptance for Plan 1
Tied directly to spec Section 11 F2 acceptance:
- Sales Manager creates `Senior Sales` rank 2; existing Sales Staff rank 1 not promoted ✓
- CEO grants `cross_dept_view` to Finance Director on `sales_po`; Finance Director's resolved capability set includes it ✓
- User with `deny: po.approve` cannot approve even when template allows ✓
- All existing route tests pass post-RBAC-swap ✓
- Permission resolution under cache-warm hits zero-DB-query path ✓

### Risks specific to Plan 1
1. **Backfill of `role_permissions.level_id`** — if any seed-time row is left NULL, the post-NOT-NULL constraint fails. Mitigation: backfill SQL inside the migration in same transaction; verify count delta = 0 before applying NOT NULL.
2. **Redis unavailability in dev** — fallback path must not silently skip caching in production. Mitigation: env flag `REQUIRE_REDIS=true` for prod boot; warn loudly otherwise.
3. **Cache stampede on first cold-cache hit** — N concurrent requests all miss + query. Mitigation: single-flight pattern (one request fills cache, others wait via Redis SETNX with brief TTL).

> **Expansion required before execution.** When ready to ship Plan 1, run `superpowers:writing-plans` against this Plan 1 section to produce a full TDD bite-sized plan saved as `docs/superpowers/plans/2026-05-XX-plan1-foundation-and-f2.md`.

---

## Plan 2 — F1 Invitation System

### Goal
Enable CEO/Superadmin (and, via capability `invite_user`, top-rank managers) to onboard the 6 invitable roles via email + activation token + first-login force-change-password.

### File structure

**Net-new:**
- `backend/migrations/020_user_invitations.sql`
- `backend/src/services/invitation.service.js`
- `backend/src/routes/admin/invitations.routes.js`
- `backend/src/validators/invitations.validators.js`
- `backend/src/utils/invitation_token.js` — token generate + hash
- `backend/src/utils/initial_password.js` — passphrase generator (4-word style)
- `frontend/app/(app)/admin/invitations/page.tsx` — list with status filters
- `frontend/app/(app)/admin/invitations/new/page.tsx` — invite form
- `frontend/app/activate/[token]/page.tsx` — activation landing
- `frontend/app/(app)/change-password/page.tsx` — first-login forced change
- `frontend/lib/invitation-api.ts`, `invitation-types.ts`, `invitation-ui.ts`

**Modified:**
- `backend/src/services/auth.service.js` — post-login check `must_change_password`
- `backend/src/middleware/auth.js` — block protected routes if `must_change_password=true` (allow only `/change-password`)
- Seed `notification_templates` row `invitation_pending`

### Tasks (high-level — expand before execution)

| Task | Files | Deliverable |
|---|---|---|
| 2.1 | `migrations/020_user_invitations.sql`, `users.must_change_password` | Table + column |
| 2.2 | `utils/invitation_token.js` | `generateToken()` (32 bytes random) + `hashToken(token)` (SHA-256) |
| 2.3 | `utils/initial_password.js` | `generatePassphrase()` (4 random words from a curated wordlist, hyphenated) + argon2id hash |
| 2.4 | `services/invitation.service.js` | `create({email, roleKey, levelId, invitedBy})`, `accept(token, newPassword)`, `revoke(id, by, reason)`, `resend(id)` (regenerates token + password, marks old `revoked`) |
| 2.5 | `routes/admin/invitations.routes.js` + validators | REST endpoints with rate limit (10/h, 50/d per inviter) |
| 2.6 | `notification_templates` seed row `invitation_pending` | Subject/body using {{handles}} placeholders |
| 2.7 | `services/auth.service.js` + `middleware/auth.js` | force-change-password gate |
| 2.8 | Frontend list/new/activate/change-password pages | full UX |
| 2.9 | Capability `invite_user` registration + assign to top-rank managers | Permission matrix entry |

### Acceptance for Plan 2
- Spec Section 11 F1 criteria met
- Email enumeration test: lookup-by-email returns same response shape for valid/invalid
- Resend regenerates token + password, old token rejected
- Rate limit triggers 429 after 10/h per inviter

### Risks specific to Plan 2
1. **Race on dual acceptance** — same token clicked twice in 2 tabs. Mitigation: `UPDATE … WHERE status='pending' RETURNING *` atomic transition to `accepted`.
2. **Time-of-check vs time-of-use on level_id** — level deleted between invite and accept. Mitigation: re-validate level still exists at accept time; if deleted, fall back to lowest-rank level for that role.
3. **Plaintext password leakage in logs** — must NEVER appear. Mitigation: explicit log redaction list; lint rule for `password` in `console.log`.

> **Expansion required before execution.**

---

## Plan 3 — F3 Avatar Upload

### Goal
Authenticated users upload, replace, or remove their own avatar; everyone else's avatar is fetched via short-lived presigned URL with role-default fallback.

### File structure

**Net-new:**
- `backend/migrations/021_user_avatars.sql`
- `backend/src/services/avatar.service.js` — presign + commit (validate, resize via sharp, EXIF strip, upload, swap pointer)
- `backend/src/routes/users/me-avatar.routes.js`
- `backend/src/utils/image_validator.js`
- `frontend/components/AvatarUploader.tsx` — drag-drop + crop + upload
- `frontend/lib/avatar-api.ts`

**Modified:**
- `backend/src/services/file.service.js` — already has presign; possibly add content-length header constraint
- `frontend/components/Topbar.tsx`, `frontend/app/(app)/profile/page.tsx` — show user avatar, fallback chain
- `backend/package.json` — add `sharp`

### Tasks (high-level — expand before execution)

| Task | Files | Deliverable |
|---|---|---|
| 3.1 | `migrations/021_user_avatars.sql` | `users.avatar_file_id` + `avatar_updated_at` |
| 3.2 | `utils/image_validator.js` | mime whitelist, dimension checker, magic-byte sniff (defeat extension spoof) |
| 3.3 | `services/avatar.service.js` | `presignUpload()`, `commit({rawFileKey})` (download, validate, resize 256+64 webp, EXIF strip, upload, write file_attachments, update users, soft-delete prior avatar file_attachment), `presignGet(userId)` |
| 3.4 | Routes `POST /api/users/me/avatar/presign`, `POST /api/users/me/avatar/commit`, `GET /api/users/:id/avatar` | Per-user, capability `avatar_upload` (default-grant to all roles) |
| 3.5 | Frontend `<AvatarUploader/>` | crop UI + presign + PUT + commit handshake |
| 3.6 | Frontend integration | Topbar, profile, anywhere avatar displayed |

### Acceptance for Plan 3
- Spec Section 11 F3 criteria met
- SVG rejected with 400; oversized rejected at presign step (content-length header check)
- Old avatar `file_attachments` row marked `deleted_at`; MinIO object kept until lifecycle policy purges (separate concern)

### Risks specific to Plan 3
1. **Presigned URL bypass for size limit** — client lies about content-length. Mitigation: backend re-validates after commit; reject and clean up if mismatch.
2. **MIME spoof via filename** — file with `.png` extension but PDF bytes. Mitigation: magic-byte sniff via `file-type` package (or sharp's metadata).
3. **Sharp memory blowup on giant input** — pre-validate dimensions before sharp processes.

> **Expansion required before execution.**

---

## Plan 4 — F4 PO Document → Stage Trigger Map

### Goal
Make the existing 11-stage PO state machine reactive to document uploads: uploading the right doc at the right stage advances the PO; reject and admin-override paths exist for exceptions.

### File structure

**Net-new:**
- `backend/migrations/022_po_document_types.sql`
- `backend/src/services/po_document.service.js` — declarative map lookup + stage trigger
- `backend/src/routes/admin/po-document-types.routes.js` — Superadmin/CEO CRUD
- `frontend/app/(app)/admin/po-document-types/page.tsx`
- `frontend/components/po/StageTimeline.tsx` — read view of `purchase_order_status_history`
- `frontend/components/po/RejectDialog.tsx`
- `frontend/components/po/AdminOverrideDialog.tsx`

**Modified:**
- `backend/src/services/po.service.js` — add `advanceStage`, `rejectStage`, `adminOverrideStage` (replace ad-hoc stage transitions in module services)
- `backend/src/services/file.service.js` — post-insert hook: if `po_document_type_id.triggers_stage` set, call `po.service.advanceStage()`
- All module services (`sales`, `admin_log`, `finance`, `technical`) — replace inline stage transitions with `po.service.advanceStage()` calls
- `capability_definitions` seed — add `advance_stage`, `reject_stage`, `admin_override_stage`
- Seed Manager-rank `role_permissions` for these capabilities per spec defaults

> **Migration 022 carries everything F4 needs in one file** (per spec Section 4): `po_document_types` table + `file_attachments.po_document_type_id` column + the three new history columns (`is_rejection`, `is_admin_override`, `reject_count_after`). No separate migration for history columns.

### Tasks (high-level — expand before execution)

| Task | Files | Deliverable |
|---|---|---|
| 4.1 | Migration 022 (po_document_types table + file_attachments.po_document_type_id + history columns is_rejection/is_admin_override/reject_count_after) | Tables + columns + CHECK constraints |
| 4.2 | Seed `po_document_types` | AWB→Shipped, arrival_doc→Arrived, do→Delivery, pr_po_out→Production, bast→BAST, invoice_customer→Invoice |
| 4.3 | `services/po.service.js` `advanceStage(poId, viaDocumentTypeId, userId)` | Begin tx → SELECT FOR UPDATE on `purchase_orders` row → verify `current_status` allows transition → UPDATE `current_status` → INSERT `purchase_order_status_history` (status_code, status_label, updated_by_user_id, note) → INSERT `purchase_order_tracking_events` → call `notification.service.emit()` for matching template → commit |
| 4.4 | `services/po.service.js` `rejectStage(poId, toStatusCode, reason, userId)` | Begin tx → SELECT FOR UPDATE → verify reject is permitted from current state → UPDATE `current_status` to target → INSERT history row with `is_rejection=true`, `note=reason`, `reject_count_after = (previous max+1)` → if `reject_count_after >= threshold` (default 3), emit `po.reject_threshold_breached` notification to Superadmin → commit |
| 4.5 | `services/po.service.js` `adminOverrideStage(poId, targetStatus, reason, userId)` | Authority check (CEO/Superadmin or capability `admin_override_stage`) → SELECT FOR UPDATE → UPDATE `current_status` to targetStatus → INSERT history row with `is_admin_override=true`, `note=reason` → emit `po.stage_admin_overridden` notification → commit |
| 4.6 | File-upload hook in `file.service.js` | After insert, conditional advance |
| 4.7 | Refactor existing module services | Replace ad-hoc stage writes with new APIs |
| 4.8 | Capability seed + permission grants | `advance_stage` to Manager+Staff, `reject_stage` to Manager, `admin_override_stage` to CEO/Superadmin only |
| 4.9 | Admin doc-types CRUD UI | Superadmin-only |
| 4.10 | Stage timeline + reject + override dialogs | Per-PO detail page |
| 4.11 | Startup validator | Scan `po_document_types.triggers_stage` against the 11-stage enum; fail fast on drift |

### Acceptance for Plan 4
- Spec Section 11 F4 criteria met
- Concurrent upload race: 2 simultaneous AWB uploads → only one advance, second is no-op (idempotent)
- Reject from Inspected → Arrived requires `reject_stage`; reason stored; `reject_count_after` incremented
- Admin override CEO-only; logged with `is_admin_override=true` and reason

### Risks specific to Plan 4
1. **Refactor regression in existing module services** — replacing inline stage transitions can miss a callsite. Mitigation: grep audit for direct `purchase_orders.current_status` writes; assert all are in `po.service.js` post-refactor.
2. **Stage map drift** — `po_document_types.triggers_stage` value not in enum. Mitigation: startup validator + CHECK constraint.
3. **Notification storm during refactor** — old + new code both fire notifications. Mitigation: feature-flag the new path; cut over atomically.

> **Expansion required before execution.**

---

## Plan 5 — F5 Dynamic Notification Sender

### Goal
Per-template configurable sender + multi-recipient (roles + extras − mutes) + provider abstraction so SMTP/Gmail/SES/Postmark/Resend are swappable by config row.

### File structure

**Net-new:**
- `backend/migrations/023_notification_senders.sql`
- `backend/migrations/024_notification_template_extras.sql`
- `backend/src/services/notification_sender.service.js`
- `backend/src/services/notification_dispatch.worker.js` — drain `email_queue`, route via provider factory
- `backend/src/routes/admin/notification-senders.routes.js`
- `backend/src/routes/admin/notification-templates.routes.js`
- `backend/src/routes/users/me-notifications.routes.js` — mute/unmute
- `backend/src/routes/webhooks/email.routes.js` — bounce/complaint (SES, Postmark)
- `frontend/app/(app)/admin/notifications/senders/page.tsx`
- `frontend/app/(app)/admin/notifications/templates/page.tsx` (already partial — extend)
- `frontend/app/(app)/admin/notifications/templates/[id]/page.tsx` — sender + extras + body
- `frontend/app/(app)/profile/notifications/page.tsx` — per-user mute toggles

**Modified:**
- `backend/src/services/notification.service.js` — `emit()`: resolve sender from template.sender_id, expand recipients (roles + extras − mutes), dedupe within 60s window per (template, recipient, entity_id)
- `backend/src/services/email.service.js` — call `notification_dispatch.worker.js` instead of inline send
- `backend/src/jobs/scheduler.js` — register dispatch worker tick (every 30s)
- `notification_templates` seed — set sender_id for existing templates to a default `noreply` sender

### Tasks (high-level — expand before execution)

| Task | Files | Deliverable |
|---|---|---|
| 5.1 | Migrations 023, 024 + columns on notification_templates | Tables + sender_id FK |
| 5.2 | Seed default `noreply` sender + assign to existing templates | Idempotent |
| 5.3 | `services/notification_sender.service.js` CRUD | Authority: Superadmin only |
| 5.4 | `services/notification.service.js` `emit()` extensions | sender resolution + recipient expansion + 60s dedupe |
| 5.5 | `notification_dispatch.worker.js` | Drain `email_queue` (status=pending), route via `email-providers/factory.js`, exponential backoff up to 5 attempts |
| 5.6 | Scheduler registration | 30s tick; single-leader honored via existing `SCHEDULER_ENABLED` flag |
| 5.7 | Webhook routes for SES/Postmark | Update `email_queue.status='failed'` + `last_error` from bounce payloads |
| 5.8 | Mute service + routes | `POST/DELETE /api/users/me/notifications/mutes/:templateId` |
| 5.9 | Frontend admin senders CRUD | with provider config selectors (read app_settings keys) |
| 5.10 | Frontend admin template editor | Sender dropdown + extra-recipients picker (typeahead users) + body editor |
| 5.11 | Frontend user mute toggles | Per-template list with toggle |

### Acceptance for Plan 5
- Spec Section 11 F5 criteria met
- Switching sender provider via DB row update only (no code change) verified by integration test
- Bounce webhook updates email_queue row to `failed` with reason
- 60s dedupe window: 50 file uploads on same PO produce ≤1 email per recipient per minute

### Risks specific to Plan 5
1. **Provider config secret leakage in DB** — SES/Postmark API keys stored where? Mitigation: keys in `app_settings.value` (jsonb), read via env var keys only; never returned in API responses (sender CRUD returns config_key pointer, not value).
2. **Webhook authenticity** — fake bounce reports flipping email_queue rows. Mitigation: SNS signature verification (SES), Postmark webhook secret.
3. **Dispatch worker stuck** — long-held DB lock during sending. Mitigation: short transaction (mark sent/failed only); send happens outside transaction; dead-letter after 5 attempts.

> **Expansion required before execution.**

---

## Cross-plan acceptance (end-of-Phase-2)

When all 5 plans have shipped:
1. Superadmin invites a Sales Manager → email arrives → activate → forced password change → matrix shows Sales Manager template applied
2. Sales Manager invites a Sales Staff → email arrives → activate → Staff has reduced perms (template inheritance only of own rank)
3. Sales Manager creates a new "Senior Sales" rank 2 in Levels UI → existing Staff (rank 1) does not auto-promote
4. Finance Director gets `cross_dept_view` on `sales_po` → can view (not edit) Sales POs
5. User uploads avatar → topbar updates; default fallback works for unset users
6. Admin & Log uploads AWB on a Processed-stage PO → PO advances to Shipped; status history + tracking event written; email goes to Sales Manager + Finance + extra recipient CEO via the configured sender; users who muted "stage_advanced_shipped" template don't receive
7. CEO admin-overrides a stuck PO from Production directly to Delivery → history shows `is_admin_override=true` with reason; capability check enforced

---

## Self-review

- ✅ Spec coverage: every feature F1–F5 has a Plan; Sprint 0 foundation rolled into Plan 1; capabilities `advance_stage`/`reject_stage`/`admin_override_stage` are seeded in Plan 4 (matching spec Section 4 F4 fix); `invite_user` capability is seeded in Plan 2; `override_grant` capability noted in Plan 1 risk mitigation
- ✅ Migration ordering: F2 migrations (017–019) land before F1 (020), F3 (021), F4 (022), F5 (023–024) — matches spec Section 4 numbering note
- ✅ Type/method naming consistency: `advanceStage` / `rejectStage` / `adminOverrideStage` referenced same way across Plan 4 tasks; `resolveCapabilities` / `resolveDataScope` / `invalidateUserCache` consistent across Plan 1 tasks
- ✅ No placeholders within tasks — each task lists files + deliverable + (where relevant) test surface; the explicit "Expansion required before execution" markers at the end of Plans 1–5 are deliberate scope markers, not TODO content
- ✅ Risks linked back to spec Section 7 risks per feature, with Plan-specific concretions

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md`.**

This master plan is intentionally coarse. Before executing **any** sub-plan section, run `superpowers:writing-plans` against that section to produce a full bite-sized TDD plan saved to a new file (e.g. `2026-05-XX-plan1-foundation-and-f2.md`).

When you're ready to start execution, two execution patterns apply (per the writing-plans skill):

1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks, fast iteration
2. **Inline Execution** — execute tasks in this session using `superpowers:executing-plans`, batch with checkpoints

— but those run against a **fully-expanded** sub-plan, not against this master document.
