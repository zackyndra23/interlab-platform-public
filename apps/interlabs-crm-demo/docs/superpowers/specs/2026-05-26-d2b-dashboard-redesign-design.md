# D2b — Dashboard Redesign + Charts (Design)

- **Date:** 2026-05-26
- **Working dir:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo`
- **Branch:** `feat/d2b-dashboard-charts` (from `main`, which now has Sub-2-lite + Sub-4 + D1 + D2a)
- **Target env:** live demo / staging (frontend `interlab-app` container).
- **Status:** approved design, pre-implementation

---

## 0. Context

After D1 (data) + D2a (chat/PO-tracking/online-now work), the user reported the dashboards are still "berantakan" (messy): long scrolling lists, only a single CSS bar, no pie/line charts, no scoreboards. D2b makes every role's dashboard **professional, compact, and insightful**: KPI scoreboards + percentages on top, bar/line/pie charts in the middle, short (max-5) recent lists with "view all" at the bottom — minimal scrolling. This is the **D2b** slice of the dashboard-feedback decomposition (items #1, #3-charts, #6). Multi-field **search/filter + date-picker (#2) is explicitly deferred to D2c.**

The data already exists (D1 seeded all widgets with varied statuses). The current dashboards are grids of list/number widgets in `frontend/components/{module}/widgets/{Module}Dashboard.tsx`; reusable pieces exist (`StatusBadge`, `DataTable`, `formatDate`/`formatCurrency`/`relativeTime`), but **no chart library** is installed and there's no `KpiCard`/`ChartCard`/`RecentList`.

---

## 1. Scope / non-goals

**In scope:** install `recharts`; build 3 reusable presentational components (`KpiCard`, `ChartCard`, `RecentList`) + small client-side aggregation helpers; redesign the 6 role dashboards (+ superadmin/CEO stacked) to the new layout, reusing the data each already fetches. Frontend-only — **no backend changes, no new endpoints** (charts/KPIs computed client-side from existing list calls).

**Non-goals (→ D2c):** multi-field search/filter, date-picker, sort UI on list pages. Also: no changes to the module list pages themselves (the "view all" links point to existing pages), no backend aggregation endpoints (client-side is sufficient for demo data volume ≤200 rows/list).

**Reuse:** `StatusBadge`, `formatDate`/`formatCurrency`/`relativeTime` (`lib/utils.ts`), the existing per-widget API calls (`{module}Api.list({limit:200})`), `{module}-ui.ts` status/label maps. Don't rewrite the data layer — only the presentation.

---

## 2. Approach

### 2.1 Charts: recharts (client-side)
Add `recharts` to `frontend/package.json`. Charts/KPIs are derived **client-side** from the lists each dashboard already fetches (no new API). Demo lists are capped at ≤200 rows which fully covers the seeded volume, so aggregates are exact.

### 2.2 Aggregation helpers (`frontend/lib/dashboard-agg.ts`)
Small pure functions (unit-testable):
- `countBy(rows, key)` → `{ [value]: count }` (for pie/bar status breakdowns).
- `toPieData(counts)` → `[{ name, value }]` (recharts shape).
- `monthlyTrend(rows, dateKey, months=6)` → `[{ month: 'Jan', count }]` (buckets `created_at`/date field into the last N months for line charts).
- `sumBy(rows, key)` → number (for value KPIs).
- `pct(part, total)` → integer percent.

### 2.3 Reusable components (`frontend/components/shared/`)
- **`KpiCard`** `{ label, value, sub?, tone? }` → a compact card: small label, large value, optional sub-line (e.g. "+12% vs last mo" or "of 120"). Tailwind, matches existing card styling (`rounded-md border border-border bg-card p-4`).
- **`ChartCard`** `{ title, type: 'pie'|'bar'|'line', data, dataKey?, nameKey?, height? }` → titled card wrapping a `ResponsiveContainer` + the recharts chart for `type`. Pie shows %; bar/line use the theme colors. One component, switch on `type`. Empty-data → "No data" placeholder.
- **`RecentList`** `{ title, items: {id, name, date, status}[], viewAllHref }` → titled card, up to **5** rows (name truncated, `formatDate(date)`, `StatusBadge`), and a "View all →" link to `viewAllHref`. Shows "No records" when empty.

### 2.4 Layout (per role dashboard)
Replace the current widget grid with:
```
[ Welcome header ]                                  (existing)
[ SharedDashboardHeader: Recent Notifications + PO Quick Search ]  (existing, kept)
[ KPI row:  KpiCard × 4  (grid md:grid-cols-4) ]
[ Charts row:  ChartCard(pie) | ChartCard(bar) | ChartCard(line)  (grid md:grid-cols-3) ]
[ Recent row:  RecentList | RecentList  (grid md:grid-cols-2) ]
```
Compact, scannable, ≤ one extra scroll. Each `*Dashboard.tsx` keeps its existing `useEffect` data fetches, then derives KPI/chart/recent data via the agg helpers.

---

## 3. Per-role mapping (KPI / Pie / Bar / Line / Recent)

All derived from the listed source (the API list each dashboard already calls). Exact field names verified at implementation from `{module}-types.ts`.

- **Sales** (quotations, sales_purchase_orders, sales_forecasts): KPI = [# quotations, pipeline value (sum forecast est_value), win-rate % (Won/(Won+Lost)), # overdue]; Pie = quotation `workflow_status`; Bar = forecast by `stage`; Line = sales-PO `created_at`/month; Recent = recent quotations (→/sales/quotations), recent sales POs (→/sales/purchase-orders).
- **Finance** (invoice_customers, invoice_manufactures, po_customer_records, purchase_requisitions): KPI = [# unpaid manuf invoices, total billed (sum), paid %, # PR pending]; Pie = manuf `payment_status`; Bar = po_customer by `workflow_status`; Line = invoice_customers `created_at`/month; Recent = pending customer invoices (→/finance/invoice-customers), PRs (→/finance/purchase-requisitions).
- **Technical** (technical_job_orders, inspection_qc_records, bast_records, installation_records): KPI = [# active jobs, # QC pending, # BAST→finance, # installations]; Pie = job order `workflow_status`; Bar = jobs by `job_type`; Line = job orders `created_at`/month; Recent = active job orders (→/technical/job-orders), QC queue (→/technical/inspection-qc).
- **Admin & Log** (awb_records, delivery_orders, admin_operational_records): KPI = [# active AWB, # DO pending, operational spend (sum), # this month]; Pie = AWB `current_awb_status`; Bar = operational by `expense_category`; Line = operational by `reporting_month`; Recent = AWB (→/admin-log/awb), DO (→/admin-log/delivery-orders).
- **HRGA** (hrga_legal_documents, company_letters): KPI = [# docs, # expiring soon, # expired, # letters]; Pie = legal `compliance_flag`; Bar = letters by `letter_status`; Line = docs by `expiry_date`/month; Recent = recent docs (→/hrga/legal-documents), letters (→/hrga/company-letters).
- **Tax** (tax_operational_records): KPI = [# records, # unpaid, current masa-pajak count, total amount]; Pie = `payment_status`; Bar = by `tax_type`; Line = amount by `masa_pajak`/month; Recent = recent tax records (→/tax), pending actions.
- **Superadmin / CEO**: keep the stacked all-division view, each division section rendered with the new compact layout (KPI + charts + recent), so they get the full picture.

> `*Dashboard.tsx` files reuse their existing data fetches; only the render changes. Where a dashboard previously had bespoke widgets (e.g. `SlaAlertsWidget`), keep the most useful one or fold its signal into a KPI — don't drop critical alerts; the redesign reorganizes, it doesn't remove load-bearing info.

---

## 4. Testing
- Frontend has no test runner → verify by **`npx tsc --noEmit`** (no new type errors) + **live** (rebuild `interlab-app`, log in per role, confirm charts render with the seeded data + lists capped at 5 + view-all links navigate).
- The pure agg helpers (`lib/dashboard-agg.ts`) CAN be unit-tested if a runner is added later; for now keep them pure + simple. (Optional: a tiny node assert script.)

## 5. Acceptance criteria
1. `recharts` installed; `KpiCard`/`ChartCard`/`RecentList` exist and render (pie shows %, bar/line render, empty-state handled).
2. Each role dashboard shows: a KPI scoreboard row, a charts row (pie + bar + line), and recent lists capped at 5 with working "view all" links — no long scrolling lists on the dashboard.
3. Charts reflect the seeded varied data (e.g. quotation pie shows all 5 statuses; a line shows a multi-month trend).
4. `npx tsc --noEmit` introduces no new errors; the app builds.
5. Superadmin/CEO see every division in the new compact layout.
6. No backend changes; existing module list pages unchanged (only linked to).

## 6. Risks & mitigations
- **6 dashboards + new components = sizable frontend** → build the 3 shared components + agg helpers first (one task), then redesign dashboards one role per task (isolated, testable via tsc).
- **No FE test runner** → tsc + live verify; keep components pure/presentational so they're easy to reason about.
- **recharts bundle size / SSR** → it's client-only (`'use client'` dashboards already); `ResponsiveContainer` needs a sized parent — give chart cards a fixed height.
- **Dropping load-bearing widgets** → explicitly preserve critical alerts (SLA/compliance/overdue) as KPIs or a retained card; redesign reorganizes, not removes.
