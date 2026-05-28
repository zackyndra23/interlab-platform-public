---
audience: dev
reading_time: 14 min
last_reviewed: 2026-04-27
---

# PO state machine

The 11-stage **[PO](../business/system-overview.md#glossary-po)** lifecycle is the single source of truth for cross-division work. This document is the contract every module-level doc cross-links into. The canonical implementation is `backend/src/services/po.service.js`; module services (`sales.service.js`, `finance.service.js`, `admin_log.service.js`, `technical.service.js`) call into it but never mutate `purchase_orders.current_status` directly.

Forward motion only: `po.service.js:260-264` rejects any attempt to move a PO to an earlier stage. A "regression" must be modelled as a corrective workflow on top of the existing stage, not as a silent state rollback.

## Overview

Side effects on every transition (rows 1-4 of the four-invariant contract from CLAUDE.md): a `purchase_order_status_history` row, a `purchase_order_tracking_events` row, a notification fired against `notification_templates.template_key`, and the new value written to `purchase_orders.current_status`. Plus a `po_customer_records` mirror sync (`po.service.js:114-123`) and a deferred `po:status_update` WebSocket fan-out (`po.service.js:316-348`). The "Side effects" column below names the template_key and the in-band automation, if any.

| # | Stage | Owning division | Entry trigger | Exit trigger | Side effects |
|---|-------|-----------------|---------------|--------------|--------------|
| 1 | Registered | **[Sales](../business/system-overview.md#glossary-sales)** | Sales submits a Sales PO form (`sales.service.js:613` `submitSalesPo`) | Sales advances same row to Processed | history+tracking+`sales.po.registered`; mirror creates `po_customer_records` at `workflow_status='registered'` |
| 2 | Processed | Sales | `sales.service.js:672` `processSalesPo` after PO is confirmed | Finance issues PO Out on the linked **[PR](../business/system-overview.md#glossary-pr)** | history+tracking+`sales.po.processed`; resets Sales 2-working-day SLA window |
| 3 | Production | **[Finance](../business/system-overview.md#glossary-finance)** | Automation: **[PR PO-Out](../business/system-overview.md#glossary-pr-po-out)** fields complete (`finance.service.js:374` `processRequisition`) | **[Admin & Log](../business/system-overview.md#glossary-admin-log)** records first **[AWB](../business/system-overview.md#glossary-awb)** field | history+tracking+`finance.po.production`; `po_customer_records.workflow_status='active'` |
| 4 | Shipped | Admin & Log | Automation: `awb_records.awb_tracking_number` first becomes present (`admin_log.service.js:209` `runAwbAutomation`) | Admin & Log records `transit_date` on same AWB | history+tracking+`admin_log.po.shipped`; AWB row flips to `current_awb_status='Registered'` |
| 5 | Customs | Admin & Log | Automation: `awb_records.transit_date` first becomes present (same `runAwbAutomation`) | Admin & Log records `arrival_date` | history+tracking+`admin_log.po.customs`; AWB row flips to `current_awb_status='Processed'` |
| 6 | Arrived | Admin & Log | Automation: `awb_records.arrival_date` first becomes present (same `runAwbAutomation`) | **[Technical](../business/system-overview.md#glossary-technical)** completes QC | history+tracking+`admin_log.po.arrived`; AWB row flips to `current_awb_status='Arrived'` |
| 7 | Inspected | Technical | `technical.service.js:1293` `submitQcReview` Approved+Submitted, or `runInstallationAutomation` inspection Complete + function test Pass (`technical.service.js:441`) | Admin & Log issues **[DO](../business/system-overview.md#glossary-do)** | history+tracking+`technical.po.inspected` |
| 8 | Delivery | Admin & Log | Automation: `delivery_orders.delivery_order_number` first becomes present (`admin_log.service.js:479` `runDoAutomation`) | Technical begins on-site work | history+tracking+`admin_log.po.delivery` |
| 9 | Installation | Technical | Automation: `installation_records.installation_start_date` first becomes present (`technical.service.js:471`) | Technical uploads **[BAST](../business/system-overview.md#glossary-bast)** | history+tracking+`technical.po.installation` |
| 10 | BAST | Technical | Automation: `installation_records.bast_upload_file_ids` provided (`technical.service.js:534`), PM BASTP upload (`technical.service.js:890`), or explicit `sendBastToFinance` (`technical.service.js:1509`) | Finance issues customer invoice | history+tracking+`technical.po.bast`; in-band `invoice_customers` draft created |
| 11 | Invoice | Finance | Automation: `invoice_customers.invoice_number` + attachment provided (`finance.service.js:808` `issueInvoiceCustomer`) | Terminal until payment closes the PO Customer record | history+tracking+`finance.po.invoice`; `po_customer_records.workflow_status='invoiced'` |

## Per-stage detail

For every stage the same four invariants run inside the `advanceStatus` transaction at `po.service.js:241-355`. The per-stage facts below are: who can call the transition (RBAC), the exact upstream caller, the columns mutated on `purchase_orders`, and the row shape written to history + tracking, and the notification template key. Status-history `status_code` values are uppercase (verified against the `purchase_order_status_history_status_code_chk` constraint at `migrations/003_purchase_orders.sql:65-68`); `status_label` matches the `STATUS_ORDER` casing at `po.service.js:30-33`.

### Stage 1: Registered

- RBAC: `[Sales]` (and `[Superadmin, CEO]` by virtue of `full_access`).
- Caller: `services/sales.service.js:613` `submitSalesPo` → `po.service.js:157` `initializeFromSales`. This is the only call site that creates the `purchase_orders` row; every later transition uses `advanceStatus`.
- `purchase_orders` columns set: `po_number`, `current_status='Registered'`, `created_by_user_id`, `created_by_role`, `updated_by_user_id`, `updated_by_role`, `customer_id`, `due_at` (mapped from `sales_purchase_orders.delivery_deadline`). See `po.service.js:176-183`.
- `purchase_order_status_history` row: `status_code='REGISTERED'`, `status_label='Registered'`, `note` and `attachment_url` from caller, `reason_if_delayed=NULL`. See `po.service.js:186-193`.
- `purchase_order_tracking_events` row: `event_type='po.created'`, payload `{status, actor_user_id, actor_role, note}`. See `po.service.js:195-205`.
- Notification: `sales.po.registered`. Default extra recipients `['sales','admin_log','finance']` (`po.service.js:80`).

### Stage 2: Processed

- RBAC: `[Sales]`.
- Caller: `services/sales.service.js:672` `processSalesPo` → `po.service.js:241` `advanceStatus({newStatus:'Processed'})`.
- `purchase_orders` columns mutated by `advanceStatus`: `current_status='Processed'`, `updated_by_user_id`, `updated_by_role`, `updated_at` (`po.service.js:266-275`). The Sales SLA reset (`step_due_at`) is on `sales_purchase_orders`, not `purchase_orders`.
- `purchase_order_status_history` row: `status_code='PROCESSED'`, `status_label='Processed'`, plus `note` and `reason_if_delayed` from caller (`po.service.js:277-285`).
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `{from:'Registered', to:'Processed', actor_user_id, actor_role, note, reason_if_delayed}` (`po.service.js:287-299`).
- Notification: `sales.po.processed`. Defaults `['admin_log','finance']`.

### Stage 3: Production

- RBAC: `[Finance]` — entered by automation (see Automation: PR PO-Out below), never by direct manual stage-advance.
- Caller: `services/finance.service.js:413` from inside `processRequisition`.
- `purchase_orders` columns mutated: as in `advanceStatus` (`current_status='Production'`, audit fields). `po_customer_records.workflow_status` flips from `registered` to `active` via the in-transaction mirror sync (`po.service.js:303` calling `syncPoCustomerMirror`).
- `purchase_order_status_history` row: `status_code='PRODUCTION'`, `status_label='Production'`, `note` defaults to `"PO Out <number> issued to manufacturer"`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `from='Processed', to='Production'`.
- Notification: `finance.po.production`. Defaults `['technical','admin_log','superadmin','ceo']` (`po.service.js:82`).

### Stage 4: Shipped

- RBAC: `[Admin & Log]`.
- Caller: `services/admin_log.service.js:272` from inside `runAwbAutomation`, with `newStatus:'Shipped'` when `awb_tracking_number` first becomes present on an `awb_records` row.
- `purchase_orders` columns mutated: per `advanceStatus`. The local `awb_records.current_awb_status` flips to `Registered` *before* the master PO advance (`admin_log.service.js:251-258`).
- `purchase_order_status_history` row: `status_code='SHIPPED'`, `status_label='Shipped'`, `note='AWB tracking number <X> entered'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `from=<prev>, to='Shipped'`.
- Notification: `admin_log.po.shipped`. Defaults `['sales','admin_log','technical']`. The AWB-scoped `admin_log.awb.shipped` template fires separately at `admin_log.service.js:284-293`.

### Stage 5: Customs

- RBAC: `[Admin & Log]`.
- Caller: `services/admin_log.service.js:272` from `runAwbAutomation`, with `newStatus:'Customs'` when `transit_date` first becomes present.
- `purchase_orders` columns mutated: per `advanceStatus`. AWB row flips to `current_awb_status='Processed'`.
- `purchase_order_status_history` row: `status_code='CUSTOMS'`, `status_label='Customs'`, `note='Transit date <X> recorded'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Customs'`.
- Notification: `admin_log.po.customs`. Defaults `['sales','admin_log']`. AWB-scoped `admin_log.awb.customs` fires alongside.

### Stage 6: Arrived

- RBAC: `[Admin & Log]`.
- Caller: `services/admin_log.service.js:272` from `runAwbAutomation`, with `newStatus:'Arrived'` when `arrival_date` first becomes present.
- `purchase_orders` columns mutated: per `advanceStatus`. AWB row flips to `current_awb_status='Arrived'`.
- `purchase_order_status_history` row: `status_code='ARRIVED'`, `status_label='Arrived'`, `note='Arrival date <X> recorded'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Arrived'`.
- Notification: `admin_log.po.arrived`. Defaults `['sales','admin_log','technical']`. AWB-scoped `admin_log.awb.arrived` fires alongside.

### Stage 7: Inspected

- RBAC: `[Technical]`.
- Caller (canonical): `services/technical.service.js:1341` from `submitQcReview`, fired when `inspection_qc_records.review_status='Approved'` and `final_submit_status='Submitted'`. Also fired earlier by the installation automation at `technical.service.js:459` when `inspection_status='Complete'` and `function_test_status='Pass'` — whichever lands first wins; the second is rejected as a no-op by the `current_status === newStatus` guard at `po.service.js:259`.
- `purchase_orders` columns mutated: per `advanceStatus`.
- `purchase_order_status_history` row: `status_code='INSPECTED'`, `status_label='Inspected'`, `note='QC <number> Approved + Submitted'` or `note='Installation <id>: inspection Complete + function test Pass'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Inspected'`.
- Notification: `technical.po.inspected`. Defaults `['sales','technical','admin_log']`; both QC and installation paths add `extraRoles=['admin_log','finance','superadmin','ceo']`.

### Stage 8: Delivery

- RBAC: `[Admin & Log]`.
- Caller: `services/admin_log.service.js:505` from inside `runDoAutomation`, when `delivery_orders.delivery_order_number` first becomes present.
- `purchase_orders` columns mutated: per `advanceStatus`. Local `delivery_orders.current_do_status` flips to `Registered` first (`admin_log.service.js:486-494`).
- `purchase_order_status_history` row: `status_code='DELIVERY'`, `status_label='Delivery'`, `note='DO number <X> entered'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Delivery'`.
- Notification: `admin_log.po.delivery`. Defaults `['sales','admin_log','technical']`. The DO-scoped `admin_log.do.registered` template fires alongside (`admin_log.service.js:513-522`).

### Stage 9: Installation

- RBAC: `[Technical]`.
- Caller: `services/technical.service.js:472` from `runInstallationAutomation`, when `installation_records.installation_start_date` first becomes present.
- `purchase_orders` columns mutated: per `advanceStatus`.
- `purchase_order_status_history` row: `status_code='INSTALLATION'`, `status_label='Installation'`, `note='On-site work started on <date>'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Installation'`.
- Notification: `technical.po.installation`. Defaults `['sales','technical']`; caller adds `extraRoles=['superadmin','ceo','sales']`.

### Stage 10: BAST

- RBAC: `[Technical]`.
- Caller: three entry points, all into `po.service.js:241` `advanceStatus({newStatus:'BAST'})`:
  - Installation BAST upload at `technical.service.js:559` (creates a `bast_records` row + Finance invoice draft, see Automation: BAST signed below).
  - PM BASTP upload at `technical.service.js:890`.
  - Direct `services/technical.service.js:1509` `sendBastToFinance` against an existing `bast_records` row, called at line 1560.
- `purchase_orders` columns mutated: per `advanceStatus`.
- `purchase_order_status_history` row: `status_code='BAST'`, `status_label='BAST'`, `note='BAST <number> uploaded via installation <id>'` or PM-equivalent.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='BAST'`.
- Notification: `technical.po.bast`. Defaults `['sales','technical','finance']`; caller adds `extraRoles=['finance','superadmin','ceo']`.

### Stage 11: Invoice

- RBAC: `[Finance]`.
- Caller: `services/finance.service.js:847` from inside `issueInvoiceCustomer`, fired when both `invoice_number` is entered and at least one invoice attachment is bound.
- `purchase_orders` columns mutated: per `advanceStatus`. `po_customer_records.workflow_status` flips to `invoiced` via `syncPoCustomerMirror` (mapping at `po.service.js:104-108`).
- `purchase_order_status_history` row: `status_code='INVOICE'`, `status_label='Invoice'`, `note='Customer invoice <X> issued'`.
- `purchase_order_tracking_events` row: `event_type='po.status_advanced'`, payload `to='Invoice'`.
- Notification: `finance.po.invoice`. Defaults `['superadmin','ceo','sales','admin_log']` (`po.service.js:90`). The Invoice Customer row also emits its own `finance.invoice_customer.processed` template at `finance.service.js:855`.

## Automations

The five field-write triggers below are the only paths through which a PO advances without an explicit user clicking "transition". Every automation flows through `po.service.js:241` `advanceStatus`, so the four invariants (history + tracking + notification + status update) are honored identically. Each automation is idempotent: `po.service.js:259` returns the row unchanged if the PO is already at the requested stage, and `po.service.js:260-264` rejects any attempt to move backwards.

### Automation: AWB created → Shipped/Customs/Arrived

- Trigger: any of three fields on `awb_records` becoming non-null on a save: `awb_tracking_number`, `transit_date`, `arrival_date`. These are independent and may all land in the same write — the automation replays them in PO-lifecycle order so forward motion is preserved.
- Service function: `services/admin_log.service.js:209` `runAwbAutomation`, which builds the `transitions` array (`admin_log.service.js:217-244`) and loops calling `poService.advanceStatus` at `admin_log.service.js:272`.
- Side effects per fired field, all inside one transaction:
  - `awb_records.current_awb_status` updated to `Registered` / `Processed` / `Arrived` (`admin_log.service.js:251-258`).
  - Local AWB-scoped history row written via `writeAwbHistory` (`admin_log.service.js:262-267`).
  - Master PO advance via `advanceStatus` writes `purchase_order_status_history` + `purchase_order_tracking_events` + the `admin_log.po.*` template.
  - AWB-scoped notification (`admin_log.awb.shipped` / `customs` / `arrived`) emitted with `extraRoles=['finance','technical','superadmin','ceo']` (`admin_log.service.js:284-293`).
- RBAC: `[Admin & Log]` writes to AWB. Read fan-out includes Sales, Technical, Finance, **[Superadmin](../business/system-overview.md#glossary-superadmin)**, **[CEO](../business/system-overview.md#glossary-ceo)**.

### Automation: DO created → Delivery

- Trigger: `delivery_orders.delivery_order_number` first becoming present. (A second trigger on `customer_arrival_date` updates the DO's local status to `Arrived` but does *not* advance the master PO, since Delivery is the only DO-owned PO stage — see `admin_log.service.js:525-555`.)
- Service function: `services/admin_log.service.js:479` `runDoAutomation`, calling `advanceStatus({newStatus:'Delivery'})` at `admin_log.service.js:505`.
- Side effects:
  - `delivery_orders.current_do_status='Registered'` (`admin_log.service.js:486-494`).
  - Local DO history via `writeDoHistory` with `status_code='DELIVERY'`.
  - Master PO advance + `admin_log.po.delivery` template.
  - DO-scoped `admin_log.do.registered` template emitted with `extraRoles=['finance','technical','superadmin','ceo']` (`admin_log.service.js:513-522`).
- RBAC: `[Admin & Log]`.

### Automation: PR (Purchase Requisition) marked PO-Out → Production

- Trigger: `purchase_requisitions` row simultaneously carries `po_out_number`, `po_out_date`, and at least one PO-Out attachment bound via `attachment_ids`. See **[PR PO-Out](../business/system-overview.md#glossary-pr-po-out)**.
- Service function: `services/finance.service.js:374` `processRequisition`. The state guard at line 387 rejects double-fire (already `Processed`); line 390 rejects PRs without a linked master PO. The advance is at `finance.service.js:413`.
- Side effects, all in one transaction:
  - `purchase_requisitions.current_pr_status='Processed'`, `po_out_number`, `po_out_date` persisted (`finance.service.js:400-410`).
  - PR attachments bound via `attachFilesToEntity` (`finance.service.js:396-398`).
  - Master PO advance Processed → Production via `advanceStatus`, which fires `finance.po.production` and syncs `po_customer_records.workflow_status='active'`.
  - PR-scoped `finance.pr.processed` template emitted on top with `extraRoles=['finance','sales','superadmin','ceo']` (`finance.service.js:421-430`).
- RBAC: `[Finance]`.

### Automation: BAST signed → Invoice draft created

- Trigger: any of three field writes that produce a `bast_records` row plus a Finance invoice draft:
  - `installation_records.bast_upload_file_ids` non-empty on save AND `workflow_phase != 'completed'` (`technical.service.js:530-534`).
  - PM completion BASTP attachment upload (`technical.service.js:890`).
  - Explicit Technical action `sendBastToFinance` against an existing `bast_records` row (`technical.service.js:1509`).
- Service function: `services/technical.service.js:441` `runInstallationAutomation` (Trigger 4 block, lines 525-588) is the most-exercised path. It (a) creates a real `bast_records` row via `createBastRecordForHandoff` (`technical.service.js:540-548`), (b) calls `financeService.createInvoiceCustomerDraftFromBast` to seed a draft `invoice_customers` row (`technical.service.js:550-557`), (c) advances the master PO at `technical.service.js:559`. Idempotency guard at `technical.service.js:533-534` (`alreadyHandedOff`) prevents duplicate drafts on re-save.
- Side effects:
  - `bast_records` row inserted; `invoice_customers` draft row inserted at `invoice_status='Registered'`.
  - Master PO advance → BAST + `technical.po.bast` template.
  - BAST-scoped `technical.bast.submitted` template emitted with `extraRoles=['finance','superadmin','ceo']` (`technical.service.js:568-577`).
  - `installation_records.workflow_phase='completed'` set last as the idempotency anchor (`technical.service.js:579-586`).
- RBAC: `[Technical]`.

### Automation: Invoice Customer issued → Invoice stage

- Trigger: `invoice_customers` row simultaneously carries an `invoice_number` and at least one bound invoice attachment, and is currently at `invoice_status='Registered'`.
- Service function: `services/finance.service.js:808` `issueInvoiceCustomer`. State guard at line 819 rejects double-fire (already `Processed`); line 824 rejects rows without a linked master PO. The advance is at `finance.service.js:847`.
- Side effects:
  - `invoice_customers` updated: `invoice_number`, `invoice_date` (defaulted to `now()::date` if absent), `invoice_status='Processed'` (`finance.service.js:834-844`).
  - Invoice attachments bound (`finance.service.js:830-832`).
  - Master PO advance → Invoice via `advanceStatus`, which fires `finance.po.invoice` and syncs `po_customer_records.workflow_status='invoiced'`.
  - Invoice-scoped `finance.invoice_customer.processed` template emitted on top (`finance.service.js:855-861`).
- RBAC: `[Finance]`.

## Audit-trail contract

Every transition writes one row to `purchase_order_status_history` (schema: `migrations/003_purchase_orders.sql:53-69`) and one row to `purchase_order_tracking_events` (schema: `migrations/003_purchase_orders.sql:76-82`). The mandatory transition fields, in service-layer terms:

- `updated_by_user_id` — actor user UUID. Always passed by callers as `actorUserId`. Source: `po.service.js:191` (initialize) and `po.service.js:283-284` (advance).
- `updated_by_role` — actor role slug. Always passed by callers as `actorRole`.
- `updated_at` — set by the `UPDATE purchase_orders ... SET updated_at = now()` clause at `po.service.js:271`.
- `note` — optional free-text describing what triggered the transition. Convention: callers always supply one (e.g. `"AWB tracking number <X> entered"`, `"On-site work started on <date>"`).
- `reason_if_delayed` — populated only when the transition is happening in response to an SLA breach being justified. Surfaces in PO Tracking history.

Database-enforced NOT NULL on the history table is narrower than the service-layer mandatory list. Verified at `migrations/003_purchase_orders.sql:53-69`:

- NOT NULL: `id`, `po_id` (line 55), `po_number` (line 56), `status_code` (line 57), `status_label` (line 58), `created_at` (line 64).
- NULLABLE in DB but required by `po.service.js`: `updated_by_user_id`, `updated_by_role`, `note`, `reason_if_delayed`, `attachment_url`.

Treat the service layer as the enforcing layer for actor/note/reason fields. Bypassing `po.service.js` to write `purchase_order_status_history` directly is forbidden — there are no controllers that do this and no future ones should. The four-invariant contract (CLAUDE.md) is encoded in the single transaction at `po.service.js:241-355`; the database guarantees only the structural floor (FK to `purchase_orders`, the `status_code` enum check at `migrations/003_purchase_orders.sql:65-68`, and the `current_status` enum check at `migrations/003_purchase_orders.sql:42-45`).

```javascript
// services/po.service.js — the canonical history insert (advanceStatus)
await c.query(
    `INSERT INTO purchase_order_status_history
       (po_id, po_number, status_code, status_label,
        updated_by_user_id, updated_by_role, note, reason_if_delayed,
        attachment_url)
     VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)`,
    [po.id, po.po_number, STATUS_CODE[newStatus], newStatus,
        actorUserId, actorRole, note, reasonIfDelayed, attachmentUrl],
);
```

The companion `purchase_order_tracking_events` row carries the structured `payload_json` (`po.service.js:288-298`); this is the JSONB feed used by PO Tracking screens for richer queries than the strict history table allows.

## Extension recipe

Adding a 12th stage (or any new stage between existing ones) is a five-touchpoint change. Skipping any of them silently breaks one of the four invariants — do all five.

1. **Migration: extend the enum.** Add a new migration (do not edit `003_purchase_orders.sql` in place) that drops and re-adds the two CHECK constraints to include the new label and uppercase status_code:
   ```sql
   -- migrations/0NN_po_stage_<name>.sql
   ALTER TABLE purchase_orders
     DROP CONSTRAINT purchase_orders_status_chk,
     ADD  CONSTRAINT purchase_orders_status_chk CHECK (current_status IN (
       'Registered','Processed','Production','Shipped','Customs','Arrived',
       'Inspected','Delivery','Installation','BAST','Invoice','<NewStage>'));
   ALTER TABLE purchase_order_status_history
     DROP CONSTRAINT purchase_order_status_history_status_code_chk,
     ADD  CONSTRAINT purchase_order_status_history_status_code_chk CHECK (status_code IN (
       'REGISTERED','PROCESSED','PRODUCTION','SHIPPED','CUSTOMS','ARRIVED',
       'INSPECTED','DELIVERY','INSTALLATION','BAST','INVOICE','<NEWSTAGE>'));
   ```

2. **Service: extend `po.service.js`.** Append the new label to `STATUS_ORDER` (`po.service.js:30-33`) at the correct position, add the corresponding entry in `STATUS_CODE` (`po.service.js:35-47`), `STATUS_TEMPLATE` (`po.service.js:52-64`), and `STATUS_DEFAULT_RECIPIENTS` (`po.service.js:79-91`). If the new stage maps to a `po_customer_records.workflow_status` other than `active`, extend `poCustomerWorkflowFor` (`po.service.js:104-108`).

3. **Notification template seed.** Add a row to `notification_templates` with `template_key` matching the value you put in `STATUS_TEMPLATE` (the migration that seeds notification templates is the appropriate place). Without a template row the dispatch falls back to dashboard-only delivery; that is a soft failure mode, not a crash, so omitting this step will not surface as a test failure.

4. **History + tracking automatic.** No code change needed: `advanceStatus` writes both rows generically (`po.service.js:277-299`). Just make sure the upstream service that triggers the new transition calls `poService.advanceStatus({newStatus:'<NewStage>'})` from inside its own transaction (pattern: `admin_log.service.js:272`, `finance.service.js:413`, `technical.service.js:559`). Never skip this and write history directly.

5. **Frontend status badge mapping.** The PO Tracking pages read `purchase_orders.current_status` and render a colored badge keyed off that string. Extend the mapping in `frontend/src/components/po-tracking/StageBadge.tsx` (or the equivalent component) and add a column entry in the per-division dashboard widgets that aggregate stage counts. Without this the badge falls through to a default/grey rendering — non-fatal but visibly wrong.

After the migration is applied and the service is redeployed, smoke-check by submitting a Sales PO end-to-end and watching `purchase_order_status_history` accumulate one row per stage transition with the expected `status_code` strings. If a row is missing for the new stage, the upstream service forgot step 4.

<!--
drift-anchors:
- backend/src/services/po.service.js
- backend/src/services/sales.service.js
- backend/src/services/admin_log.service.js
- backend/src/services/finance.service.js
- backend/src/services/technical.service.js
- backend/migrations/003_purchase_orders.sql
- backend/migrations/013_sla_and_workflow.sql
- interlabs-crm-demo/docs/CTX_master_context.txt
- interlabs-crm-demo/docs/MOD_sales.txt
- interlabs-crm-demo/docs/MOD_finance.txt
- interlabs-crm-demo/docs/MOD_admin_log.txt
- interlabs-crm-demo/docs/MOD_technical.txt
- CLAUDE.md
-->
