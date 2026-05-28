---
audience: dev
reading_time: 12 min
last_reviewed: 2026-04-27
---

# Admin & Log module

The Admin & Log module owns the **shipping and delivery** segment of the 11-stage [PO](../../business/system-overview.md#glossary-po) lifecycle. It is the single division that drives stages **Shipped → Customs → Arrived** (via [AWB](../../business/system-overview.md#glossary-awb) field writes) and **Delivery** (via [DO](../../business/system-overview.md#glossary-do) field writes), while also taking the Technical "Ready-to-Deliver" handoff inside a 2-working-day SLA window.

For module-wide context (PO stages, automation contract, audit-trail invariants), read [po-state-machine.md](../po-state-machine.md) first; this file is the Admin & Log-specific deep dive.

## Purpose

- **Shipping system of record.** AWB rows in `awb_records` capture forwarder/manufacturer hand-offs (tracking number, transit, arrival). Each new AWB trigger field is what advances the master PO through Shipped → Customs → Arrived. See `backend/src/services/admin_log.service.js:209` `runAwbAutomation`.
- **Delivery system of record.** DO rows in `delivery_orders` capture customer-side delivery (`delivery_order_number`, `customer_arrival_date`). The first DO trigger advances the master PO to Delivery; the second is informational only. See `backend/src/services/admin_log.service.js:479` `runDoAutomation`.
- **Ready-to-Deliver responder.** When [Technical](../../business/system-overview.md#glossary-technical) flips `installation_records.ready_to_deliver='Yes'`, [Admin & Log](../../business/system-overview.md#glossary-admin-log) acknowledges or dispatches within 2 working days. See `acknowledgeReadyToDeliver` (`admin_log.service.js:906`).
- **Petty-cash bookkeeping.** Monthly operational expense records (`admin_operational_records`) flow through a `draft → submitted → reviewed` workflow. No PO impact.

The role itself is sometimes called "Admin & Logistics" in the UI; the system slug is `admin_log` everywhere (route prefix, RBAC role string, notification group).

## Forms / entities owned

Three primary entities, plus the Ready-to-Deliver workflow that lives on Technical's `installation_records`.

- **AWB ([Air Waybill](../../business/system-overview.md#glossary-awb))** — `awb_records` (`backend/migrations/006_admin_log_forms.sql:18`). Record-number prefix `AWB-YYYY-NNNNN` (`backend/src/utils/recordNumbers.js:80`). Three trigger fields advance the master PO.
- **[Delivery Order](../../business/system-overview.md#glossary-do)** — `delivery_orders` (`backend/migrations/006_admin_log_forms.sql:69`). Record-number prefix `DO-YYYY-NNNNN` (`recordNumbers.js:81`). One PO-advancing trigger; one informational trigger.
- **Operational record (petty cash)** — `admin_operational_records` (`backend/migrations/006_admin_log_forms.sql:116`). Record-number prefix `OPS-YYYY-NNNNN` (`recordNumbers.js:82`). Monthly grouping by `reporting_month`; immutable once `reviewed`.
- **Ready-to-Deliver tracking** — read/write surface over `installation_records.admin_log_response_status` and `delivery_method`. Owned schema-wise by Technical; the Admin & Log service writes only the response columns. See `acknowledgeReadyToDeliver` (`admin_log.service.js:906`).

## Routes

All routes mounted under `/api/admin-log`. Every route runs `authMiddleware` (`admin_log.routes.js:14`) before `rbacGuard`. Listing routes apply per-creator scoping unless the caller is `superadmin`, `ceo`, or `admin_log` (the role-wide read; see `adminLogScopeUserId` `admin_log.routes.js:25`). `view_global` short-circuits at `rbac.middleware.js:32-34`.

| Method | Path | RBAC | Validator | Service entry | Source |
|---|---|---|---|---|---|
| GET | `/awb` | `[Admin&Log, Sales, Finance, Technical, Superadmin, CEO]` `awb:view_own` | `awbListQuery` | `listAwb` | `admin_log.routes.js:41` |
| GET | `/awb/:id` | `awb:view_own` | `idParam` | `getAwb` | `admin_log.routes.js:54` |
| GET | `/awb/:id/history` | `awb:view_own` | `idParam` | `getAwbHistory` | `admin_log.routes.js:63` |
| POST | `/awb` | `[Admin&Log]` `awb:create` | `awbCreate` | `createAwb` | `admin_log.routes.js:72` |
| PUT | `/awb/:id` | `[Admin&Log]` `awb:edit` | `idParam` + `awbUpdate` | `updateAwb` | `admin_log.routes.js:81` |
| DELETE | `/awb/:id` | `[Admin&Log]` `awb:delete` | `idParam` | `deleteAwb` | `admin_log.routes.js:90` |
| GET | `/delivery-orders` | `delivery_order:view_own` | `deliveryOrderListQuery` | `listDeliveryOrders` | `admin_log.routes.js:104` |
| GET | `/delivery-orders/:id` | `delivery_order:view_own` | `idParam` | `getDeliveryOrder` | `admin_log.routes.js:117` |
| GET | `/delivery-orders/:id/history` | `delivery_order:view_own` | `idParam` | `getDeliveryOrderHistory` | `admin_log.routes.js:126` |
| POST | `/delivery-orders` | `[Admin&Log]` `delivery_order:create` | `deliveryOrderCreate` | `createDeliveryOrder` | `admin_log.routes.js:135` |
| PUT | `/delivery-orders/:id` | `[Admin&Log]` `delivery_order:edit` | `idParam` + `deliveryOrderUpdate` | `updateDeliveryOrder` | `admin_log.routes.js:144` |
| DELETE | `/delivery-orders/:id` | `[Admin&Log]` `delivery_order:delete` | `idParam` | `deleteDeliveryOrder` | `admin_log.routes.js:153` |
| GET | `/operational` | `admin_operational:view_own` | `operationalListQuery` | `listOperational` | `admin_log.routes.js:167` |
| GET | `/operational/:id` | `admin_operational:view_own` | `idParam` | `getOperational` | `admin_log.routes.js:180` |
| POST | `/operational` | `[Admin&Log]` `admin_operational:create` | `operationalCreate` | `createOperational` | `admin_log.routes.js:189` |
| PUT | `/operational/:id` | `[Admin&Log]` `admin_operational:edit` | `idParam` + `operationalUpdate` | `updateOperational` | `admin_log.routes.js:198` |
| POST | `/operational/:id/transition` | `[Admin&Log]` `admin_operational:edit` | `idParam` + `operationalTransition` | `transitionOperational` | `admin_log.routes.js:207` |
| DELETE | `/operational/:id` | `[Admin&Log]` `admin_operational:delete` | `idParam` | `deleteOperational` | `admin_log.routes.js:218` |
| GET | `/ready-to-deliver` | `delivery_order:view_own` | `readyToDeliverListQuery` | `listReadyToDeliver` | `admin_log.routes.js:237` |
| POST | `/ready-to-deliver/:id/acknowledge` | `[Admin&Log]` `delivery_order:edit` | `idParam` + `readyToDeliverAcknowledge` | `acknowledgeReadyToDeliver` | `admin_log.routes.js:247` |

The RBAC bracket lists above are the *default seed grants*; the matrix lives in DB tables (`role_permissions`), so a Superadmin can extend or revoke at runtime. Cross-division read access (Sales / Finance / Technical seeing AWB and DO) is by design — the records flow to PO Tracking widgets in those dashboards.

## Validators

All schemas are Joi `.unknown(true)` for list queries (so paging keys flow through) and strict for create/update bodies. `attachment_ids` is the cross-module multi-file binding contract — `attachFilesToEntity` (`admin_log.service.js:119`) errors if any provided UUID is not pre-uploaded.

### `awbCreate` / `awbUpdate` / `awbListQuery`

- `awbCreate` (`admin_log.validators.js:59`) requires `related_po_id` (UUID); every other field is optional. Trigger fields `awb_tracking_number`, `transit_date`, `arrival_date` may all be supplied at create time — the automation will replay them in PO order (see Services).
- `awbUpdate` (`admin_log.validators.js:64`) is `awbCreate` with `related_po_id` optional + `.min(1)` so partial updates are valid.
- `shipment_method` is restricted to `Air | Sea | Land | Courier` (`admin_log.validators.js:35`); `current_awb_status` is *server-managed* and absent from the validator surface.
- `awbListQuery` (`admin_log.validators.js:69`) accepts `current_awb_status` (one of `Registered | Processed | Arrived`) and `related_po_id` filters.

### `deliveryOrderCreate` / `deliveryOrderUpdate` / `deliveryOrderListQuery`

- `deliveryOrderCreate` (`admin_log.validators.js:97`) requires `related_po_id`. `item_list` is a Joi array of `itemListEntry` (`admin_log.validators.js:23`) — `item_name` required, `qty/unit/description` optional. Stored as `jsonb` on the table.
- `current_do_status` is server-managed (`Registered | Arrived`).
- `deliveryOrderListQuery` (`admin_log.validators.js:107`) takes `current_do_status` + `related_po_id`.

### `operationalCreate` / `operationalUpdate` / `operationalTransition` / `operationalListQuery`

- `operationalCreate` (`admin_log.validators.js:139`) makes only `reporting_month` required (the monthly grouping anchor). `currency` defaults to IDR server-side at insert (`admin_log.service.js:757`); validator allows `IDR | USD | EUR`.
- `payment_method` is restricted to `Cash | Transfer | Credit Card`; `expense_status` to `Pending | Paid | Cancelled`.
- `operationalTransition` (`admin_log.validators.js:146`) is the smallest schema in the file: `{ workflow_status: 'submitted' | 'reviewed' }`. Forward-only motion is enforced server-side (see Services).
- `operationalListQuery` (`admin_log.validators.js:150`) supports `workflow_status`, `expense_status`, `expense_category`, and a single-month filter `reporting_month`.

### `readyToDeliverAcknowledge` / `readyToDeliverListQuery`

- `readyToDeliverAcknowledge` (`admin_log.validators.js:161`) takes `response_status: 'acknowledged' | 'dispatched'` (required), optional `delivery_method: 'Pick Up Forwarder' | 'Hand Carry'`, optional `note ≤ 2000`.
- `readyToDeliverListQuery` filters by `admin_log_response_status: 'pending' | 'acknowledged' | 'dispatched'`. The list endpoint defaults to `pending` if the filter is omitted (`admin_log.service.js:868-873`).

## Services

`backend/src/services/admin_log.service.js` is organised by entity. Shared helpers (top of file) wrap pagination, soft-delete-aware fetch, attachment binding, and per-entity history writes.

### Shared helpers

- `listRows` (`admin_log.service.js:60`) — generic `WHERE deleted_at IS NULL` lister with optional ILIKE search on a single column, optional `created_by` scope, and a list of `extraFilters`.
- `requireRow` (`admin_log.service.js:107`) — fetch-or-`NotFoundError`.
- `attachFilesToEntity` (`admin_log.service.js:119`) — binds pre-uploaded `file_attachments` to `(related_module, related_entity_id)`. Errors loudly if any UUID is missing or already deleted.
- `lookupPoNumber` (`admin_log.service.js:140`) — denormalises `purchase_orders.po_number` onto AWB/DO rows for listing performance.
- `writeAwbHistory` / `writeDoHistory` (`admin_log.service.js:155`, `:164`) — append a row to the per-entity `*_status_history` table. Distinct from the master `purchase_order_status_history` write inside `poService.advanceStatus`.

### AWB methods

- `listAwb` / `getAwb` (`admin_log.service.js:177`, `:198`). `getAwb` also hydrates `attachments` via `listAttachmentsForEntity('admin_log.awb_records', id)` so detail pages render attached files inline.
- `runAwbAutomation` (`admin_log.service.js:209`) — the Shipped/Customs/Arrived automation core. Used by both create and update paths.

```js
// admin_log.service.js:209-244 — trigger replay (excerpt)
const becamePresent = (field) =>
    !(before && before[field]) && Boolean(after[field]);
const transitions = [];
if (becamePresent('awb_tracking_number')) transitions.push({
    newStatus: 'Shipped', awbStatus: 'Registered',
    statusCode: 'SHIPPED', template: 'admin_log.awb.shipped' });
if (becamePresent('transit_date')) transitions.push({
    newStatus: 'Customs', /* ... */ template: 'admin_log.awb.customs' });
if (becamePresent('arrival_date')) transitions.push({
    newStatus: 'Arrived', /* ... */ template: 'admin_log.awb.arrived' });
```

  Each pushed transition does four things in order (`admin_log.service.js:251-293`): flip `awb_records.current_awb_status`, append AWB-scoped history, call `poService.advanceStatus` (which writes `purchase_order_status_history` + tracking events + emits `admin_log.po.*`), and emit the AWB-scoped `admin_log.awb.*` template with `extraRoles=['finance','technical','superadmin','ceo']`. Replay order matches the PO lifecycle so `advanceStatus`'s forward-only guard never trips on a multi-field initial save.

- `createAwb` (`admin_log.service.js:299`) — wraps insert + attachment bind + automation in `db.withTransaction`. `before=null` for new rows so any populated trigger field fires (`admin_log.service.js:339-343`).
- `updateAwb` (`admin_log.service.js:352`) — opens with a `SELECT ... FOR UPDATE` lock to snapshot `before`, then runs the same automation against the post-write `after` row. The lock is what makes "(null/empty) → (present)" detection safe under concurrent writes.
- `deleteAwb` (`admin_log.service.js:419`) — refuses if `current_awb_status !== 'Registered'` *or* `awb_tracking_number` is set; once the trigger has fired, the master PO has advanced and a delete would orphan history. Callers must use a corrective workflow.
- `getAwbHistory` (`admin_log.service.js:436`) — chronological `awb_status_history` for the entity audit panel.

### Delivery Order methods

- `listDeliveryOrders` / `getDeliveryOrder` (`admin_log.service.js:453`, `:471`) — same pattern as AWB.
- `runDoAutomation` (`admin_log.service.js:479`) — handles two independent triggers. Only `delivery_order_number` advances the master PO (to Delivery); `customer_arrival_date` flips `current_do_status` to `Arrived` and emits `admin_log.do.arrived`, but the master PO stays at Delivery until Technical marks Installation. This split is documented in MOD_admin_log §FORM 2 STATUS AUTOMATION and reinforced by the comment block at `admin_log.service.js:475-478`.
- `createDeliveryOrder` / `updateDeliveryOrder` / `deleteDeliveryOrder` (`admin_log.service.js:562`, `:611`, `:673`) mirror the AWB pattern, including the `FOR UPDATE` lock and the post-trigger delete guard.
- `getDeliveryOrderHistory` (`admin_log.service.js:687`).

### Operational methods

- `listOperational` / `getOperational` (`admin_log.service.js:707`, `:732`). List ordering is `reporting_month DESC, created_at DESC` so the freshest month surfaces first.
- `createOperational` (`admin_log.service.js:736`) — generates record number, defaults `currency='IDR'` and `expense_status='Pending'`, inserts at `workflow_status='draft'`. No PO automation, no notification fan-out.
- `updateOperational` (`admin_log.service.js:774`) — refuses any edit once `workflow_status='reviewed'`. The error message ("open a corrective record") is the documented escape hatch.
- `transitionOperational` (`admin_log.service.js:813`) — forward-only enforcement: `draft → submitted → reviewed`, no skips, no reverses (`admin_log.service.js:820-826`).
- `deleteOperational` (`admin_log.service.js:839`) — refuses delete once `reviewed`, soft-deletes otherwise.

### Ready-to-Deliver methods

- `listReadyToDeliver` (`admin_log.service.js:862`) — joins `installation_records ↔ technical_job_orders ↔ purchase_orders` and filters to `ready_to_deliver='Yes'`. Sorted by `ready_to_deliver_at ASC` so the row closest to the 2-day breach is at the top of the dashboard widget. Defaults to `admin_log_response_status='pending'` when the filter is omitted (so the widget shows only outstanding work).
- `acknowledgeReadyToDeliver` (`admin_log.service.js:906`) — the dispatcher action. Locks the `installation_records` row, refuses if `ready_to_deliver !== 'Yes'` or already `dispatched`, persists `admin_log_response_status` + optional `delivery_method`, **clears any outstanding `sla_tracking` overdue/escalation flags** (`admin_log.service.js:943-950`), and writes a `workflow_step_history` audit row tagged `step_name='ready_to_deliver_response'`. Clearing the SLA tracker is what stops the hourly job from re-firing after a late acknowledgement.

## DB tables

All five tables are introduced by `backend/migrations/006_admin_log_forms.sql`. Schema invariants from CLAUDE.md (UUID v4 PKs, `timestamptz`, `deleted_at` soft-delete, `created_by`/`updated_by`) are honored throughout.

- **`awb_records`** (`migrations/006_admin_log_forms.sql:18`). PK `id`, unique `awb_record_number`. `related_po_id` is `ON DELETE RESTRICT` against `purchase_orders` because the AWB drives master PO automation — deleting a referenced PO would orphan history. `current_awb_status` is a CHECK-constrained enum (`Registered | Processed | Arrived`) defaulting to `Registered`. `shipment_method` CHECK accepts `Air | Sea | Land | Courier` or NULL.
- **`awb_status_history`** (`migrations/006_admin_log_forms.sql:55`). AWB-scoped audit log written by `runAwbAutomation`. Rows are append-only (`ON DELETE CASCADE` from the parent AWB). Distinct from the master `purchase_order_status_history` written by `poService.advanceStatus` — these are *complementary* logs, not duplicates.
- **`delivery_orders`** (`migrations/006_admin_log_forms.sql:69`). PK `id`, unique `do_record_number`. `related_po_id` is `ON DELETE RESTRICT`. `item_list` is `jsonb NOT NULL DEFAULT '[]'` (the line-item repeater). `current_do_status` enum (`Registered | Arrived`) defaulting to `Registered`.
- **`delivery_order_status_history`** (`migrations/006_admin_log_forms.sql:100`). DO-scoped audit log, same shape as AWB history.
- **`admin_operational_records`** (`migrations/006_admin_log_forms.sql:116`). PK `id`, unique `operational_record_number`. `reporting_month` is a `date NOT NULL` (the first day of the month — date arithmetic on month boundaries is what makes the dashboard widget cheap). `period_start/period_end` capture multi-day expenses. CHECKs cover `payment_method`, `expense_status`, and `workflow_status`.

`installation_records` is owned by Technical (migration 007); the Admin & Log service writes only the response columns (`admin_log_response_status`, `delivery_method`).

## Notifications fired

All Admin & Log domain events emit through `notificationService.emit` with `module='admin_log'`. Templates live in `notification_templates`; a disabled template suppresses *all* delivery for that key (the cross-module rule from CLAUDE.md). For the cross-module template catalogue, see [notifications.md § Admin & Log](../notifications.md).

| Template key | Fired by | Default `extraRoles` | Source |
|---|---|---|---|
| `admin_log.awb.shipped` | `runAwbAutomation` when `awb_tracking_number` first present | `[Finance, Technical, Superadmin, CEO]` | `admin_log.service.js:284` |
| `admin_log.awb.customs` | `runAwbAutomation` when `transit_date` first present | `[Finance, Technical, Superadmin, CEO]` | `admin_log.service.js:284` |
| `admin_log.awb.arrived` | `runAwbAutomation` when `arrival_date` first present | `[Finance, Technical, Superadmin, CEO]` | `admin_log.service.js:284` |
| `admin_log.do.registered` | `runDoAutomation` when `delivery_order_number` first present | `[Finance, Technical, Superadmin, CEO]` | `admin_log.service.js:513` |
| `admin_log.do.arrived` | `runDoAutomation` when `customer_arrival_date` first present | `[Finance, Technical, Superadmin, CEO]` | `admin_log.service.js:547` |
| `admin_log.ready_to_deliver.overdue_response` | `slaReadyToDeliver.job` after 2 working days unanswered | `[Admin&Log, Superadmin, CEO]` | `backend/src/jobs/slaReadyToDeliver.job.js:123` |

In addition, every AWB/DO trigger that calls `poService.advanceStatus` causes a corresponding **`admin_log.po.*`** template to fire as part of the master PO transition (see [po-state-machine.md § per-stage detail](../po-state-machine.md#per-stage-detail)). Two notifications per trigger is intentional: the `admin_log.po.*` template is the cross-division "PO is at stage X now" announcement; the `admin_log.awb.*` / `admin_log.do.*` template is the entity-specific "this AWB/DO record was updated" notice.

## Automations

### Incoming

**Ready-to-Deliver from Technical.** When [Technical](../../business/system-overview.md#glossary-technical) sets `installation_records.ready_to_deliver='Yes'` (`backend/src/services/technical.service.js`), the upstream side fires the `technical.installation.ready_to_deliver` template to `[Admin&Log, Superadmin, CEO]` (see [notifications.md § Technical](../notifications.md#technical-)). Two side-effects matter to Admin & Log:

- `installation_records.ready_to_deliver_at` is timestamped at the moment of the flip — this is the *clock-start* for the 2-working-day SLA.
- `installation_records.admin_log_response_status` is initialised to `pending`. The Admin & Log dashboard's Ready-to-Deliver widget filters on this; `acknowledgeReadyToDeliver` (`admin_log.service.js:906`) is the only path that takes it out of `pending`.

There is no Sales-side incoming automation; Sales-owned PO origination is upstream context only and the AWB/DO trigger fields are populated by Admin & Log themselves.

### Outgoing

Two automations leave the module. Both are idempotent at the `poService.advanceStatus` layer (`po.service.js:259-264`).

- **AWB created → Shipped/Customs/Arrived.** `runAwbAutomation` replays the three trigger fields in PO-lifecycle order. Full per-stage detail and the four-invariant contract live in [po-state-machine.md § Automation: AWB created](../po-state-machine.md#automation-awb-created--shippedcustomsarrived).
- **DO created → Delivery.** `runDoAutomation` advances the master PO on the first `delivery_order_number` write; the second trigger (`customer_arrival_date`) is informational. See [po-state-machine.md § Automation: DO created](../po-state-machine.md#automation-do-created--delivery).

A field that was already non-null before the write does **not** re-fire — `becamePresent` checks the `before` snapshot (`admin_log.service.js:210-211`, `:480-481`). This is what makes editing an unrelated field on an existing AWB safe.

## SLA hooks

One SLA job binds Admin & Log: `sla_technical_ready_to_deliver`. Cron `0 * * * *` (hourly on the hour, `Asia/Jakarta`). Source: `backend/src/jobs/slaReadyToDeliver.job.js`.

- **Trigger:** any `installation_records` row with `ready_to_deliver='Yes'` AND `admin_log_response_status='pending'` whose `ready_to_deliver_at` is more than 2 working days in the past (working-day math via `backend/src/utils/workingDays.js:50`).
- **Action:** emit `admin_log.ready_to_deliver.overdue_response` to `[Admin&Log, Superadmin, CEO]` (`slaReadyToDeliver.job.js:123`) and stamp `sla_tracking.escalation_sent_at` so the next hourly tick does not re-fire (`slaReadyToDeliver.job.js:95-101`).
- **Reset:** `acknowledgeReadyToDeliver` clears `sla_tracking.overdue_at` + `escalation_sent_at` for `(entity_type='installation_records.ready_to_deliver', entity_id=<id>)` so a future re-flag can re-arm the timer (`admin_log.service.js:943-950`).

For the catalogue, working-day math, and single-leader semantics, see [jobs.md § Job catalogue](../jobs.md#job-catalogue).

## Frontend pages

All pages live under `frontend/app/(app)/admin-log/`. The three forms each have a list / detail / create / edit set; Ready-to-Deliver is single-page (no detail or edit — the only mutation is acknowledge). The status badge variants used throughout come from `frontend/lib/admin-log-ui.ts`.

| Route | File | Purpose |
|---|---|---|
| `/admin-log/awb` | `app/(app)/admin-log/awb/page.tsx` | AWB list + filter |
| `/admin-log/awb/new` | `app/(app)/admin-log/awb/new/page.tsx` | Create AWB |
| `/admin-log/awb/[id]` | `app/(app)/admin-log/awb/[id]/page.tsx` | AWB detail + status history |
| `/admin-log/awb/[id]/edit` | `app/(app)/admin-log/awb/[id]/edit/page.tsx` | Edit AWB (trigger fields fire automation server-side) |
| `/admin-log/delivery-orders` | `app/(app)/admin-log/delivery-orders/page.tsx` | DO list + filter |
| `/admin-log/delivery-orders/new` | `app/(app)/admin-log/delivery-orders/new/page.tsx` | Create DO |
| `/admin-log/delivery-orders/[id]` | `app/(app)/admin-log/delivery-orders/[id]/page.tsx` | DO detail + history |
| `/admin-log/delivery-orders/[id]/edit` | `app/(app)/admin-log/delivery-orders/[id]/edit/page.tsx` | Edit DO |
| `/admin-log/operational` | `app/(app)/admin-log/operational/page.tsx` | Petty-cash list (sorted by `reporting_month`) |
| `/admin-log/operational/new` | `app/(app)/admin-log/operational/new/page.tsx` | Create operational record |
| `/admin-log/operational/[id]` | `app/(app)/admin-log/operational/[id]/page.tsx` | Operational detail + transition button |
| `/admin-log/operational/[id]/edit` | `app/(app)/admin-log/operational/[id]/edit/page.tsx` | Edit (rejected server-side once `reviewed`) |
| `/admin-log/ready-to-deliver` | `app/(app)/admin-log/ready-to-deliver/page.tsx` | Pending Technical handoffs sorted by SLA urgency |

API wrappers: `frontend/lib/admin-log-api.ts` exposes `awbApi`, `deliveryOrdersApi`, `operationalApi`, `readyToDeliverApi`. Types: `frontend/lib/admin-log-types.ts` (entity + input shapes mirror the backend validators 1:1). Status → badge variant mapping: `frontend/lib/admin-log-ui.ts`.

## Cross-references

- [po-state-machine.md](../po-state-machine.md) — full 11-stage lifecycle, audit-trail contract, the four-invariant rule that every AWB/DO trigger must honor.
- [notifications.md](../notifications.md) — template catalogue, recipient rules, gating behaviour. The Admin & Log row table at `notifications.md:155-164` is the cross-module view of the same fan-out documented above.
- [jobs.md](../jobs.md) — `sla_technical_ready_to_deliver` cron entry, working-day math, single-leader/`SCHEDULER_ENABLED` semantics, idempotency rules.
- [./technical.md](./technical.md) — upstream owner of `installation_records.ready_to_deliver` (the field that arms the SLA clock). Also owns BAST, which is the next PO stage after Delivery.
- [./sales.md](./sales.md) — upstream owner of PO origination (`purchase_orders` rows referenced by `awb_records.related_po_id` and `delivery_orders.related_po_id`).
- [auth-and-rbac.md](../auth-and-rbac.md) — capability/feature matrix backing the `awb`, `delivery_order`, `admin_operational` RBAC keys.

<!--
drift-anchors:
- backend/src/routes/admin_log.routes.js
- backend/src/services/admin_log.service.js
- backend/src/validators/admin_log.validators.js
- backend/migrations/006_admin_log_forms.sql
- backend/src/jobs/slaReadyToDeliver.job.js
- backend/src/utils/workingDays.js
- backend/src/utils/recordNumbers.js
- frontend/lib/admin-log-api.ts
- frontend/lib/admin-log-types.ts
- frontend/lib/admin-log-ui.ts
- frontend/app/(app)/admin-log/
- interlabs-crm-demo/docs/MOD_admin_log.txt
- docs/backend/po-state-machine.md
- docs/backend/notifications.md
- docs/backend/jobs.md
- docs/backend/auth-and-rbac.md
-->
