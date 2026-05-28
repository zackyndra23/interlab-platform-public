# D2b — Dashboard Redesign + Charts Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.

**Goal:** Redesign all role dashboards to a compact, professional layout — KPI scoreboards + percentages on top, pie/bar/line charts (recharts) in the middle, max-5 recent lists with "view all" at the bottom — minimal scrolling.

**Architecture:** Frontend-only. Add `recharts` + 3 shared presentational components (`KpiCard`, `ChartCard`, `RecentList`) + pure client-side aggregation helpers; rewrite each `{Module}Dashboard.tsx` to that layout, REUSING the data each already fetches (no backend/API changes). Tax + HRGA-compliance already use pre-aggregated `/dashboard/*` endpoints (chart-ready); others aggregate client-side from their `list({limit:200})` calls.

**Tech Stack:** Next 14 App Router, React 18.3, TypeScript, recharts (new), Tailwind. No frontend test runner → verify via `npx tsc --noEmit` + live.

---

## Conventions (read once)
- node: `export PATH="/home/zaky/.nvm/versions/node/v20.20.2/bin:$PATH"`. Run frontend cmds from `apps/interlabs-crm-demo/frontend`.
- **Verify each task:** `npx tsc --noEmit` introduces **no new errors** (there are ~26 pre-existing errors in unrelated files — only judge files you touched).
- **Local per-task commits, NO push.** Trailer: `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`.
- **Card style:** `<section className="rounded-md border border-border bg-card p-4">`, title `<h3 className="mb-2 text-sm font-semibold">`.
- **Reuse:** `StatusBadge` (`components/shared/StatusBadge.tsx`, props `{status, variant?}`); `formatDate`/`formatCurrency`/`relativeTime` (`lib/utils.ts`); each module's `lib/{module}-ui` status→variant helpers; the existing `{module}Api.list(...)` calls in each widget. **Do not change the data layer or the module list pages — only the dashboard render.**
- **Preserve load-bearing signals:** keep critical alerts (SLA overdue, compliance expiring, ready-to-deliver) — fold them into a KPI (e.g. "# overdue", tone=danger) or keep one alert card. Reorganize, don't drop.
- **`'use client'`** at top of every dashboard/component file.

## Per-role data reference (source API → fields)
(All list calls already exist in the current widgets — reuse them. Field names verified.)
| Role | Lists already fetched | Status field (pie/bar) | Trend date | Value | View-all routes |
|---|---|---|---|---|---|
| Sales | quotations, salesPo, forecasts | quotation `workflow_status`; forecast `stage` | salesPo `created_at` | forecast `estimated_value`, quote `total_amount` | /sales/quotations, /sales/purchase-orders, /sales/forecasts |
| Finance | invoiceCustomers, invoiceManufactures, poCustomers, purchaseRequisitions | manuf `payment_status`; poCustomer `workflow_status`; PR `current_pr_status` | invoiceCustomers `created_at` | `total_amount` | /finance/invoice-customers, /finance/purchase-requisitions, /finance/invoice-manufactures |
| Technical | jobOrders, inspectionQc, bast, installations | jobOrder `workflow_status`/`job_type`; qc `review_status` | jobOrders `created_at` | — | /technical/job-orders, /technical/inspection-qc, /technical/bast |
| Admin&Log | awb, deliveryOrders, operational | awb `current_awb_status`; do `current_do_status`; op `expense_category` | operational `reporting_month` | operational `amount` | /admin-log/awb, /admin-log/delivery-orders, /admin-log/operational |
| HRGA | legalDocuments, companyLetters, compliance.summary() | legal `document_status`/`compliance_flag`; letter `letter_status` | legal `expiry_date` | — | /hrga/legalitas, /hrga/company-letters, /hrga/compliance |
| Tax | taxDashboardApi.* (pre-aggregated) | `by_tax_type` (currentMasaPajak); monthlySummary points | monthlySummary `month` | `total_amount` | /tax/operational |
> HRGA list-page path is `/hrga/legalitas` (NOT legal-documents); Tax only has `/tax/operational`.

---

## Task 1: recharts + agg helpers + shared components

**Files:** Modify `frontend/package.json` (+ install); Create `frontend/lib/dashboard-agg.ts`, `frontend/components/shared/KpiCard.tsx`, `ChartCard.tsx`, `RecentList.tsx`. Test: a tiny node assert for agg helpers.

- [ ] **Step 1: install recharts** — `cd frontend && npm install recharts@^2.12.0` (adds to package.json + lockfile). Confirm `node -e "require('recharts')"` resolves.
- [ ] **Step 2: agg helpers** `frontend/lib/dashboard-agg.ts`:
```typescript
export function countBy<T>(rows: T[], key: keyof T): Record<string, number> {
  const out: Record<string, number> = {};
  for (const r of rows) { const k = String((r[key] as unknown) ?? '—'); out[k] = (out[k] || 0) + 1; }
  return out;
}
export function toPieData(counts: Record<string, number>): { name: string; value: number }[] {
  return Object.entries(counts).map(([name, value]) => ({ name, value }));
}
export function monthlyTrend<T>(rows: T[], dateKey: keyof T, months = 6): { month: string; count: number }[] {
  const now = new Date();
  const buckets = Array.from({ length: months }, (_, i) => {
    const d = new Date(now.getFullYear(), now.getMonth() - (months - 1 - i), 1);
    return { key: `${d.getFullYear()}-${d.getMonth()}`, month: d.toLocaleString('en-US', { month: 'short' }), count: 0 };
  });
  const idx = new Map(buckets.map((b, i) => [b.key, i]));
  for (const r of rows) {
    const v = r[dateKey] as unknown as string | null; if (!v) continue;
    const d = new Date(v); if (isNaN(d.getTime())) continue;
    const i = idx.get(`${d.getFullYear()}-${d.getMonth()}`);
    if (i !== undefined) buckets[i].count++;
  }
  return buckets.map((b) => ({ month: b.month, count: b.count }));
}
export function sumBy<T>(rows: T[], key: keyof T): number {
  return rows.reduce((s, r) => s + (Number(r[key]) || 0), 0);
}
export function pct(part: number, total: number): number { return total ? Math.round((part / total) * 100) : 0; }
```
- [ ] **Step 3: agg test** `frontend/lib/dashboard-agg.test.mjs` (run with node, since no vitest in FE):
```javascript
import assert from 'node:assert';
import { execSync } from 'node:child_process';
// compile-free check via ts-node not available; instead a runtime check on a JS port is overkill.
// Minimal: assert the functions exist + behave by importing the compiled logic inline.
```
> Simpler: SKIP a formal test file (no FE runner). Instead verify by `npx tsc --noEmit` (types) + a one-off node REPL check is optional. Do NOT create a broken test. Just ensure `tsc` passes.
- [ ] **Step 4: `components/shared/KpiCard.tsx`**:
```tsx
'use client';
import React from 'react';
export function KpiCard({ label, value, sub, tone = 'default' }: {
  label: string; value: React.ReactNode; sub?: string; tone?: 'default' | 'danger' | 'success';
}) {
  const valCls = tone === 'danger' ? 'text-destructive' : tone === 'success' ? 'text-green-600' : '';
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <p className={`text-2xl font-semibold ${valCls}`}>{value}</p>
      <p className="text-xs text-muted-foreground">{label}</p>
      {sub ? <p className="mt-0.5 text-[11px] text-muted-foreground">{sub}</p> : null}
    </section>
  );
}
```
- [ ] **Step 5: `components/shared/ChartCard.tsx`**:
```tsx
'use client';
import React from 'react';
import {
  ResponsiveContainer, PieChart, Pie, Cell, BarChart, Bar, LineChart, Line,
  XAxis, YAxis, Tooltip, CartesianGrid,
} from 'recharts';

const COLORS = ['#2563eb', '#16a34a', '#f59e0b', '#dc2626', '#7c3aed', '#0891b2', '#db2777', '#65a30d'];

export function ChartCard({ title, type, data, dataKey = 'value', nameKey = 'name', height = 200 }: {
  title: string; type: 'pie' | 'bar' | 'line';
  data: Array<Record<string, unknown>>; dataKey?: string; nameKey?: string; height?: number;
}) {
  const empty = !data || data.length === 0 || (type !== 'pie' && data.every((d) => !Number(d[dataKey])));
  let chart: React.ReactElement;
  if (type === 'pie') {
    chart = (
      <PieChart>
        <Pie data={data} dataKey={dataKey} nameKey={nameKey} cx="50%" cy="50%" outerRadius={70}
             label={(e: { name?: string; percent?: number }) => `${e.name} ${Math.round((e.percent || 0) * 100)}%`}>
          {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
        </Pie>
        <Tooltip />
      </PieChart>
    );
  } else if (type === 'bar') {
    chart = (
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={nameKey} fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip />
        <Bar dataKey={dataKey} fill={COLORS[0]} radius={[3, 3, 0, 0]} />
      </BarChart>
    );
  } else {
    chart = (
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e5e7eb" />
        <XAxis dataKey={nameKey} fontSize={11} /><YAxis fontSize={11} allowDecimals={false} /><Tooltip />
        <Line type="monotone" dataKey={dataKey} stroke={COLORS[0]} strokeWidth={2} dot={false} />
      </LineChart>
    );
  }
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <h3 className="mb-2 text-sm font-semibold">{title}</h3>
      {empty ? <p className="text-sm text-muted-foreground">No data.</p>
        : <ResponsiveContainer width="100%" height={height}>{chart}</ResponsiveContainer>}
    </section>
  );
}
```
- [ ] **Step 6: `components/shared/RecentList.tsx`**:
```tsx
'use client';
import React from 'react';
import Link from 'next/link';
import { StatusBadge } from './StatusBadge';
import { formatDate } from '@/lib/utils';
export type RecentItem = { id: string; name: string; date?: string | null; status?: string; statusVariant?: 'neutral' | 'info' | 'success' | 'warning' | 'danger' | 'muted' };
export function RecentList({ title, items, viewAllHref }: { title: string; items: RecentItem[]; viewAllHref: string }) {
  return (
    <section className="rounded-md border border-border bg-card p-4">
      <div className="mb-2 flex items-center justify-between">
        <h3 className="text-sm font-semibold">{title}</h3>
        <Link href={viewAllHref} className="text-xs text-primary hover:underline">View all →</Link>
      </div>
      {items.length === 0 ? <p className="text-sm text-muted-foreground">No records.</p> : (
        <ul className="divide-y divide-border text-sm">
          {items.slice(0, 5).map((it) => (
            <li key={it.id} className="flex items-center justify-between gap-2 py-2">
              <span className="min-w-0 flex-1 truncate">{it.name}</span>
              {it.date ? <span className="shrink-0 text-xs text-muted-foreground">{formatDate(it.date)}</span> : null}
              {it.status ? <StatusBadge status={it.status} variant={it.statusVariant} /> : null}
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
```
- [ ] **Step 7:** `npx tsc --noEmit` → no new errors. Commit:
```bash
cd /opt/projects/interlab-infra
git add apps/interlabs-crm-demo/frontend/package.json apps/interlabs-crm-demo/frontend/package-lock.json apps/interlabs-crm-demo/frontend/lib/dashboard-agg.ts apps/interlabs-crm-demo/frontend/components/shared/KpiCard.tsx apps/interlabs-crm-demo/frontend/components/shared/ChartCard.tsx apps/interlabs-crm-demo/frontend/components/shared/RecentList.tsx
git commit -m "feat(d2b): add recharts + KpiCard/ChartCard/RecentList + dashboard agg helpers"
```

---

## Tasks 2–7: redesign each role dashboard

**Shared pattern for every dashboard task:**
- READ the existing `components/{module}/widgets/{Module}Dashboard.tsx` + its widget files to copy the exact API calls + field names (reuse them — move the `useEffect` fetches into the composer or a small hook).
- Rewrite the composer to render the layout: `<div className="space-y-4">` → keep nothing of the old grid; render **(a)** a KPI row `<div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">` of `KpiCard`s, **(b)** a charts row `<div className="grid gap-4 lg:grid-cols-3">` of `ChartCard` pie/bar/line, **(c)** a recent row `<div className="grid gap-4 md:grid-cols-2">` of `RecentList`s.
- Build chart data with `countBy`/`toPieData`/`monthlyTrend`/`sumBy`/`pct` from `lib/dashboard-agg`. Map statuses → `StatusBadge` variants via the module's `lib/{module}-ui` helper for RecentList items.
- Preserve a critical alert as a KPI (tone='danger') where one existed.
- `npx tsc --noEmit` (no new errors) → commit `feat(d2b): redesign {role} dashboard (KPI + pie/bar/line + recent lists)`.

### Task 2: Sales (`components/sales/widgets/SalesDashboard.tsx`)
- Fetch (reuse): `quotationsApi.list({limit:200})`, `salesPoApi.list({limit:200})`, `forecastsApi.list({limit:200})`.
- KPI: # quotations; pipeline value = `formatCurrency(sumBy(forecasts,'estimated_value'))`; win-rate = `pct(Won, Won+Lost)` from forecast `stage`; # overdue (salesPo `workflow_status==='overdue'` OR `step_status==='overdue'`, tone='danger').
- Pie = `toPieData(countBy(quotations,'workflow_status'))`; Bar = `toPieData(countBy(forecasts,'stage'))` (use as bar data, nameKey='name', dataKey='value'); Line = `monthlyTrend(salesPo,'created_at',6)` (nameKey='month', dataKey='count').
- Recent: quotations (sort `created_at` desc, top 5 → name=`quotation_record_number`, date=`quotation_date`, status=`workflow_status` via `quotationVariant`) → `/sales/quotations`; sales POs → `/sales/purchase-orders`.

### Task 3: Finance (`FinanceDashboard.tsx`)
- Fetch: `invoiceCustomersApi.list({limit:200})`, `invoiceManufacturesApi.list({limit:200})`, `poCustomersApi.list({limit:200})`, `purchaseRequisitionsApi.list({limit:200})`.
- KPI: # unpaid manuf (`payment_status==='Unpaid'`, tone='danger'); total billed = `formatCurrency(sumBy(invoiceCustomers,'total_amount'))`; paid % = `pct(Paid, all)` of manuf; # PR pending (`current_pr_status==='Registered'`).
- Pie = manuf `payment_status`; Bar = poCustomers `workflow_status`; Line = `monthlyTrend(invoiceCustomers,'created_at',6)`.
- Recent: pending customer invoices (`invoice_status==='Registered'`) → `/finance/invoice-customers`; PRs → `/finance/purchase-requisitions`.

### Task 4: Technical (`TechnicalDashboard.tsx`)
- Fetch: `jobOrdersApi.list({limit:200})`, `inspectionQcApi.list({limit:200})`, `bastApi.list({limit:200})`, `installationsApi.list({limit:200})`.
- KPI: # active jobs (`workflow_status==='active'`); # QC pending (`review_status==='Pending Review'`); # BAST→finance (`workflow_status==='sent_to_finance'`); # installations.
- Pie = jobOrders `workflow_status`; Bar = jobOrders `job_type`; Line = `monthlyTrend(jobOrders,'created_at',6)`.
- Recent: active job orders → `/technical/job-orders`; QC queue → `/technical/inspection-qc`.

### Task 5: Admin & Log (`AdminLogDashboard.tsx`)
- Fetch: `awbApi.list({limit:200})`, `deliveryOrdersApi.list({limit:200})`, `operationalApi.list({limit:200})`.
- KPI: # active AWB (`current_awb_status!=='Arrived'`); # DO pending (`current_do_status==='Registered'`); operational spend = `formatCurrency(sumBy(operational,'amount'))`; # AWB arrived.
- Pie = awb `current_awb_status`; Bar = operational `expense_category` (countBy); Line = `monthlyTrend(operational,'reporting_month',6)`.
- Recent: AWB (sort `despatch_date`) → `/admin-log/awb`; DO → `/admin-log/delivery-orders`.

### Task 6: HRGA (`HrgaDashboard.tsx`)
- Fetch: `legalDocumentsApi.list({limit:200})`, `companyLettersApi.list({limit:200})`, `complianceApi.summary()`.
- KPI from `complianceApi.summary()`: # ok; # expiring (expiring_soon_90+30, tone='warning'); # expired (tone='danger'); # letters (companyLetters length).
- Pie = legal `compliance_flag` (countBy) OR build from summary `{ok,expiring_soon_90,expiring_soon_30,expired}`; Bar = letters `letter_status`; Line = `monthlyTrend(legalDocuments,'expiry_date',6)`.
- Recent: recent legal docs (name=`document_name`, status=`document_status` via `legalDocumentStatusVariant`) → `/hrga/legalitas`; letters (name=`subject`, status=`letter_status`) → `/hrga/company-letters`.

### Task 7: Tax (`TaxDashboard.tsx`)
- Tax already uses pre-aggregated endpoints — reuse them: `taxDashboardApi.currentMasaPajak()`, `taxDashboardApi.monthlySummary('PPh 21',12)` (+ maybe 'PPh 25'), `taxDashboardApi.pendingActions()`, `taxDashboardApi.recentActivity()`.
- KPI from `currentMasaPajak()`: sum of `by_tax_type[].total` (# records this masa); sum `unpaid` (tone='danger'); sum `draft`; current `masa_pajak_month/year` label.
- Pie = `by_tax_type` → `[{name:tax_type, value:total}]` (already aggregated!); Bar = same `by_tax_type` (value=total) OR monthlySummary; Line = `monthlySummary('PPh 21')` points → `[{month: formatMasaPajak(year,month), count: Number(total_amount)}]` (dataKey='count', or use a value key).
- Recent: `recentActivity()` rows (name=`tax_operational_record_number`, status=`action`) → `/tax/operational`; `pendingActions().unpaid_past_payment_date` → `/tax/operational`.

---

## Task 8: Live verify (gated)
- [ ] Rebuild + restart the frontend: `cd apps/interlabs-crm-demo && docker compose build interlab-app && docker compose up -d --force-recreate interlab-app` (use `--force-recreate` — plain up may keep the stale image). Wait for the app container healthy.
- [ ] **STOP — user logs in per role** (Sales/Finance/Technical/Admin&Log/HRGA/Tax/Superadmin): confirm each dashboard shows KPI scoreboard + pie/bar/line charts (reflecting the varied seeded data) + max-5 recent lists with working "view all" links, and minimal scrolling. After confirmation → push + MR.

---

## Self-review notes (author)
- **Spec coverage:** recharts+components+agg → T1; per-role redesign (#1,#6, charts #3) → T2–T7; superadmin/CEO auto-inherit the redesigned division dashboards (the dashboard page renders `<SalesDashboard/>` etc. for them) — verified in T8; live → T8. Search/filter (#2) is D2c (out of scope). ✓
- **No backend changes**; "view all" → existing routes (HRGA `/hrga/legalitas`, Tax `/tax/operational`). ✓
- **Load-bearing alerts** preserved as danger-tone KPIs (overdue/unpaid/expired). ✓
- **No FE test runner** → `tsc --noEmit` + live verify; shared components are pure/presentational. (No broken test files — Task 1 Step 3 explicitly skips a formal test.)
- **Naming:** `KpiCard`/`ChartCard`/`RecentList`/`countBy`/`toPieData`/`monthlyTrend`/`sumBy`/`pct` consistent across tasks.
