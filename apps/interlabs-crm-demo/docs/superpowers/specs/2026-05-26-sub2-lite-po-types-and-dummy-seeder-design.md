# Sub-2-lite + Sub-4 — PO Types, Multi-termin Billing & Dummy Data Seeder (Design)

- **Date:** 2026-05-26
- **Working dir:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo` (infra-repo consolidated copy; commits land in the `interlab-infra` repo)
- **Branch:** `feat/sub3-po-tracking-ui` (current working branch; UI focus, but this work lands here first)
- **Target env:** the **live demo / staging** stack — Postgres `interlab_staging` @ postgres-global, redis-global, **minio-global** (`s3-storage.interlab-portal.com`), demo containers `interlab-app`/`interlab-api`.
- **Status:** approved design, pre-implementation

---

## 0. Context: delta on a mature codebase

The originating ask ("buatkan ~100 PO dummy dengan macam-macam status supaya semua dashboard hidup, dokumen saling ngelink, pakai S3, redis, tracking, notifikasi antar-departemen, dan multiple penagihan, plus tipe service/installation/supply") **bundles two of the four MVP sub-projects** from the decomposition:

- **Sub-2 (PO Type & Multi-cycle, backend)** — *but trimmed to a minimal additive slice ("Sub-2-lite")*, not the full state-machine rewrite.
- **Sub-4 (Dummy Data Seeder)** — which the decomposition explicitly marked *depends on Sub-1 + Sub-2*.

A dummy seeder alone cannot "surface" PO types or multi-termin billing because **those concepts do not exist in the schema yet**. So this design does the minimal real backend generalization first, then the seeder produces authentic historical data on top of it.

### REUSE principle (binds this work)
Reuse existing structures; **only add** columns / rows / a per-type path. Specifically: **extend `invoice_customers`** for multi-termin billing rather than creating a new `po_payments` table; reuse the existing 11-stage values, document-number generator (`utils/recordNumbers.js`), `file_attachments` one-to-many + presigned URLs, `notification_templates` role targeting, and `purchase_order_status_history` / `purchase_order_tracking_events`.

### What exists today (verified) vs. what is missing
- **Exists:** linear 11-stage lifecycle (`po.service.js` `STATUS_ORDER`), forward-only transitions writing `status_history` + `tracking_events` + notification emit; document tables with FKs to `purchase_orders` (`quotations`→`sales_purchase_orders`→`purchase_requisitions`/`delivery_orders`/`awb_records`/`bast_records`/`invoice_customers`); sequential doc-number generator; `file_attachments` (one-to-many, presigned 15-min view); event-driven notifications with per-role targeting; Redis (sessions/2FA/rate-limit/dedupe).
- **Missing:** any **PO type** column or type-based path; **early-exit** vs full-cycle; **multi-termin / multiple payment** to the customer (current `invoice_customers` has `invoice_status ∈ {Registered, Processed}` only, **no payment fields**); any **domain seed data** (`seed.js` seeds only roles/capabilities/users/templates — zero POs).
- **Note on "cache pakai Redis":** Redis is used at runtime (sessions/2FA/rate-limit/notification-dedupe) but there is **no dashboard/PO query cache layer**. Caching is a runtime concern, **not** something the seeder populates. Adding a query cache is explicitly **out of scope** here.

---

## 1. Confirmed domain model

### 1.1 PO types → lifecycle path (confirmed by user)
The 11 canonical stages (unchanged): `Registered → Processed → Production → Shipped → Customs → Arrived → Inspected → Delivery → Installation → BAST → Invoice`.

Each type traverses an **ordered subsequence** of those stages (order preserved — still forward-only):

| Type | Path (subsequence of the 11 stages) | Meaning |
|------|--------------------------------------|---------|
| `service` | `Registered → Processed → Inspected → BAST → Invoice` | Jasa saja. Operasional **selesai di Technical** (Inspected→BAST), lalu Finance menagih. Skip semua logistik. |
| `supply` | `Registered → Processed → Production → Shipped → Customs → Arrived → Inspected → Delivery → Invoice` | Kirim barang tanpa pasang. Technical hanya **QC barang masuk** (Inspected). Tanpa Installation/BAST. |
| `installation` | semua 11 stage | Supply + pasang. Setelah Admin&Log `Delivery`, **balik ke Technical** untuk `Installation → BAST`, baru Finance `Invoice`. = perilaku sekarang. |

All three terminate at `Invoice` (Finance billing is always the final step, even when ops "selesai di teknikal").

### 1.2 Multi-termin billing (confirmed by user)
Modeled as **multiple `invoice_customers` rows per PO — one row per termin** (link per termin, no new table).

Per-type tranche pattern used by the seeder (for realism — the schema allows any pattern):
- `installation` → **2 termin**: DP 40% (saat `Processed`) + Pelunasan 60% (saat `BAST`). A minority use 3 termin (DP / progress / pelunasan).
- `supply` → mostly **single** (lunas saat `Delivery`/`Invoice`); a minority DP + pelunasan.
- `service` → mostly **single** (lunas saat selesai di Technical); a minority DP + pelunasan.

Payment status mixed across the dataset (all paid / DP-paid + pelunasan-pending / overdue) so the Finance dashboard and billing monitoring are non-trivial.

---

## 2. Backend changes (additive, real — not seeder-only)

These make the running app genuinely type-aware going forward; the seeder then produces data consistent with them.

### 2.1 Migrations (next free number, `031+`, with `-- +migrate Up/Down` markers)
1. **`purchase_orders.po_type`** — `text NOT NULL DEFAULT 'installation'`, CHECK ∈ `{service, supply, installation}`. Default `installation` ⇒ existing rows and existing app behavior unchanged (zero regression).
2. **`invoice_customers` payment extension** — add: `termin_sequence int`, `termin_label text` (CHECK ∈ `{DP, Termin, Pelunasan, Full}`), `amount numeric(18,2)`, `due_date date`, `payment_status text NOT NULL DEFAULT 'pending'` (CHECK ∈ `{pending, paid}`), `paid_at timestamptz`, `payment_method text`. Verify/relax any 1:1 constraint on `related_po_id` so **N invoice rows per PO** are allowed (the seeder needs this).

### 2.2 `po.service.js` — type-aware path (minimal generalization)
- Introduce `PATH_BY_TYPE` mapping the three subsequences in §1.1; keep the existing `STATUS_ORDER` as the canonical full list (= `installation`).
- `statusIndex` / forward-only validation, "next stage", and any "is this the terminal stage" logic resolve against **the PO's `po_type` path** instead of the global `STATUS_ORDER`.
- A PO with no/`installation` type behaves exactly as today. `service`/`supply` simply have shorter valid paths (cannot advance into stages outside their path).
- `_writeStageTransition` (history + tracking + notification + mirror + WS) is unchanged — it already records arbitrary stage codes.
- **Tests:** existing PO tests must stay green; add focused tests: (a) `service`/`supply` advance only along their path and reject off-path stages, (b) terminal stage per type, (c) `installation` unchanged.

---

## 3. Seeder design — `backend/scripts/seed-dummy.js`

A **separate, manual** script (NOT wired into the container-boot `entrypoint.sh`, which runs `seed.js`). Run on demand against the staging DB.

### 3.1 Volume & distribution
- **~100 POs**: ≈ **40 `installation` / 30 `supply` / 30 `service`**.
- **≈12–15 customers** (reuse/insert into `customers`), Indonesian names/locale, IDR.
- Each PO is placed at a **stage drawn to cover its whole type-path** — every stage of every type is represented, so each role's dashboard has live data: some POs just `Registered`, many mid-flow, some at `Invoice` + fully paid.
- **~10–15%** with `due_at` in the past (overdue) so SLA/escalation widgets and overdue indicators light up. Working-day math respected via the existing util.

### 3.2 Authentic history (not just current_status)
For each PO, walk its type-path up to its target stage and write, **with backdated timestamps spread over ~6 months**:
- `purchase_orders.current_status` = target stage; `po_type` set.
- one `purchase_order_status_history` row per stage entered (actor = a seeded user of the owning role; notes/`reason_if_delayed` on a few).
- one `purchase_order_tracking_events` row per transition (`event_type='po.status_advanced'`, JSONB `{from,to,actor_*}`).

### 3.3 Linked documents (real numbers + FKs)
Generate via the existing `utils/recordNumbers.js` so numbers are sequential and unique, and wire the FKs so document numbers **visibly link** across modules. Created **conditionally on the stage reached** and the type:
- `quotations` (QT) + `sales_purchase_orders` (PO record, `related_quotation_id`, `po_id`) — all POs at/after `Processed`.
- `purchase_requisitions` (PR, `related_po_id`) — supply/installation at/after `Production`.
- `awb_records` (AWB, `related_po_id`) — supply/installation at/after `Shipped`.
- `delivery_orders` (DO, `related_po_id`) — supply/installation at/after `Delivery`.
- `bast_records` (BAST, `related_po_id`) — service/installation at/after `BAST`.
- `invoice_customers` (INV, `related_po_id`) — at/after the billing trigger, one row per termin (§1.2), mixed `payment_status`/`paid_at`/`due_date`.
- Bypass the file-upload→stage automation; the seeder sets stages + history directly and creates document rows to match.

### 3.4 S3 attachments (minio-global) — incl. multi-upload
- ~**60%** of POs get ≥1 real object in S3 via the existing `file.service` upload path (or direct `minio.putObject` + `file_attachments` insert with the same path convention `{module}/{entity_id}/{file_id}_{name}`):
  - PDFs for AWB / DO / BAST / invoice doc-types; JPGs (photos) on `Inspected` / `Installation` / `BAST`.
  - **Multi-upload proof:** a handful of POs carry **2–3 attachments on a single stage/entity** (one-to-many is already supported; UNIQUE is on storage path only).
- Sample bytes generated at seed time (small placeholder PDF + JPG) — no external assets needed.
- **View** uses the existing **presigned download URL (15-min)** — no schema change.

### 3.5 Notifications (historical, dept-scoped, no email)
- For each stage event, insert `notifications` rows **only for the roles involved in that event**, resolved from the matching `notification_templates.recipient_roles_json` (e.g., `admin_log.po.shipped` → admin_log et al.). Backdated `created_at`, **mixed `is_read`**.
- **Do NOT enqueue email** (`email_queue`) and do NOT fire live WS — seeding inserts dashboard-channel history directly so the bell/dropdown/Recent-Notifications widgets are populated without SMTP spam.

### 3.6 Idempotency, reset & safety
- **Batch tracking via a manifest** (no new migration): the seeder writes every created `purchase_orders.id` and every S3 object key to `backend/scripts/.seed-dummy-manifest.json` (gitignored). This is the authoritative record for precise teardown. As a secondary marker (manifest-loss fallback), dummy POs use a reserved `po_number` namespace prefix (e.g. `PO-DEMO-…`) so they remain identifiable.
- **`--reset` flag**: read the manifest, delete those POs + all child rows (history, tracking, documents, invoice termins, attachments) and the listed S3 objects, then clear the manifest. If the manifest is missing, fall back to the `po_number` namespace. Reseed afterwards.
- Without `--reset`, the seeder **refuses to run if a manifest/prior batch already exists** (avoid silent duplication).
- **Target = live demo/staging.** From the host, connect via `127.0.0.1:5440` (postgres-global host port) with the staging owner creds, or run inside `interlab-api`. minio-global S3 endpoint per the app's env. ⚠️ This writes data to the live demo — run only after explicit go-ahead, and `--reset` is the rollback.

---

## 4. Acceptance criteria

1. `node scripts/migrate.js` applies `031+` cleanly; `purchase_orders.po_type` exists (default `installation`); `invoice_customers` has the new payment columns; existing rows/behavior unaffected.
2. `po.service.js` honors per-type paths: `service`/`supply` advance only along their subsequence and reject off-path stages; `installation` unchanged. Existing PO test suite green + new path tests pass.
3. `node scripts/seed-dummy.js` creates ~100 POs across the 3 types, distributed so **every role's dashboard shows non-empty widgets** (incl. some overdue).
4. Document numbers link end-to-end (QT→PO→PR→AWB/DO→BAST→INV) with resolvable FKs; `status_history` + `tracking_events` populated with backdated timestamps → PO tracking shows real progress per stage.
5. ≥60% of POs have ≥1 S3 attachment; **≥3 POs prove multi-upload** (2–3 files on one entity); presigned view opens the file.
6. Multi-termin `invoice_customers` rows exist with mixed `payment_status` (paid / DP-paid+pelunasan-pending / overdue) → Finance dashboard & billing monitoring are live.
7. Historical notifications exist for involved roles only, mixed read/unread; **zero** rows added to `email_queue` by the seeder.
8. `--reset` removes the dummy batch (DB children + S3 objects) cleanly; re-running the seeder is idempotent (no duplicates).

## 5. Out of scope / non-goals
- Full Sub-2 state-machine rewrite, true non-linear cycles, or per-stage type rules beyond the three subsequences.
- Redis query/dashboard caching layer (runtime feature, not seeding).
- Supplier-side multi-payment (`invoice_manufactures` stays single-payment).
- Any UI changes (the PO-type / multi-termin UI surfacing is Sub-3 UI work, tracked separately).
- Renaming/removing existing stages, tables, or features.

## 6. Risks & mitigations
- **Touching the core state machine** → additive only, default path = current behavior, regression-covered by existing + new tests.
- **Writing to the live demo DB** → tagged batch + `--reset` rollback + manual, gated run; never on container boot.
- **`invoice_customers` cardinality** → verify no 1:1 constraint blocks N-per-PO before relying on it; relax additively if present.
- **Backdated timestamps vs. `created_at` defaults** → seeder sets timestamps explicitly; verify no trigger overwrites them.
