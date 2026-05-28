---
audience: dev
reading_time: 12 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- backend/src/services/notification.service.js
- backend/src/services/email.service.js
- backend/src/services/po.service.js
- backend/src/services/sales.service.js
- backend/src/services/admin_log.service.js
- backend/src/services/finance.service.js
- backend/src/services/technical.service.js
- backend/src/services/hrga.service.js
- backend/src/services/tax.service.js
- backend/src/jobs/slaReadyToDeliver.job.js
- backend/src/jobs/slaPoDueDate.job.js
- backend/src/jobs/slaHrgaExpiry.job.js
- backend/src/jobs/taxDeadlineMonitor.job.js
- backend/migrations/011_notifications_and_chat.sql
- backend/migrations/016_app_settings_and_email_queue.sql
- backend/scripts/seed.js
- interlabs-crm-demo/docs/CTX_master_context.txt
- docs/backend/po-state-machine.md
- docs/backend/auth-and-rbac.md
- docs/backend/websocket.md
- CLAUDE.md
-->

# Notifications

How a domain event in any module becomes a bell-icon row, a queued email, and a realtime push to the recipient's browser. Every cross-division signal in the system — **[PO](../business/system-overview.md#glossary-po)** stage transitions, **[PR](../business/system-overview.md#glossary-pr)** lifecycle, **[AWB](../business/system-overview.md#glossary-awb)** progress, **[DO](../business/system-overview.md#glossary-do)** issuance, **[BAST](../business/system-overview.md#glossary-bast)** uploads, **[Masa Pajak](../business/system-overview.md#glossary-masa-pajak)** reminders, **[Domisili](../business/system-overview.md#glossary-domisili)** expiry — flows through this one switchboard. The implementation is `backend/src/services/notification.service.js`; module services and SLA jobs only call its `emit()` entry point.

## Mental model

A notification is a row in `notifications` (recipient + title + message + entity link + `is_read`) plus zero-or-more `notification_logs` rows that record per-channel delivery attempts. The switchboard is the `notification_templates` table, keyed by `template_key`. When a domain event fires, the service's job is to:

1. Look the template up by `template_key`.
2. Honour `status` — a `disabled` template suppresses **every** delivery channel for **every** recipient. This is the per-event off switch **[Superadmin](../business/system-overview.md#glossary-superadmin)** and **[CEO](../business/system-overview.md#glossary-ceo)** can flip from the UI without touching code.
3. Resolve the recipient set — the union of `recipient_roles_json` (expanded to active users with that role), the caller's `extraRoles` (also expanded), and the caller's `extraRecipientUserIds` (literal user ids — used for the assigned engineer, the document's PIC, etc.). Resolution happens **at emit time**, not at template-definition time, so a user activated five minutes ago receives the next event for their role.
4. Fan out per recipient: insert a `notifications` row if `send_dashboard_notification_enabled`, log `notification_logs(channel='dashboard', status='delivered')`. If `send_email_enabled`, log `notification_logs(channel='email', status='queued')` against the same notification row (creating a dashboard-only row first if dashboard delivery was disabled, so the audit trail is always preserved).
5. After the DB work, schedule a `setImmediate` push that emits `notification:new` and `notification:count` over WebSocket to every connected session of every recipient (see [websocket.md](./websocket.md) for the WS event catalogue and the in-process state caveat for multi-node deploys).

Email is **queued, not synchronous** — `emit()` only writes the `queued` log row, never opens an SMTP socket. A separate dispatch worker is expected to drain queued logs (see [Invariants](#invariants) for the current implementation status). The unrelated `email_queue` table populated by `email.service.enqueue` (`backend/src/services/email.service.js:60`) is the outbox for *user-initiated* email (test-SMTP, settings page) — notification emails do not flow through it. Two queues, two purposes.

A **missing** template is not the same as a disabled one. The service treats a missing row as "enabled, dashboard-only, no extra roles" (`notification.service.js:62`) so a freshly-deployed event still records and fans out while Superadmin/CEO catch up on creating the template. A `disabled` row, by contrast, drops everything on the floor.

Two side-channels are intentionally outside the transaction: WebSocket fan-out runs via `setImmediate` *after* the function returns (`notification.service.js:166-168`), and the unread-count refresh queries the shared pool, not the caller's transaction client (`notification.service.js:177-181`). Trade-off documented in the source comments — the alternative (waiting on commit) costs push latency; the chosen alternative costs the occasional "ghost" row on rollback that the next REST refetch clears.

## Wiring

End-to-end sequence for a single `emit()` call. Line numbers reference `backend/src/services/notification.service.js`:

```
caller (po.service / finance.service / sla job …)
  │
  │  notificationService.emit(client, { templateKey, title, message,
  │                                     module, entityType, entityId,
  │                                     senderUserId, extraRoles,
  │                                     extraRecipientUserIds })
  ▼
notification.service.emit ── line 34
  │
  ├─ validate templateKey + title present                            (line 48-49)
  ├─ SELECT … FROM notification_templates WHERE template_key = $1    (line 51-57)
  ├─ enabled? (status='enabled' OR template missing)                 (line 62)
  │     └─ disabled → return { skipped:true, notificationIds:[] }    (line 63)
  ├─ resolve channels: dashboard, email                              (line 65-66)
  ├─ resolve recipients:
  │     roleSet = template.recipient_roles_json ∪ extraRoles         (line 68-71)
  │     userSet ← Set(extraRecipientUserIds)                         (line 72)
  │     SELECT id FROM users WHERE role = ANY(roleSet)
  │            AND account_status='active' AND deleted_at IS NULL    (line 75-83)
  │     userSet ∪= those ids
  ├─ if userSet empty → return { skipped:false, ids:[] }             (line 86)
  ├─ if neither channel enabled → return { skipped:true }            (line 87)
  │
  ├─ for each recipient:
  │     if dashboard:
  │         INSERT INTO notifications (…) RETURNING id, created_at   (line 100-107)
  │         INSERT INTO notification_logs
  │              (channel='dashboard', status='delivered',
  │               attempted_at=now(), completed_at=now())            (line 112-117)
  │         queue push job { userId, payload }                       (line 119-130)
  │     if email:
  │         (insert dashboard row first if dashboard disabled)       (line 138-151)
  │         INSERT INTO notification_logs
  │              (channel='email', status='queued')                  (line 152-157)
  │
  └─ setImmediate(deliverRealtimePushes)                             (line 167)
        │
        ▼
        for each push job:
          ws.sendToUser(userId, 'notification:new', payload)         (line 176)
          SELECT count(*) WHERE recipient=user AND is_read=false     (line 177-181)
          ws.sendToUser(userId, 'notification:count', { unread })    (line 182-184)
```

(`emit()` does not check capabilities — RBAC is enforced at the route layer; see [auth-and-rbac.md](./auth-and-rbac.md).) The caller passes either a `pg.PoolClient` (when emitting inside a transaction — the common case from a service mutation) or `null` (when emitting from an SLA job that has no enclosing transaction). The first parameter routes every query through the same client so the notification rows commit atomically with the domain mutation; on rollback they vanish with it. Realtime pushes are deliberately fired *after* the function returns (the comment at `notification.service.js:90-95` is the source of truth on the trade-off).

Recipient resolution unions three sources. `recipient_roles_json` is the template's default role set, configurable from the UI. `extraRoles` and `extraRecipientUserIds` are caller-supplied widening — used to add e.g. the assigned engineer for a PO due-date reminder (`backend/src/jobs/slaPoDueDate.job.js:46-62`) or the document's PIC for an HRGA expiry alert (`backend/src/jobs/slaHrgaExpiry.job.js:121,146`). There is no narrowing API — a template's defaults can only be widened from a call site, never trimmed. Narrowing is a UI-side toggle on the template row.

## Key files

| File | Purpose | Principal export |
|---|---|---|
| `backend/src/services/notification.service.js` | Domain-event gateway: template lookup, recipient resolution, dashboard insert, email log, deferred WS push. | `emit` at `notification.service.js:34`; reader API `getUnread`/`markRead`/`markAllRead` at `:197`/`:210`/`:221` |
| `backend/src/services/email.service.js` | SMTP transport builder (driven by `app_settings`), test-email sender, `email_queue` outbox for *user-initiated* email (Settings page, test SMTP). Not used by `notification.service.js`. | `buildTransport`/`sendTest`/`enqueue`/`listQueue` at `email.service.js:7`/`:41`/`:60`/`:71` |
| `backend/src/services/app_settings.service.js` | Reads/writes the `app_settings` key-value store the SMTP transport hydrates from. | `getAll` (consumed at `email.service.js:8`) |
| `backend/src/websocket/emitter.js` | `ws.sendToUser(userId, eventName, payload)` — the realtime side-channel `emit()` calls via `setImmediate`. | `sendToUser` (consumed at `notification.service.js:176,182`) |
| `backend/migrations/011_notifications_and_chat.sql` | DDL for `notifications`, `notification_templates`, `notification_logs`. Defines the `disabled` status semantics, channel/status check constraints, and the `recipient_present_chk`. | Tables at lines 21, 44, 70 |
| `backend/migrations/014_indexes.sql` | Indexes `notification_templates(feature_group)` and `notification_templates(trigger_event)` for the Settings page filters. | Lines 186-189 |
| `backend/migrations/016_app_settings_and_email_queue.sql` | DDL for `app_settings` (SMTP config + general settings) and the `email_queue` outbox; seeds default email config. | Lines 14, 24, 43 |
| `backend/src/services/po.service.js` | Source of truth for the 11 PO-stage `template_key`s (`STATUS_TEMPLATE`) and per-stage default extra recipients (`STATUS_DEFAULT_RECIPIENTS`). | Constants at `po.service.js:52-91`; `flagOverdue` at `:363` |
| `backend/src/jobs/slaPoDueDate.job.js` | Emits `technical.po.due_date_reminder` on the 30-day window. | `run` |
| `backend/src/jobs/slaReadyToDeliver.job.js` | Emits `admin_log.ready_to_deliver.overdue_response`. | `run` |
| `backend/src/jobs/slaHrgaExpiry.job.js` | Emits `hrga.document.expiring_90`, `hrga.document.expiring_30`, `hrga.document.expired`. | `run` |
| `backend/src/jobs/taxDeadlineMonitor.job.js` | Emits `tax.reminder.unpaid`, `tax.reminder.spt_not_filed`. | `run` |

Templates are grouped below by the division that fires them: **[Sales](../business/system-overview.md#glossary-sales)**, **[Admin & Log](../business/system-overview.md#glossary-admin-log)**, **[Finance](../business/system-overview.md#glossary-finance)**, **[Technical](../business/system-overview.md#glossary-technical)**, **[HRGA](../business/system-overview.md#glossary-hrga)**, **[Tax & Insurance](../business/system-overview.md#glossary-tax-insurance)**. Cross-division automations (PO stage transitions) sit at the top.

## Template catalogue

Every `template_key` referenced in the codebase. Default channels are the `send_email_enabled` / `send_dashboard_notification_enabled` defaults from migration 011 (`true`/`true` → `both`); concrete templates may override either flag. Recipients are the union of the template's seeded `recipient_roles_json` and the caller's `extraRoles` at the emit site (the latter is fixed in source — listed in the **Default recipients** column).

> Note: `notification_templates` rows are **not** seeded in `backend/scripts/seed.js` (verified — no `INSERT INTO notification_templates` exists). Templates are created at runtime via the Settings page, or implicitly auto-handled by the missing-template fallback at `notification.service.js:62` (treat-as-enabled, dashboard-only). The catalogue below enumerates every `template_key` actually emitted by the service or job layer; the **Default recipients** column reflects the `extraRoles`/`STATUS_DEFAULT_RECIPIENTS` set in source — a future seed migration should populate `recipient_roles_json` to match.

### PO stage transitions (`po.service.js:52-91`)

(See [po-state-machine.md](./po-state-machine.md) for the canonical transition contracts; the templates below are fired from `po.service.js` as side effects of `advanceStatus`.)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `sales.po.registered` | `po.service.initializeFromSales` from `sales.service.submitSalesPo` | `[Sales, Admin&Log, Finance]` | both |
| `sales.po.processed` | `po.service.advanceStatus(Processed)` from `sales.service.processSalesPo` | `[Admin&Log, Finance]` | both |
| `finance.po.production` | `po.service.advanceStatus(Production)` from `finance.service.processRequisition` (PR PO-Out automation) | `[Technical, Admin&Log, Superadmin, CEO]` | both |
| `admin_log.po.shipped` | `po.service.advanceStatus(Shipped)` from `admin_log.service.runAwbAutomation` (AWB tracking number set) | `[Sales, Admin&Log, Technical]` | both |
| `admin_log.po.customs` | `po.service.advanceStatus(Customs)` from `admin_log.service.runAwbAutomation` (`transit_date` set) | `[Sales, Admin&Log]` | both |
| `admin_log.po.arrived` | `po.service.advanceStatus(Arrived)` from `admin_log.service.runAwbAutomation` (`arrival_date` set) | `[Sales, Admin&Log, Technical]` | both |
| `technical.po.inspected` | `po.service.advanceStatus(Inspected)` from `technical.service.submitQcReview` or installation automation | `[Sales, Technical, Admin&Log]` | both |
| `admin_log.po.delivery` | `po.service.advanceStatus(Delivery)` from `admin_log.service.runDoAutomation` (DO number set) | `[Sales, Admin&Log, Technical]` | both |
| `technical.po.installation` | `po.service.advanceStatus(Installation)` from `technical.service` install-start automation | `[Sales, Technical]` | both |
| `technical.po.bast` | `po.service.advanceStatus(BAST)` from `technical.service` BAST upload / `sendBastToFinance` | `[Sales, Technical, Finance]` | both |
| `finance.po.invoice` | `po.service.advanceStatus(Invoice)` from `finance.service.issueInvoiceCustomer` | `[Superadmin, CEO, Sales, Admin&Log]` | both |

### Sales overdue (`po.service.js:363`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `sales.po.overdue` | `po.service.flagOverdue` (default) — Sales 2-working-day SLA breach | caller-supplied | both |
| `sales.po.delay_justified` | `sales.service.justifyDelay` → `po.service.flagOverdue(templateKey='sales.po.delay_justified')` | caller-supplied | both |

### Admin & Log (`admin_log.service.js:223-241`, `:514`, `:548`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `admin_log.awb.shipped` | AWB tracking number first recorded (`runAwbAutomation`) | `[Finance, Technical, Superadmin, CEO]` | both |
| `admin_log.awb.customs` | `awb_records.transit_date` first recorded | `[Finance, Technical, Superadmin, CEO]` | both |
| `admin_log.awb.arrived` | `awb_records.arrival_date` first recorded | `[Finance, Technical, Superadmin, CEO]` | both |
| `admin_log.do.registered` | `delivery_orders` row created by `admin_log.service` | `[Finance, Technical, Superadmin, CEO]` | both |
| `admin_log.do.arrived` | `delivery_orders.arrival_date` recorded | `[Finance, Technical, Superadmin, CEO]` | both |
| `admin_log.ready_to_deliver.overdue_response` | `slaReadyToDeliver.job` — Technical Ready-to-Deliver 2-day SLA breached | `[Admin&Log, Superadmin, CEO]` | both |

### Finance (`finance.service.js:348`, `:422`, `:513`, `:583`, `:649`, `:784`, `:856`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `finance.pr.registered` | `finance.service.registerRequisition` — Sales PR copied to Finance | `[Finance]` | both |
| `finance.pr.processed` | `finance.service.processRequisition` — PO Out issued | `[Finance, Sales, Superadmin, CEO]` | both |
| `finance.invoice_manufacture.registered` | `finance.service` — supplier invoice captured | `[Finance]` | both |
| `finance.invoice_manufacture.paid` | `finance.service` — supplier payment recorded | `[Finance, Superadmin, CEO]` | both |
| `finance.invoice_customer.registered` | `finance.service` — Technical BAST triggers customer invoice draft | `[Finance]` | both |
| `finance.invoice_customer.processed` | `finance.service.issueInvoiceCustomer` — customer invoice issued | `[Finance, Superadmin, CEO, Sales]` | both |

### Technical (`technical.service.js:298,:511,:569,:900,:1051,:1072,:1351,:1571`, `slaPoDueDate.job.js:52`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `technical.job_order.created` | `technical.service` — Technical Job Order created | `[Technical, Superadmin, CEO]` + assigned engineer | both |
| `technical.installation.ready_to_deliver` | `technical.service` — installation flagged Ready-to-Deliver | `[Admin&Log, Superadmin, CEO]` | both |
| `technical.bast.submitted` | `technical.service` BAST / PM BASTP upload, `sendBastToFinance` | `[Finance, Superadmin, CEO]` | both |
| `technical.qc.completed` | `technical.service.submitQcReview` — QC submitted/approved | `[Technical, Superadmin, CEO]` | both |
| `technical.billing.handoff` | `technical.service` — billing handoff to Finance | `[Finance, Superadmin, CEO]` | both |
| `technical.po.due_date_reminder` | `slaPoDueDate.job` — PO due in ≤30 days | `[Technical]` + assigned engineer + support team | both |

### HRGA (`hrga.service.js:605,616`, `slaHrgaExpiry.job.js:114,135-140`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `hrga.letter.review_requested` | `hrga.service` — company letter sent for review | `[HRGA]` | both |
| `hrga.letter.finalized` | `hrga.service` — company letter finalized | `[HRGA, Superadmin, CEO]` | both |
| `hrga.document.expiring_90` | `slaHrgaExpiry.job` — **[Domisili](../business/system-overview.md#glossary-domisili)** / **[BPJS](../business/system-overview.md#glossary-bpjs)** / **[KEMNAKER](../business/system-overview.md#glossary-kemnaker)** etc. ≤90 days from expiry | `[HRGA, Superadmin, CEO]` + PIC | both |
| `hrga.document.expiring_30` | `slaHrgaExpiry.job` — same docs ≤30 days from expiry | `[HRGA, Superadmin, CEO]` + PIC | both |
| `hrga.document.expired` | `slaHrgaExpiry.job` — document past expiry | `[HRGA, Superadmin, CEO]` + PIC | both |

### Tax & Insurance (`tax.service.js:321,507,522,542`, `taxDeadlineMonitor.job.js:221-267`)

| code | trigger event | default recipients | default channels |
|---|---|---|---|
| `tax.record.created` | `tax.service` — **[Masa Pajak](../business/system-overview.md#glossary-masa-pajak)** record created | `[Tax&Insurance, Superadmin, CEO]` | both |
| `tax.record.submitted` | `tax.service` — **[SPT](../business/system-overview.md#glossary-spt)** filed | `[Tax&Insurance, Superadmin, CEO]` | both |
| `tax.record.verified` | `tax.service` — record verified | `[Tax&Insurance, Superadmin, CEO]` | both |
| `tax.record.paid` | `tax.service` — payment recorded | `[Tax&Insurance, Superadmin, CEO]` | both |
| `tax.reminder.unpaid` (missing record) | `taxDeadlineMonitor.job:221` — Rule 1, no record created for closed Masa Pajak | `[Tax&Insurance, Superadmin, CEO]` | both |
| `tax.reminder.unpaid` (unpaid) | `taxDeadlineMonitor.job:247` — Rule 2, record exists but still Unpaid past deadline | `[Tax&Insurance, Superadmin, CEO]` + PIC | both |
| `tax.reminder.spt_not_filed` | `taxDeadlineMonitor.job:267` — SPT filing deadline approaching | `[Tax&Insurance, Superadmin, CEO]` + PIC | both |

**Total: 42 distinct `template_key`s.**

## Invariants

- **Disabled template = no delivery anywhere.** `notification.service.js:62-63` short-circuits to `{ skipped:true }` before any recipient resolution or insert. Email and dashboard are gated by the same `status='enabled'` check, so toggling a template `disabled` from the Settings UI is a single-row UPDATE that silences every channel for that event. Verified by the `notification_templates_status_chk` constraint (`migrations/011_notifications_and_chat.sql:61-62`) — only `enabled` / `disabled` are accepted.
- **Recipients resolved at emit time, not at template-definition time.** The `users WHERE role = ANY(roleSet) AND account_status='active' AND deleted_at IS NULL` query (`notification.service.js:76-83`) runs on every `emit()` call, so adding a user to a role propagates to the next event without any cache invalidation step. Conversely, soft-deleting or deactivating a user removes them from the next fan-out — past `notifications` rows are not retracted.
- **Email is queued, not synchronous.** `emit()` only writes `notification_logs(channel='email', status='queued')` (`notification.service.js:152-157`). No SMTP transport is constructed inside the emit path. As of this writing **no email-dispatch worker exists** — the comments at `notification.service.js:12,134` reference an `email_dispatch_queue` worker that has not yet been implemented (verified: no consumer scans `notification_logs WHERE status='queued'` anywhere in `backend/src/`). Wiring that worker is the open extension point — see [Extension points](#extension-points). The unrelated `email_queue` table (`migrations/016_app_settings_and_email_queue.sql:24`) has its own status field but is also undrained today; only `email.service.sendTest` (`email.service.js:41`) actually opens an SMTP connection, and that's user-initiated, not notification-driven.
- **Missing template ≠ disabled template.** The fallback at `notification.service.js:60-66` treats an absent row as enabled-dashboard-only-no-email, so a service that emits a brand-new `template_key` still produces dashboard rows while Superadmin/CEO catch up on registering it. This is intentional — silently dropping a domain event because the template row doesn't exist yet would violate the "no silent mutations" rule from CLAUDE.md.
- **Recipient set is an additive union, never a subtraction.** Caller-supplied `extraRoles` and `extraRecipientUserIds` widen the template's defaults; there is no API to narrow them at the call site (`notification.service.js:71-72`). To narrow recipients for a specific event, edit the template row's `recipient_roles_json` from the Settings UI.
- **WebSocket push is best-effort, post-commit, off-transaction.** `setImmediate(deliverRealtimePushes)` (`notification.service.js:166-168`) fires after the current microtask queue drains so the caller's transaction has a chance to commit before the frontend receives `notification:new` referencing the row. The follow-up unread-count query uses the shared pool (`db`), not the caller's client, so it cannot read uncommitted rows. A push failure is logged and swallowed (`notification.service.js:185-194`) — the dashboard row and `notification_logs` row are the durable record of truth; the push is a UX accelerator.
- **Audit trail per channel.** Every successful dashboard delivery writes a `notification_logs(channel='dashboard', status='delivered')` row (`notification.service.js:112-117`); every email enqueue writes `notification_logs(channel='email', status='queued')`. Channel and status are constrained by `notification_logs_channel_chk` and `notification_logs_status_chk` (`migrations/011_notifications_and_chat.sql:79-83`).
- **Recipient column is one-of, enforced by check constraint.** `notifications_recipient_present_chk` (`migrations/011_notifications_and_chat.sql:33-34`) requires `recipient_user_id IS NOT NULL OR recipient_role IS NOT NULL`. The service path always populates `recipient_user_id` (role-broadcast rows are not currently produced); the `recipient_role` column is reserved for a future role-pinned semantics.

## Extension points

- **Add a new notification.** (1) Insert a `notification_templates` row with a unique `template_key`, the desired `feature_group`, `trigger_event` label, `recipient_roles_json` (JSONB array of role keys), and `send_email_enabled`/`send_dashboard_notification_enabled` defaults — do this via a migration, the Settings UI, or seed. (2) From the service layer, after the domain mutation and inside the same transaction, call `notificationService.emit(client, { templateKey, title, message, module, entityType, entityId, senderUserId, extraRoles, extraRecipientUserIds })`. Pass the same `client` so the notification commits with the mutation. Do **not** emit from the controller / route layer — the contract is service-layer-only so transaction boundaries stay legible. See `backend/src/services/finance.service.js:348` for the canonical shape.
- **Toggle a template at runtime.** Superadmin/CEO update `notification_templates.status` (`'enabled'` ↔ `'disabled'`). The `notification_templates_status_chk` constraint enforces the two-value vocabulary. No deploy required; the next `emit()` reads the new value.
- **Adjust default recipients.** Update `notification_templates.recipient_roles_json` — JSONB array of role keys, e.g. `["sales","admin_log","finance"]`. Resolution is per-emit so the change takes effect on the next event. This is the *narrowing* path for caller-supplied widening; a call site's `extraRoles` cannot be removed without a code change.
- **Wire the email-dispatch worker.** Implement a job in `backend/src/jobs/` that scans `SELECT notification_id FROM notification_logs WHERE channel='email' AND status='queued' ORDER BY created_at LIMIT N FOR UPDATE SKIP LOCKED`, joins `notifications` for title/message and `notification_templates` for `subject`/`body`, renders against the `app_settings` SMTP transport (`backend/src/services/email.service.js:7` `buildTransport`), and updates the log row to `status='sent'` (or `'failed'` with `error_message`). Register the job in `backend/src/jobs/scheduler.js` behind `SCHEDULER_ENABLED`. The contract is already documented at `notification.service.js:12,134` — only the consumer is missing.
- **Add a new delivery channel** (e.g. SMS, Slack, push-to-mobile). Extend the `notification_logs_channel_chk` constraint to include the new channel value, add a parallel `send_<channel>_enabled` boolean to `notification_templates`, branch inside `emit()` after the existing dashboard/email blocks (`notification.service.js:99-158`), and write a corresponding dispatch worker. Keep the per-recipient log row pattern so observability stays uniform.
- **Listen to a notification on the frontend.** Subscribe to the `notification:new` and `notification:count` WebSocket events (emitted from `notification.service.js:176,182`); the bell icon component reads the count and shows the latest 5 unread from `getUnread` (`notification.service.js:197`). `markRead` / `markAllRead` (`:210`/`:221`) emit follow-up `notification:count` updates.
