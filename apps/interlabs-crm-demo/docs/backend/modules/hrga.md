---
audience: dev
reading_time: 14 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- backend/src/routes/hrga.routes.js
- backend/src/services/hrga.service.js
- backend/src/validators/hrga.validators.js
- backend/src/jobs/slaHrgaExpiry.job.js
- backend/migrations/009_hrga_forms.sql
- backend/migrations/014_indexes.sql
- backend/scripts/seed.js
- frontend/lib/hrga-api.ts
- frontend/lib/hrga-types.ts
- frontend/lib/hrga-ui.ts
- frontend/app/(app)/hrga/
- interlabs-crm-demo/docs/MOD_hrga.txt
- docs/backend/jobs.md
- docs/backend/notifications.md
- docs/backend/auth-and-rbac.md
-->

# HRGA / Legal module

The **[HRGA](../../business/system-overview.md#glossary-hrga)** division is the company's compliance memory: the single store for **company legalitas** (NPWP, BPJS, KEMNAKER, Domisili, Akta, NIB, KADIN, SPPKP, …), **Company Letters** (internal HR / legal correspondence with a Draft → Sent state machine), an **Archive** mirror for anything Superseded / Expired / Withdrawn, a **Compliance & Expiry** dashboard, and a unified **Smart Search** that spans all three stores. Every other division consumes HRGA output (audits, principal renewals, tender packets) but no division writes into it — HRGA is a *leaf* module in the cross-division graph.

## Purpose

The HRGA module owns the lifecycle of every document that proves the company is legally allowed to operate, employ, and contract. Three concerns drive the design:

1. **Versioning without losing history.** A new NPWP supersedes the old one, but auditors and tender desks still need to find the old number. Implemented via `supersede` (insert a new Active row, flip the previous row to `Superseded`, link them with `superseded_by_id`) instead of in-place updates. See `backend/src/services/hrga.service.js:295`.
2. **Compliance must be ambient, not on-demand.** Nobody opens a CRM to *check* whether **[Domisili](../../business/system-overview.md#glossary-domisili)** expires next month. The 90-day / 30-day / expired tier is delivered by `slaHrgaExpiry.job.js` as a daily push so HRGA, **[Superadmin](../../business/system-overview.md#glossary-superadmin)**, and **[CEO](../../business/system-overview.md#glossary-ceo)** see it without looking. See [SLA hooks](#sla-hooks).
3. **Cross-role discoverability with role-gated visibility.** Tender prep needs to find an LOA Principle in 10 seconds across legalitas + letters + archive. Smart Search runs a 3-arm `UNION ALL` over `hrga_legal_documents`, `company_letters`, `hrga_archive_records` with **[Postgres FTS](../architecture.md)** (`simple` config — Bahasa Indonesia content), and gates rows by `access_scope` per requesting role.

The module never participates in the **[PO](../../business/system-overview.md#glossary-po)** lifecycle (see [Automations](#automations)). It is wholly read-by-many, written-by-HRGA.

## Forms / entities owned

| Entity | Table | Purpose |
|---|---|---|
| Legalitas (legal documents) | `hrga_legal_documents` | Company legalitas repository, versioned, expiry-monitored |
| Company Letters | `company_letters` | Internal HR / legal correspondence with state machine |
| Letter Templates | `letter_templates` | Reusable HTML bodies for company letters |
| Archive | `hrga_archive_records` | Mirror store for Superseded / Expired / Withdrawn rows |
| Smart Search | (read-only across the above) | Unified UNION query, role-gated |
| Compliance & Expiry | (read-only over `hrga_legal_documents`) | Tier counts + expiring-soon list |

**Legalitas — document categories** (configurable per `MOD_hrga.txt:92` — these are seed defaults, not a CHECK constraint):

- Akta Perusahaan
- BPJS (Kesehatan, Ketenagakerjaan)
- Company Profile
- CSMS
- STP RI
- KADIN
- KTP Karyawan
- Laporan Audit & SPT Tahunan
- LOA Principle
- NIB
- NPWP
- SKT Pajak
- SKT Customer
- SPPKP
- KEMNAKER (under categories such as Sertifikat / Pelaporan)
- Domisili (Surat Keterangan Domisili Perusahaan)

The category list lives as text in `hrga_legal_documents.document_category` — not enum-constrained — so HRGA can add a category from the UI without a migration. Each row also carries `document_subcategory` (e.g. category=`BPJS`, subcategory=`Ketenagakerjaan`) and a free-form `tags text[]` array for cross-cutting labels like `tender-2026`. See `backend/migrations/009_hrga_forms.sql:22`.

**Legalitas — lifecycle states** (CHECK-enforced, `migrations/009_hrga_forms.sql:59`):

```
Draft → Active → Expiring Soon → Expired
                              ↘ Superseded (manual, via /supersede)
                              ↘ Archived   (manual, via /archive)
```

Transitions to `Expiring Soon` and `Expired` are **automatic** (driven by the SLA job, never by user action). `Superseded` is exclusively reached via `POST /legal-documents/:id/supersede`. `Archived` is reached via `POST /legal-documents/:id/archive` *or* the source-agnostic `POST /archive`.

**Company Letters — lifecycle states** (CHECK-enforced, `migrations/009_hrga_forms.sql:108`):

```
Draft → Under Review → Final → Sent → Archived
```

Forward-only — `transitionCompanyLetter` (`hrga.service.js:634`) rejects any move to a lower-ordered state with 409 Conflict. Archive is its own endpoint because it must mirror into `hrga_archive_records`.

**Archive — `source_module` enum**: `legalitas`, `company_letters`, `other`. `archive_reason` enum: `Superseded`, `Expired`, `Withdrawn`, `Other`. The `source_record_id` is a **soft pointer** — no FK — because it must reference different source tables per `source_module` (`migrations/009_hrga_forms.sql:124`).

## Routes

All routes mounted under `/api/hrga`, registered in `backend/src/app.js`. Every route requires `authMiddleware` (JWT) + `rbacGuard` capability check. Listing routes additionally apply `hrgaScopeUserId` — for any role that is not [superadmin], [ceo], or [hrga], rows are filtered by `created_by = req.user.id` (`hrga.routes.js:26`).

| Method | Path | Capability | Service | Notes |
|---|---|---|---|---|
| GET | `/search` | `hrga_legal:view_own` | `smartSearch` | Cross-source UNION, role-gated by `access_scope` |
| GET | `/compliance/expiring` | `hrga_compliance:view_own` | `listExpiringDocuments` | `within_days` default 90, sorted by `expiry_date ASC` |
| GET | `/compliance/summary` | `hrga_compliance:view_own` | `complianceDashboardCounts` | Returns `{ok, expiring_soon_90, expiring_soon_30, expired}` |
| GET | `/legal-documents` | `hrga_legal:view_own` | `listLegalDocuments` | Filters: category/subcategory/status/flag/PIC/customer/tag/year |
| GET | `/legal-documents/:id` | `hrga_legal:view_own` | `getLegalDocument` | |
| POST | `/legal-documents` | `hrga_legal:create` | `createLegalDocument` | Auto-computes `reminder_90/30_days_at` |
| PUT | `/legal-documents/:id` | `hrga_legal:edit` | `updateLegalDocument` | 409 if status is `Superseded` or `Archived` |
| POST | `/legal-documents/:id/supersede` | `hrga_legal:edit` | `supersedeLegalDocument` | Inserts new Active, flips old to `Superseded` |
| POST | `/legal-documents/:id/archive` | `hrga_legal:edit` | `archiveLegalDocument` | Mirrors into `hrga_archive_records` |
| DELETE | `/legal-documents/:id` | `hrga_legal:delete` | `deleteLegalDocument` | 409 on Active + still-valid expiry |
| GET | `/company-letters` | `company_letters:view_own` | `listCompanyLetters` | Filters: status/type/signatory/employee |
| GET | `/company-letters/:id` | `company_letters:view_own` | `getCompanyLetter` | |
| POST | `/company-letters` | `company_letters:create` | `createCompanyLetter` | |
| PUT | `/company-letters/:id` | `company_letters:edit` | `updateCompanyLetter` | 409 when `Archived`; emits transition notifications |
| PUT | `/company-letters/:id/transition` | `company_letters:edit` | `transitionCompanyLetter` | Forward-only; rejects move to `Archived` (use `/archive`) |
| POST | `/company-letters/:id/archive` | `company_letters:edit` | `archiveCompanyLetter` | Mirrors into `hrga_archive_records` |
| DELETE | `/company-letters/:id` | `company_letters:delete` | `deleteCompanyLetter` | 409 on `Final` / `Sent` |
| GET | `/letter-templates` | `company_letters:view_own` | `listLetterTemplates` | |
| GET / POST / PUT / DELETE | `/letter-templates[/:id]` | `company_letters:{view_own,create,edit,delete}` | `…LetterTemplate` | Hard-delete; FK has `ON DELETE SET NULL` |
| GET | `/archive` | `hrga_archive:view_own` | `listArchive` | |
| GET | `/archive/:id` | `hrga_archive:view_own` | `getArchiveRecord` | |
| POST | `/archive` | `hrga_archive:create` | `createArchive` | Validates source row, syncs source status |
| PUT | `/archive/:id` | `hrga_archive:edit` | `updateArchive` | |
| DELETE | `/archive/:id` | `hrga_archive:delete` | `deleteArchive` | Hard-delete (no `deleted_at` column) |

The `/search` route is registered **above** `/legal-documents/:id` so Express does not match `search` as an `:id` UUID parameter (`hrga.routes.js:42`). Smart Search is a cross-role read endpoint guarded by `hrga_legal:view_own` plus the per-row `access_scope` filter described in [Visibility](#visibility-and-rbac).

## Validators

Joi schemas in `backend/src/validators/hrga.validators.js`. Enums mirror the migration CHECK constraints exactly so the validator and the database agree on the same set of values.

- **`legalDocumentCreate` / `legalDocumentUpdate`** (`validators/hrga.validators.js:55`): only `document_name` is required on create; everything else (category, subcategory, dates, PIC, status, tags, notes, `access_scope`, `attachment_ids`) is optional. Update requires `min(1)` so empty PUT bodies are rejected.
- **`legalDocumentSupersede`** (`validators/hrga.validators.js:79`): same shape as the create payload plus `supersede_reason`. Every field optional — a minimal payload (e.g. only `version_number`) inherits the rest from the previous row in the service (`hrga.service.js:326`).
- **`archiveDocumentRequest`** (`validators/hrga.validators.js:88`): `archive_reason` required, restricted to the four-value enum that matches `migrations/009_hrga_forms.sql:136`.
- **`companyLetterCreate`** (`validators/hrga.validators.js:119`): `subject` is the only required field. `letter_status` defaults to `Draft` server-side via `COALESCE`.
- **`companyLetterTransition`** (`validators/hrga.validators.js:138`): `letter_status` required (one of the five enum values) plus optional `note` that lands in `notes`. The forward-only ordering check is enforced in the service, not the validator.
- **`smartSearchQuery`** (`validators/hrga.validators.js:199`): `unknown(false)` — typos in filter names return 400, not "silent ignore". `status` accepts the *union* of legal-document and letter statuses because the same query field maps to either column depending on which UNION arm matches.
- **`complianceExpiringQuery`** (`validators/hrga.validators.js:226`): `within_days` clamped 1–720 (≈ 2 years), default 90 to match the SLA tier.

The `attachment_ids: uuid[]` slot on every create/update payload is the binding handle for files uploaded via `/api/files` — the service rebinds them into `file_attachments` with `related_module='hrga.legal_documents'` (or `hrga.company_letters` / `hrga.archive`), `related_entity_id=<row id>` (`hrga.service.js:92`).

## Services

`backend/src/services/hrga.service.js` is a single 1300-line file split into seven sub-modules by section banner comment. Notes on the non-obvious bits:

- **Record numbers.** Every parent row gets a deterministic, gap-tolerant record number from `nextRecordNumber()` (`utils/recordNumbers.js`) using the `HRGA_PREFIXES` table. Legalitas uses `LGL-YYYY-NNNNN`, letters use `CL-…`, archive uses `ARC-…`.
- **Reminder anchors.** `computeExpiryReminders(expiry_date)` returns `{reminder90, reminder30}` ISO strings — written into `reminder_90_days_at` and `reminder_30_days_at` so the SLA job *could* pivot off pre-computed timestamps later (today the job recomputes from `expiry_date` at scan time; the columns are populated for forward-compat). When `expiry_date` is changed via `updateLegalDocument`, the reminders are recomputed *and* `compliance_flag` is reset to `'ok'` and `expired_at` cleared, so renewing a document mid-flight re-arms the 90d/30d tiers (`hrga.service.js:258`).
- **Supersede atomicity.** `supersedeLegalDocument` runs `INSERT new + UPDATE old` in a single `db.withTransaction` so the system never has two `Active` rows for the same conceptual document. The previous row is `SELECT … FOR UPDATE`-locked first to serialize concurrent supersedes (`hrga.service.js:296`).
- **Archive mirroring.** Both `archiveLegalDocument` and `archiveCompanyLetter` call the shared `insertArchiveMirror` helper which writes the `hrga_archive_records` row, then update the source row's status. The source-agnostic `POST /archive` endpoint (`createArchive`, `hrga.service.js:898`) does the inverse — it accepts a `source_module` + `source_record_id` and *also* flips the source row's status, so an archive row can never be created without its source landing in `Archived`.
- **Letter transition notifications.** `emitLetterTransitionNotification` (`hrga.service.js:597`) only fires on transitions *into* `Under Review` or `Final`. `Sent` and `Archived` are intentionally silent — the cross-team signal is "please review" or "this is final"; the actual delivery to a recipient is tracked outside the system.
- **Smart Search SQL building.** `smartSearch` (`hrga.service.js:1006`) builds a UNION of three normalized projections so the result rows have a single shape regardless of source. Keyword search uses `to_tsquery('simple', …)` with `:*` prefix-suffixed tokens (`toTsqueryInput`, `hrga.service.js:1203`). The `simple` FTS config is mandatory — English stemming would mangle Indonesian words (`migrations/009_hrga_forms.sql:11`).

## DB tables

All four tables defined in `backend/migrations/009_hrga_forms.sql`. UUID PKs, soft-delete `deleted_at` on the two main entities (archive and templates are hard-delete), `created_by`/`updated_by` audit columns.

| Table | Notes |
|---|---|
| `hrga_legal_documents` | `legal_document_record_number` UNIQUE; status + `compliance_flag` CHECK constraints; `superseded_by_id` self-FK; `search_document tsvector` populated by trigger (not GENERATED — `array_to_string` on `text[]` is not IMMUTABLE, see `migrations/009_hrga_forms.sql:49`); GIN index lives in migration 014 |
| `letter_templates` | No `updated_at`, no soft delete — versioned by inserting new rows; FK from `company_letters.template_reference_id` is `ON DELETE SET NULL` |
| `company_letters` | `letter_record_number` UNIQUE; status CHECK constraint forward-only enforced in service; `search_document tsvector` populated by trigger |
| `hrga_archive_records` | `archive_record_number` UNIQUE; `source_record_id` is *not* a FK (soft pointer); `archive_reason` CHECK is nullable to allow legacy backfills |

The two `search_document tsvector` columns are kept in sync by triggers defined alongside migration 014 (the GIN indexes). The trigger concatenates `coalesce(document_name,'')`, `document_number`, `notary_name`, `array_to_string(tags,' ')`, `notes` for legalitas, and the equivalents for letters.

**Visibility / RBAC notes** (full three-layer model in [auth-and-rbac.md](../auth-and-rbac.md)):

- **Capability matrix** (seeded in `backend/scripts/seed.js:54`): the HRGA role gets `hrga_legal`, `company_letters`, `hrga_archive`, `hrga_compliance`, `hrga_smart_search` (`seed.js:96`). [Superadmin] and [CEO] inherit all features. No other role gets HRGA features by default — but Smart Search and Compliance Listing are cross-role *if* a feature is granted manually (the routes enforce capability, not role).
- **Same-role manager scoping.** The HRGA role manager can only create/edit users whose role is also `hrga` (CLAUDE.md non-negotiable). Enforced server-side in user-management middleware, not in this module.
- **Per-row `access_scope`** (`hrga_only` / `all_roles` / `specific_roles`). Today the service treats `specific_roles` as `hrga_only` from the unauthorized direction — there is no per-role membership table yet (`hrga.service.js:991`). The Smart Search SQL adds `accessScopeClause(actor.role)` to every UNION arm: [Superadmin], [CEO], and [HRGA] see everything; any other role only sees rows where `access_scope='all_roles'`.
- **Listing scope** (`hrgaScopeUserId`, `hrga.routes.js:26`). For non-HRGA-trio roles hitting list endpoints, rows are additionally filtered by `created_by = req.user.id`. This is a defense-in-depth layer below the capability check, not a substitute for it.

## Notifications fired

Events emitted via `notification.service.emit()`. Recipient resolution and channel selection live in [notifications.md](../notifications.md); this section only enumerates the events.

| `template_key` | Emitted from | Recipients | Trigger |
|---|---|---|---|
| `hrga.letter.review_requested` | `hrga.service.js:605` (transition or update into `Under Review`) | `extraRoles=['hrga']` plus template `recipient_roles_json` | Letter status moves to `Under Review` |
| `hrga.letter.finalized` | `hrga.service.js:616` (transition or update into `Final`) | `extraRoles=['hrga','superadmin','ceo']` | Letter status moves to `Final` |
| `hrga.document.expiring_90` | `slaHrgaExpiry.job.js:140` | `extraRoles=['hrga','superadmin','ceo']` plus document `pic_user_id` | Daily scan: 30 < days-to-expiry ≤ 90 and `compliance_flag='ok'` |
| `hrga.document.expiring_30` | `slaHrgaExpiry.job.js:140` | `extraRoles=['hrga','superadmin','ceo']` plus document `pic_user_id` | Daily scan: 0 < days-to-expiry ≤ 30 and `compliance_flag <> 'expiring_soon_30'` |
| `hrga.document.expired` | `slaHrgaExpiry.job.js:114` | `extraRoles=['hrga','superadmin','ceo']` plus document `pic_user_id` | Daily scan: `expiry_date <= CURRENT_DATE` and status not already `Expired` |

These five `template_key` rows are not seeded in `migrations/` or `scripts/seed.js`; the notification switchboard treats a missing template as "enabled, dashboard-only" (`notification.service.js:62`), so events still record and fan out until [Superadmin] / [CEO] create explicit template rows from the Notifications admin UI to add email channels or change recipients. See [notifications.md](../notifications.md#missing-vs-disabled).

## Automations

- **Incoming (HRGA writes triggered by other modules):** none. No PO stage, AWB write, DO issue, BAST upload, or invoice event creates rows in any HRGA table. Document records are exclusively created and edited by HRGA users.
- **Outgoing (HRGA writes that drive other modules):** none into the [PO](../../business/system-overview.md#glossary-po) lifecycle. The 11-stage PO state machine in [po-state-machine.md](../po-state-machine.md) does not consume any HRGA event. The expiry notifications go to dashboards / email but never to the PO tracker.
- **Internal automations:**
  - Auto-expiry tier transition: `Active` → `Expiring Soon` → `Expired` is driven entirely by the SLA job (see below). User code never sets these states directly.
  - Reminder reset on renewal: `updateLegalDocument` resets `compliance_flag` to `'ok'` and clears `expired_at` whenever `expiry_date` is changed (`hrga.service.js:258`). Same effect via supersede — the new row starts at `Active`/`ok`.
  - Source-status sync on archive: any path that creates an `hrga_archive_records` row also flips the source row's status to `Archived` in the same transaction (`hrga.service.js:447`, `hrga.service.js:712`, `hrga.service.js:928`). Source rows cannot drift out of `Archived`.

This means **HRGA is a leaf in the cross-division event graph**: events fan out *from* it (notifications) but no domain event from outside the module ever updates an HRGA row.

## SLA hooks

One scheduled job: **`hrga_expiry_monitor`** in `backend/src/jobs/slaHrgaExpiry.job.js`. Registered in `scheduler.js`'s `JOB_DEFINITIONS` to run **daily at 08:00 Asia/Jakarta**. Cross-link: [jobs.md](../jobs.md) for the wiring contract, leader-election caveat, and overlap-guard.

Algorithm (per the source comment, `slaHrgaExpiry.job.js:6`):

```
1. expired   ← rows where expiry_date <= today AND status NOT IN
                ('Archived','Superseded','Expired')
              → set status='Expired', compliance_flag='expired',
                expired_at=now(), emit hrga.document.expired
2. tier-30   ← rows where 0 < expiry_date - today <= 30
                AND compliance_flag <> 'expiring_soon_30'
              → set status='Expiring Soon', flag='expiring_soon_30',
                emit hrga.document.expiring_30
3. tier-90   ← rows where 30 < expiry_date - today <= 90
                AND compliance_flag = 'ok'
              → set status='Expiring Soon', flag='expiring_soon_90',
                emit hrga.document.expiring_90
```

Order matters: a document that crossed from the 30d window straight to expired in a single run gets exactly one `hrga.document.expired` event (not a duplicate `expiring_30` first). The same logic guarantees a row in the 30d window cannot subsequently emit the 90d event.

**Idempotency mechanism.** Each tier sets a *distinct* `compliance_flag` value, and each tier's `WHERE` filters on the *previous* flag. Re-running the same day finds zero rows for any tier already processed. Renewing a document via `updateLegalDocument` or `supersedeLegalDocument` resets `compliance_flag='ok'`, so the 90d/30d tiers re-arm. `Archived` and `Superseded` rows are excluded from every scan.

**Locking.** Each tier query uses `FOR UPDATE SKIP LOCKED` so a manual `runOnce` triggered while the cron tick is mid-flight does not double-fire. The scheduler's per-job in-flight lock (`scheduler.js:99`) is the primary guard; this is belt-and-braces.

**Observability.** `run()` returns `{scanned, expired, expiring30, expiring90}` (`slaHrgaExpiry.job.js:179`). The scheduler logs the duration; in production you watch the daily run stamp via `scheduler.status()`.

## Frontend pages

Tree under `frontend/app/(app)/hrga/` (Next.js App Router). API client in `frontend/lib/hrga-api.ts`, types in `hrga-types.ts`, presentational helpers (status pills, tier colours) in `hrga-ui.ts`.

| Path | Purpose |
|---|---|
| `legalitas/page.tsx` | Legalitas index — filters, status / flag chips, paginated table |
| `legalitas/new/page.tsx` | Create form (POST `/legal-documents`) |
| `legalitas/[id]/page.tsx` | Detail view — renders supersede / archive / edit links per status |
| `legalitas/[id]/edit/page.tsx` | Edit form (PUT `/legal-documents/:id`) |
| `legalitas/[id]/supersede/page.tsx` | Supersede wizard — defaults inherited from previous row, only changed fields posted |
| `legalitas/[id]/archive/page.tsx` | Archive form (`archive_reason` required) |
| `company-letters/page.tsx` | Letters index — status filter, signatory filter |
| `company-letters/new/page.tsx` | Create form (POST `/company-letters`) |
| `company-letters/[id]/page.tsx` | Detail — exposes `transition` action with the next-allowed status |
| `company-letters/[id]/edit/page.tsx` | Edit form |
| `company-letters/[id]/archive/page.tsx` | Archive form |
| `compliance/page.tsx` | Dashboard — `/compliance/summary` for tier counts, `/compliance/expiring` for the table |
| `archive/page.tsx` | Archive index — `source_module` + `archive_reason` filters |
| `archive/new/page.tsx` | Source-agnostic create (POST `/archive`) — used when archiving a row outside its native module |
| `archive/[id]/page.tsx`, `archive/[id]/edit/page.tsx` | View / edit archive rows |
| `smart-search/page.tsx` | Cross-source search — keyword, dates, PIC, customer, employee, status, tag, `include_archive` toggle |

The Smart Search page is the surface area where role-gated `access_scope` matters most: a non-HRGA user with the `hrga_smart_search` capability sees only `access_scope='all_roles'` rows, and the page does not expose category management.

## Cross-references

- [auth-and-rbac.md](../auth-and-rbac.md) — three-layer RBAC model (frontend menu, route middleware, query scope) and the `same-role manager` constraint
- [notifications.md](../notifications.md) — `emit()` semantics, recipient resolution, missing-vs-disabled template behaviour
- [jobs.md](../jobs.md) — scheduler wiring, leader-election, overlap-guard for `hrga_expiry_monitor`
- [po-state-machine.md](../po-state-machine.md) — confirms HRGA is *not* a participant in the 11-stage PO lifecycle
- [architecture.md](../architecture.md) — Postgres FTS configuration choice (`simple` for Bahasa Indonesia)
- Source: `backend/src/routes/hrga.routes.js`, `backend/src/services/hrga.service.js`, `backend/src/validators/hrga.validators.js`, `backend/src/jobs/slaHrgaExpiry.job.js`, `backend/migrations/009_hrga_forms.sql`
- Spec: `interlabs-crm-demo/docs/MOD_hrga.txt` (full module spec), `interlabs-crm-demo/docs/CTX_master_context.txt` (RBAC matrix, notification system)
