---
audience: dev
reading_time: 15 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- backend/src/routes/sales.routes.js
- backend/src/services/sales.service.js
- backend/src/validators/sales.validators.js
- backend/src/services/po.service.js
- backend/src/services/finance.service.js
- backend/src/jobs/scheduler.js
- backend/migrations/003_purchase_orders.sql
- backend/migrations/004_customers.sql
- backend/migrations/005_sales_forms.sql
- frontend/lib/sales-api.ts
- frontend/lib/sales-types.ts
- frontend/lib/sales-ui.ts
- frontend/app/(app)/sales/
- interlabs-crm-demo/docs/MOD_sales.txt
-->

# Sales module

## Purpose

The **[Sales](../../business/system-overview.md#glossary-sales)** module owns the customer-facing top of the funnel: prospecting, quoting, costing, and originating customer **[PO](../../business/system-overview.md#glossary-po)**s. It is the only division that creates rows in `purchase_orders` — every downstream stage transition is performed by another module against a master PO that Sales registered. Sales owns lifecycle stages 1 (`Registered`) and 2 (`Processed`); see `../po-state-machine.md` for the full 11-stage contract that picks up where Sales hands off.

## Forms / entities owned

- **Customer** — `customers` (migration `004_customers.sql:10`); referenced by every other Sales form and by Finance, Technical, and **[Admin & Log](../../business/system-overview.md#glossary-admin-log)**.
- **Sales Forecast** — `sales_forecasts` (`005_sales_forms.sql:30`); 6-stage CRM funnel (`Prospect`..`Lost`) with internal `draft → submitted → closed` workflow.
- **[Quotation](../../business/system-overview.md#glossary-quotation)** — `quotations` (`005_sales_forms.sql:69`); customer-facing price quote, `draft → submitted → revised → accepted → rejected`.
- **[HPP](../../business/system-overview.md#glossary-hpp)** (Harga Pokok Penjualan) — `harga_pokok_penjualan` (`005_sales_forms.sql:109`); cost-of-goods-sold worksheet, `draft → submitted → approved`.
- **Sales Purchase Order** — `sales_purchase_orders` (`005_sales_forms.sql:143`); the form-side wrapper around the master PO. On submit it originates the master `purchase_orders` row and back-fills `po_id`. See `../po-state-machine.md#stage-1-registered`.
- **Sales Purchase Request** (**[PR](../../business/system-overview.md#glossary-pr)**) — `purchase_requests_sales` (`005_sales_forms.sql:184`); on submit, mirrors a `purchase_requisitions` row in **[Finance](../../business/system-overview.md#glossary-finance)** (handoff documented in `./finance.md`).

Handoff to Finance / Admin & Log / **[Technical](../../business/system-overview.md#glossary-technical)** / **[Tax & Insurance](../../business/system-overview.md#glossary-tax-insurance)** / **[HRGA](../../business/system-overview.md#glossary-hrga)** is documented in `../po-state-machine.md`.

## Routes

All routes mount `authMiddleware` (`sales.routes.js:15`); list endpoints scope by `created_by = req.user.id` for non-**[Superadmin](../../business/system-overview.md#glossary-superadmin)** / non-**[CEO](../../business/system-overview.md#glossary-ceo)** callers (`sales.routes.js:20-24`). RBAC bracket notation below records the *effective* recipient set after the same-role / global resolution in `rbac.middleware.js`; capability strings are the literal `(feature, capability)` pairs passed to `rbacGuard()`.

| Method + Path | RBAC `(feature, capability)` | Validator | Service entry | Source |
|---|---|---|---|---|
| `GET /api/sales/customers` | `(customers, view_own)` | `customerListQuery` | `sales.listCustomers` | `sales.routes.js:34` |
| `GET /api/sales/customers/:id` | `(customers, view_own)` | `idParam` | `sales.getCustomer` | `sales.routes.js:47` |
| `POST /api/sales/customers` | `(customers, create)` | `customerCreate` | `sales.createCustomer` | `sales.routes.js:57` |
| `PUT /api/sales/customers/:id` | `(customers, edit)` | `customerUpdate` | `sales.updateCustomer` | `sales.routes.js:67` |
| `DELETE /api/sales/customers/:id` | `(customers, delete)` | `idParam` | `sales.deleteCustomer` | `sales.routes.js:77` |
| `GET /api/sales/forecasts` | `(sales_forecast, view_own)` | `forecastListQuery` | `sales.listForecasts` | `sales.routes.js:91` |
| `GET /api/sales/forecasts/:id` | `(sales_forecast, view_own)` | `idParam` | `sales.getForecast` | `sales.routes.js:104` |
| `POST /api/sales/forecasts` | `(sales_forecast, create)` | `forecastCreate` | `sales.createForecast` | `sales.routes.js:113` |
| `PUT /api/sales/forecasts/:id` | `(sales_forecast, edit)` | `forecastUpdate` | `sales.updateForecast` | `sales.routes.js:122` |
| `POST /api/sales/forecasts/:id/submit` | `(sales_forecast, edit)` | `idParam` | `sales.submitForecast` | `sales.routes.js:131` |
| `DELETE /api/sales/forecasts/:id` | `(sales_forecast, delete)` | `idParam` | `sales.deleteForecast` | `sales.routes.js:140` |
| `GET /api/sales/quotations` | `(quotation, view_own)` | `quotationListQuery` | `sales.listQuotations` | `sales.routes.js:154` |
| `GET /api/sales/quotations/:id` | `(quotation, view_own)` | `idParam` | `sales.getQuotation` | `sales.routes.js:167` |
| `POST /api/sales/quotations` | `(quotation, create)` | `quotationCreate` | `sales.createQuotation` | `sales.routes.js:176` |
| `PUT /api/sales/quotations/:id` | `(quotation, edit)` | `quotationUpdate` | `sales.updateQuotation` | `sales.routes.js:185` |
| `POST /api/sales/quotations/:id/transition` | `(quotation, edit)` | `quotationTransition` | `sales.transitionQuotation` | `sales.routes.js:194` |
| `DELETE /api/sales/quotations/:id` | `(quotation, delete)` | `idParam` | `sales.deleteQuotation` | `sales.routes.js:205` |
| `GET /api/sales/harga-pokok-penjualan` | `(hpp, view_own)` | `hppListQuery` | `sales.listHpp` | `sales.routes.js:219` |
| `GET /api/sales/harga-pokok-penjualan/:id` | `(hpp, view_own)` | `idParam` | `sales.getHpp` | `sales.routes.js:232` |
| `POST /api/sales/harga-pokok-penjualan` | `(hpp, create)` | `hppCreate` | `sales.createHpp` | `sales.routes.js:241` |
| `PUT /api/sales/harga-pokok-penjualan/:id` | `(hpp, edit)` | `hppUpdate` | `sales.updateHpp` | `sales.routes.js:250` |
| `POST /api/sales/harga-pokok-penjualan/:id/transition` | `(hpp, edit)` | `hppTransition` | `sales.transitionHpp` | `sales.routes.js:259` |
| `DELETE /api/sales/harga-pokok-penjualan/:id` | `(hpp, delete)` | `idParam` | `sales.deleteHpp` | `sales.routes.js:270` |
| `GET /api/sales/purchase-orders` | `(sales_po, view_own)` | `salesPoListQuery` | `sales.listSalesPo` | `sales.routes.js:284` |
| `GET /api/sales/purchase-orders/:id` | `(sales_po, view_own)` | `idParam` | `sales.getSalesPo` | `sales.routes.js:297` |
| `POST /api/sales/purchase-orders` | `(sales_po, create)` | `salesPoCreate` | `sales.createSalesPo` | `sales.routes.js:306` |
| `PUT /api/sales/purchase-orders/:id` | `(sales_po, edit)` | `salesPoUpdate` | `sales.updateSalesPo` | `sales.routes.js:315` |
| `POST /api/sales/purchase-orders/:id/submit` | `(sales_po, edit)` | `idParam` | `sales.submitSalesPo` | `sales.routes.js:325` |
| `POST /api/sales/purchase-orders/:id/process` | `(sales_po, edit)` | `salesPoProcess` | `sales.processSalesPo` | `sales.routes.js:335` |
| `POST /api/sales/purchase-orders/:id/overdue-reason` | `(sales_po, edit)` | `salesPoOverdueReason` | `sales.submitOverdueReason` | `sales.routes.js:345` |
| `DELETE /api/sales/purchase-orders/:id` | `(sales_po, delete)` | `idParam` | `sales.deleteSalesPo` | `sales.routes.js:355` |
| `GET /api/sales/purchase-requests` | `(sales_pr, view_own)` | `salesPrListQuery` | `sales.listSalesPr` | `sales.routes.js:369` |
| `GET /api/sales/purchase-requests/:id` | `(sales_pr, view_own)` | `idParam` | `sales.getSalesPr` | `sales.routes.js:382` |
| `POST /api/sales/purchase-requests` | `(sales_pr, create)` | `salesPrCreate` | `sales.createSalesPr` | `sales.routes.js:391` |
| `PUT /api/sales/purchase-requests/:id` | `(sales_pr, edit)` | `salesPrUpdate` | `sales.updateSalesPr` | `sales.routes.js:400` |
| `POST /api/sales/purchase-requests/:id/submit` | `(sales_pr, edit)` | `idParam` | `sales.submitSalesPr` | `sales.routes.js:410` |
| `DELETE /api/sales/purchase-requests/:id` | `(sales_pr, delete)` | `idParam` | `sales.deleteSalesPr` | `sales.routes.js:419` |

## Validators

Defined in `sales.validators.js`. Shared primitives at the top: `uuid` (Joi v4), `currency ∈ {IDR, USD, EUR}`, `amount = number ≥ 0, precision 2`, `percent = 0..100, precision 2`, `idParam = { id: uuid }`, `listQuery = { page, limit ≤ 200, search ≤ 200 }`, and `itemListEntry` (line-item shape, `unknown(true)` so per-form fields can extend).

### customerCreate / customerUpdate / customerListQuery

`customerCore` keys (`sales.validators.js:40-55`): `company_name` (string ≤ 500, **required on create**), `trade_name`, `address`, `city`, `country`, `phone`, `email` (Joi.email), `website` (http/https URI), `npwp` (**[NPWP](../../business/system-overview.md#glossary-npwp)**), `pic_name`, `pic_phone`, `pic_email`, `customer_status ∈ {Active, Inactive}`, `notes`. `customerUpdate` requires at least one key (`.min(1)`). `customerListQuery` adds `status` filter.

### forecastCreate / forecastUpdate / forecastListQuery

`forecastCore` (`sales.validators.js:74-89`): `customer_id` (uuid|null), `product_or_service_name` (≤ 500, **required on create**), `description`, `forecast_period_start`, `forecast_period_end` (ISO dates), `currency`, `estimated_value` (amount), `probability_percent` (0..100), `stage ∈ {Prospect, Qualified, Proposal, Negotiation, Won, Lost}`, `expected_close_date`, `pic_user_id` (uuid), `notes`, `workflow_status ∈ {draft, submitted, closed}`, `current_step` (≤ 100). `forecastListQuery` adds `stage` filter.

### quotationCreate / quotationUpdate / quotationTransition / quotationListQuery

`quotationCore` (`sales.validators.js:108-128`): `quotation_number`, `customer_id`, `related_forecast_id`, `quotation_date`, `validity_date`, `currency`, `item_list` (array of `itemListEntry`), `subtotal`, `discount_percent`, `discount_amount`, `tax_percent`, `tax_amount`, `total_amount`, `payment_terms`, `delivery_terms`, `warranty_terms`, `notes`, `workflow_status ∈ {draft, submitted, revised, accepted, rejected}`, `current_step`. Both `quotationCreate` and `quotationUpdate` use the same shape (no field is required at create time); `quotationUpdate` requires `.min(1)`. `quotationTransition` is a strict guard:

```js
// excerpt — sales.validators.js:132
const quotationTransition = Joi.object({
    workflow_status: Joi.string()
        .valid('submitted', 'revised', 'accepted', 'rejected')
        .required(),
});
```

### hppCreate / hppUpdate / hppTransition / hppListQuery

`hppCore` (`sales.validators.js:147-159`): `customer_id`, `related_quotation_id`, `hpp_date`, `currency`, `item_list`, `total_cost`, `total_selling_price`, `gross_margin_total`, `notes`, `workflow_status ∈ {draft, submitted, approved}`, `current_step`. `hppTransition.workflow_status ∈ {submitted, approved}` (required).

### salesPoCreate / salesPoUpdate / salesPoProcess / salesPoOverdueReason / salesPoListQuery

`salesPoCore` (`sales.validators.js:176-191`): `po_number` (the customer-supplied number, optional — falls back to `po_record_number` on submit; see `submitSalesPo`), `customer_id`, `related_quotation_id`, `order_date`, `delivery_deadline`, `currency`, `payment_terms`, `delivery_terms`, `item_list`, `subtotal`, `tax_amount`, `total_amount`, `notes`, `current_step`. Note: `workflow_status` is **not** in the core schema — it is server-controlled (set by `submitSalesPo` / `processSalesPo`). `salesPoProcess.note ≤ 2000` (optional). `salesPoOverdueReason.reason` is required (3..2000 chars), `attachment_id` (uuid|null) optional.

### salesPrCreate / salesPrUpdate / salesPrListQuery

`salesPrCore` (`sales.validators.js:212-227`): `related_po_id`, `customer_id`, `supplier_or_manufacturer`, `manufacturer_contact`, `manufacturer_email`, `pr_date`, `currency`, `item_list`, `incoterm`, `delivery_time`, `payment_terms`, `shipping_address`, `notes`, `current_step`. `workflow_status` again is server-controlled (`draft → submitted → copied_to_finance`).

## Services

All Sales mutations go through `sales.service.js`. Every form carries a uniform SLA instrumentation block (`workflow_status`, `current_step`, `step_due_at`, `step_status`, `last_progress_at`); on submission/transition, the service calls `computeStepDueAt()` (= `now + 2 working days` via `utils/workingDays.addWorkingDays`, `sales.service.js:23`) and resets `last_progress_at = now()`, `step_status = 'on_track'`. See `SLA hooks` below for why this column is wired but not yet consumed by a job.

### computeStepDueAt(anchor?, days?)

Helper exported for tests. Anchor defaults to now; `days` defaults to `SALES_FORM_SLA_DAYS = 2`. (`sales.service.js:23`)

### listCustomers / getCustomer / createCustomer / updateCustomer / deleteCustomer

Standard CRUD. `createCustomer` (`sales.service.js:104`) wraps in `db.withTransaction`, allocates the next `customer_record_number` via `nextRecordNumber(c, 'customers', 'customer_record_number', SALES_PREFIXES.CUSTOMER)`, defaults `customer_status` to `'Active'`. Soft-delete via `deleteCustomer` (`sales.service.js:161`). All writes set `created_by` / `updated_by = actor.id`. No notifications fired by this entity.

### listForecasts / getForecast / createForecast / updateForecast / submitForecast / deleteForecast

`createForecast` (`sales.service.js:189`) initializes the SLA window and defaults `stage = 'Prospect'`, `workflow_status = 'draft'`. `submitForecast` (`sales.service.js:249`) flips `workflow_status='submitted'` and resets `step_due_at`. No notifications are emitted by Forecast — it is a Sales-internal workflow.

### listQuotations / getQuotation / createQuotation / updateQuotation / transitionQuotation / deleteQuotation

`createQuotation` (`sales.service.js:298`) JSON-stringifies `item_list` for the JSONB column. `transitionQuotation` (`sales.service.js:369`) re-validates the target against the in-service whitelist `{submitted, revised, accepted, rejected}` (defence-in-depth on top of `quotationTransition`). No notifications.

### listHpp / getHpp / createHpp / updateHpp / transitionHpp / deleteHpp

Mirror of Quotation. `transitionHpp` whitelist is `{submitted, approved}` (`sales.service.js:476`). No notifications.

### listSalesPo / getSalesPo / createSalesPo / updateSalesPo / submitSalesPo / processSalesPo / submitOverdueReason / deleteSalesPo

`getSalesPo` (`sales.service.js:528`) hydrates `attachments` from `file_attachments` via `utils/attachments.listAttachmentsForEntity('sales.purchase_orders', id)`. `updateSalesPo` (`sales.service.js:564`) hard-rejects edits when `workflow_status='processed'` (`ConflictError`: "Processed Sales POs are immutable; open a corrective record."). `deleteSalesPo` rejects soft-delete once `po_id` is set (master PO already exists — `sales.service.js:760`).

`submitSalesPo` (`sales.service.js:613`) is the originating write of the entire 11-stage lifecycle:

```js
// excerpt — sales.service.js:632 (inside withTransaction)
const masterPo = await poService.initializeFromSales(c, {
    poNumber:    masterPoNumber,
    customerId:  row.customer_id,
    dueAt:       row.delivery_deadline,
    actorUserId: actor.id,
    actorRole:   actor.role,
    note:        `Sales PO ${row.po_record_number} submitted`,
});
```

It then back-fills `po_id`, flips `workflow_status='submitted'`, and calls `financeService.createPoCustomerFromSalesPo` to materialize the Finance-side mirror. Notifications fired (via `po.service`): `sales.po.registered`. See `../po-state-machine.md#stage-1-registered`.

`processSalesPo` (`sales.service.js:672`) advances master PO `Registered → Processed` via `poService.advanceStatus`. Requires `workflow_status ∈ {submitted, overdue}` and a non-null `po_id`. Fires `sales.po.processed` (`po.service.js:54`). See `../po-state-machine.md#stage-2-processed`.

`submitOverdueReason` (`sales.service.js:726`) writes `overdue_reason` + `overdue_attachment_id`, flips `step_status='on_track'`, and (if `po_id` set) calls `poService.flagOverdue` with `templateKey='sales.po.delay_justified'`. This is the reverse of the SLA escalation event documented in `../notifications.md`.

### listSalesPr / getSalesPr / createSalesPr / updateSalesPr / submitSalesPr / deleteSalesPr

`updateSalesPr` (`sales.service.js:826`) hard-rejects edits at `workflow_status='copied_to_finance'`. `submitSalesPr` (`sales.service.js:873`) resolves `(master_po_id, po_customer_id)` from the linked Sales PO, then delegates to `financeService.createRequisitionFromSalesPr` (which inserts `purchase_requisitions` at `current_pr_status='Registered'` and emits `finance.pr.registered` — `finance.service.js:347`). Sales-side row flips to `workflow_status='copied_to_finance'`. `deleteSalesPr` rejects deletion once copied.

## DB tables

- `customers` (`004_customers.sql:10`) — `id uuid PK`, `customer_record_number text UNIQUE NOT NULL` (`CUST-YYYY-NNNNN`), `company_name text NOT NULL`, plus `trade_name`, `address`, `city`, `country`, `phone`, `email`, `website`, `npwp`, `pic_*`, `customer_status text DEFAULT 'Active' CHECK IN ('Active','Inactive')`, `notes`. Audit: `created_by`/`updated_by` FK `users(id) ON DELETE SET NULL`, `created_at`/`updated_at timestamptz DEFAULT now()`, `deleted_at` (soft delete). Closes the forward FK `purchase_orders.customer_id → customers(id)` (`004_customers.sql:37`).

- `sales_forecasts` (`005_sales_forms.sql:30`) — `forecast_record_number UNIQUE`, `customer_id FK → customers ON DELETE SET NULL`, `pic_user_id FK → users ON DELETE SET NULL`, `stage CHECK IN (Prospect,Qualified,Proposal,Negotiation,Won,Lost)`, `workflow_status CHECK IN (draft,submitted,closed)`, `step_status CHECK IN (on_track,overdue)`, `probability_percent CHECK 0..100`. Soft delete via `deleted_at`.

- `quotations` (`005_sales_forms.sql:69`) — `quotation_record_number UNIQUE`, `quotation_number` (customer-facing), `customer_id`, `related_forecast_id FK → sales_forecasts ON DELETE SET NULL`, `item_list jsonb DEFAULT '[]'`, `workflow_status CHECK IN (draft,submitted,revised,accepted,rejected)`, full SLA columns + soft delete.

- `harga_pokok_penjualan` (`005_sales_forms.sql:109`) — `hpp_record_number UNIQUE`, `customer_id`, `related_quotation_id FK → quotations ON DELETE SET NULL`, `item_list jsonb`, `total_cost`/`total_selling_price`/`gross_margin_total numeric(20,2)`, `workflow_status CHECK IN (draft,submitted,approved)`.

- `sales_purchase_orders` (`005_sales_forms.sql:143`) — `po_record_number UNIQUE`, `po_number` (customer-supplied; falls back to `po_record_number`), `related_quotation_id FK → quotations`, `po_id FK → purchase_orders ON DELETE SET NULL` (back-filled by `submitSalesPo`), `item_list jsonb`, `overdue_reason text`, `overdue_attachment_id uuid` (FK closed in migration 012 → `file_attachments`), `workflow_status CHECK IN (draft,submitted,processed,overdue)`. The 'overdue' state is reserved for the not-yet-implemented SLA monitor (see below).

- `purchase_requests_sales` (`005_sales_forms.sql:184`) — `pr_record_number UNIQUE`, `related_po_id FK → sales_purchase_orders ON DELETE SET NULL`, `customer_id`, supplier/manufacturer fields, `incoterm` text, `item_list jsonb`, `workflow_status CHECK IN (draft,submitted,copied_to_finance)`.

All Sales tables share the same SLA monitoring columns: `workflow_status`, `current_step`, `step_due_at timestamptz`, `step_status`, `last_progress_at` (`005_sales_forms.sql:14-17`). All use `gen_random_uuid()` PKs, `timestamptz` timestamps, and soft delete via `deleted_at`.

## Notifications fired

Sales emits three template codes directly or transitively (via `po.service` / `finance.service`). The full template catalogue lives in `../notifications.md`.

| Template code | Trigger | Default recipients |
|---|---|---|
| `sales.po.registered` | `submitSalesPo` → `poService.initializeFromSales` | [Sales,Admin&Log,Finance] |
| `sales.po.processed` | `processSalesPo` → `poService.advanceStatus(Processed)` | [Admin&Log,Finance] |
| `sales.po.delay_justified` | `submitOverdueReason` → `poService.flagOverdue` | [Superadmin,CEO,Admin&Log,Finance] |
| `finance.pr.registered` | `submitSalesPr` → `financeService.createRequisitionFromSalesPr` | [Finance] |
| `sales.po.overdue` | (SLA job — not yet implemented; see below) | [Superadmin,CEO,Admin&Log,Finance] |

Recipients align with `STATUS_DEFAULT_RECIPIENTS` (`po.service.js:79-91`); a `notification_templates` row may override these via `recipient_roles_json`. Forecast / Quotation / HPP transitions emit no notifications — they are Sales-internal workflows.

## Automations

### Incoming

None. Sales is a top-of-funnel module; no other module mutates Sales rows. (Verified by greps for `sales_forecasts`, `quotations`, `harga_pokok_penjualan`, `sales_purchase_orders`, `purchase_requests_sales` across other service files.) Other modules read `customers` and `sales_purchase_orders.po_id`, but never write into Sales-owned tables.

### Outgoing

- **PO origination** — `submitSalesPo` writes `purchase_orders` (status=`Registered`), `purchase_order_status_history`, `purchase_order_tracking_events`, then mirrors a `po_customer_records` row in Finance via `financeService.createPoCustomerFromSalesPo`. See `../po-state-machine.md#stage-1-registered`.
- **PO Registered → Processed** — `processSalesPo` calls `poService.advanceStatus('Processed')`, which keeps `po_customer_records.workflow_status='registered'` (per `poCustomerWorkflowFor`, `po.service.js:104`) and emits `sales.po.processed`. See `../po-state-machine.md#stage-2-processed`.
- **Sales PR → Finance Purchase Requisition** — `submitSalesPr` mirrors a `purchase_requisitions` row at `current_pr_status='Registered'` via `financeService.createRequisitionFromSalesPr` (`finance.service.js:314`). The downstream Finance-side **[PR PO-Out](../../business/system-overview.md#glossary-pr-po-out)** automation that drives Processed → Production lives in `./finance.md` and `../po-state-machine.md`.
- **PO delay justification** — `submitOverdueReason` writes the reason on both the Sales form and the master PO and emits `sales.po.delay_justified` via `poService.flagOverdue`.

## SLA hooks

The Sales 2-working-day SLA is **specified but not yet implemented**. The `step_due_at` / `step_status` / `last_progress_at` columns on every Sales form are wired (every create/transition recomputes `step_due_at` via `computeStepDueAt`) and are waiting on a `sla_sales_form_monitor` cron job that does not yet exist in `JOB_DEFINITIONS` (`backend/src/jobs/scheduler.js:37`). The four registered jobs are `sla_technical_ready_to_deliver`, `technical_po_due_reminder`, `hrga_expiry_monitor`, `tax_deadline_monitor`. See `../jobs.md` for the registry contract.

When the job is added it should:

- Scan rows where `step_due_at < now()` AND `step_status = 'on_track'` AND `workflow_status NOT IN (terminal states per form)` AND `deleted_at IS NULL`.
- Flip `step_status='overdue'`. For `sales_purchase_orders`, also set `workflow_status='overdue'` (the schema already permits it — `005_sales_forms.sql:174`).
- Emit `sales.po.overdue` for Sales POs (recipients per CLAUDE.md: Superadmin, CEO, Admin & Log, Finance) using `poService.flagOverdue` (which already handles `escalation_sent_at` deduplication, `po.service.js:359-407`).
- For non-PO Sales forms (Forecast, Quotation, HPP, PR), no template_key is currently reserved; either reuse `sales.po.delay_justified` parameterized by entity type or define new `sales.<form>.overdue` codes.

The `submitOverdueReason` route (`sales.routes.js:345`) is the operator-facing return path and is fully wired today; it just has no machine-driven counterpart yet.

## Frontend pages

Pages live under `frontend/app/(app)/sales/`. Every page is a `'use client'` component. Form components for create/edit pages live under `frontend/components/sales/` (e.g. `CustomerForm`) — they import the same lib trio internally.

| App-router path | Component | `sales-api` | `sales-types` | `sales-ui` |
|---|---|---|---|---|
| `/sales/customers` | `frontend/app/(app)/sales/customers/page.tsx` | `customersApi` | `Customer` | `customerVariant` |
| `/sales/customers/new` | `.../customers/new/page.tsx` | (via `CustomerForm`) | (via form) | (via form) |
| `/sales/customers/[id]` | `.../customers/[id]/page.tsx` | `customersApi` | `Customer` | `customerVariant` |
| `/sales/customers/[id]/edit` | `.../customers/[id]/edit/page.tsx` | `customersApi` | `Customer` | — |
| `/sales/forecasts` | `.../forecasts/page.tsx` | `forecastsApi` | `SalesForecast` | `forecastWorkflowVariant`, `forecastStageVariant`, `slaVariant` |
| `/sales/forecasts/new` | `.../forecasts/new/page.tsx` | (via form) | (via form) | (via form) |
| `/sales/forecasts/[id]` | `.../forecasts/[id]/page.tsx` | `forecastsApi` | `SalesForecast` | `forecastWorkflowVariant`+ |
| `/sales/forecasts/[id]/edit` | `.../forecasts/[id]/edit/page.tsx` | `forecastsApi` | `SalesForecast` | — |
| `/sales/quotations` | `.../quotations/page.tsx` | `quotationsApi` | `Quotation` | `quotationVariant` |
| `/sales/quotations/new` | `.../quotations/new/page.tsx` | (via form) | (via form) | (via form) |
| `/sales/quotations/[id]` | `.../quotations/[id]/page.tsx` | `quotationsApi` | `Quotation` | `quotationVariant` |
| `/sales/quotations/[id]/edit` | `.../quotations/[id]/edit/page.tsx` | `quotationsApi` | `Quotation` | — |
| `/sales/hpp` | `.../hpp/page.tsx` | `hppApi` | `HargaPokokPenjualan` | `hppVariant` |
| `/sales/hpp/new` | `.../hpp/new/page.tsx` | (via form) | (via form) | (via form) |
| `/sales/hpp/[id]` | `.../hpp/[id]/page.tsx` | `hppApi` | `HargaPokokPenjualan` | `hppVariant` |
| `/sales/hpp/[id]/edit` | `.../hpp/[id]/edit/page.tsx` | `hppApi` | `HargaPokokPenjualan` | — |
| `/sales/purchase-orders` | `.../purchase-orders/page.tsx` | `salesPoApi` | `SalesPurchaseOrder` | `salesPoVariant`, `slaVariant` |
| `/sales/purchase-orders/new` | `.../purchase-orders/new/page.tsx` | (via form) | (via form) | (via form) |
| `/sales/purchase-orders/[id]` | `.../purchase-orders/[id]/page.tsx` | `salesPoApi` | `SalesPurchaseOrder` | `salesPoVariant` |
| `/sales/purchase-orders/[id]/edit` | `.../purchase-orders/[id]/edit/page.tsx` | `salesPoApi` | `SalesPurchaseOrder` | — |
| `/sales/purchase-requests` | `.../purchase-requests/page.tsx` | `purchaseRequestsApi` | `PurchaseRequestSales` | `prVariant` |
| `/sales/purchase-requests/new` | `.../purchase-requests/new/page.tsx` | (via form) | (via form) | (via form) |
| `/sales/purchase-requests/[id]` | `.../purchase-requests/[id]/page.tsx` | `purchaseRequestsApi` | `PurchaseRequestSales` | `prVariant` |
| `/sales/purchase-requests/[id]/edit` | `.../purchase-requests/[id]/edit/page.tsx` | `purchaseRequestsApi` | `PurchaseRequestSales` | — |

The `lib/sales-api.ts` exports — `customersApi`, `forecastsApi`, `quotationsApi`, `hppApi`, `salesPoApi`, `purchaseRequestsApi` — each provide `list / get / create / update / remove` plus the relevant verb (`submit`, `transition`, `process`, `overdueReason`).

## Cross-references

- `../po-state-machine.md` — full 11-stage lifecycle; Sales originates stage 1 (`#stage-1-registered`) and exits at stage 2 (`#stage-2-processed`).
- `../notifications.md` — full template catalogue including `sales.po.registered`, `sales.po.processed`, `sales.po.delay_justified`, `sales.po.overdue`, and `finance.pr.registered`.
- `../auth-and-rbac.md` — capability resolution, `view_own` scoping, same-role manager constraint, and the `feature_definitions` / `capability_definitions` tables that back `rbacGuard()`.
- `../jobs.md` — background-job registry; the gap left by the not-yet-implemented `sla_sales_form_monitor`.
- `./finance.md` — Finance-side mirrors created by `submitSalesPo` (`po_customer_records`) and `submitSalesPr` (`purchase_requisitions`); the PR PO-Out automation that exits stage 2 and enters stage 3 (`Production`).
