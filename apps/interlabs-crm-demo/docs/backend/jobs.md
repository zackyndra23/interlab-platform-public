---
audience: dev
reading_time: 9 min
last_reviewed: 2026-04-27
---

# Background jobs

The four scheduled jobs in `backend/src/jobs/` are how the system enforces SLAs and compliance deadlines without coupling them to user request handlers. They run inside the Node API process under [node-cron](https://www.npmjs.com/package/node-cron), evaluated in `Asia/Jakarta`. Per CLAUDE.md (non-negotiable invariant): *"SLA monitoring runs as scheduled jobs, not in request handlers."* This document tells you the wiring contract, the registry, and how to extend it.

## Mental model

- **In-process node-cron, not an external queue.** The scheduler lives inside the API process; there is no Redis-queue worker, no `bull`, no separate `worker` container. `backend/src/jobs/scheduler.js:3` imports `node-cron` directly. This keeps deployment simple at the cost of horizontal scaling — see "Single-leader" below.
- **Timezone is Asia/Jakarta.** Cron expressions are evaluated in the business locale so `0 8 * * *` means 08:00 WIB everywhere. Resolved from `SCHEDULER_TIMEZONE`, falling back to `TZ`, falling back to the literal `Asia/Jakarta` (`backend/src/config/env.js:196-197`).
- **Single-leader via `SCHEDULER_ENABLED` env flag.** When the API runs on a single VPS this is irrelevant. For a multi-node deploy, exactly one node should set `SCHEDULER_ENABLED=true`; the others must set it `false` so they do not double-fire reminders. There is no leader election — this is operator-enforced (`backend/src/config/env.js:194-198`).
- **Per-job in-flight lock prevents overlapping ticks within a process.** A second cron tick that arrives while the previous run is still executing is logged and skipped, not queued (`backend/src/jobs/scheduler.js:99-123`). This matters for the long-running tax / HRGA scans whose worst case can exceed cadence under load. The lock is *in-memory only* — it does not coordinate across processes.
- **Working-day math (skip weekends) via `backend/src/utils/workingDays.js`.** Saturday and Sunday are excluded from SLA countdowns. Holiday calendars are not yet layered on top — the interface is stable so they can be added later (`backend/src/utils/workingDays.js:3-9`).
- **Idempotency is each job's responsibility, not the scheduler's.** Every job documents its own dedupe mechanism — a flag column, an `sla_tracking` ledger row, or a tiered `compliance_flag`. This means `runOnce` is safe to invoke manually for operator dry-runs.

(For the broader request-lifecycle context, see [architecture.md](./architecture.md).)

## Wiring

Lifecycle, end-to-end:

```
                     ┌─────────────────────────┐
   server boot ────► │ scheduler.start()       │ scheduler.js:138
                     │  - check env.scheduler  │ env.js:194
                     │  - validate cron expr   │ scheduler.js:152
                     │  - cron.schedule(...)   │ scheduler.js:157
                     └────────────┬────────────┘
                                  │  registers timer per JOB_DEFINITIONS
                                  ▼
                     ┌─────────────────────────┐
                     │ node-cron tick          │  fires at scheduled time
                     └────────────┬────────────┘
                                  │  invokes wrapper
                                  ▼
                     ┌─────────────────────────┐
                     │ executeGuarded(def)     │ scheduler.js:99
                     │  - if inFlight: skip    │ scheduler.js:103
                     │  - inFlight=true        │
                     │  - await def.run()      │ scheduler.js:110
                     │  - record duration/err  │ scheduler.js:113-119
                     │  - inFlight=false       │ scheduler.js:121
                     └────────────┬────────────┘
                                  │  log line
                                  ▼
                          stdout (info|warn|error)
```

Out-of-band path — operator dry-runs and integration tests:

```
   node REPL / test ──► scheduler.runOnce(name)        scheduler.js:193
                          │
                          │  finds JOB_DEFINITIONS entry by name
                          │  materializes runtime state if absent
                          ▼
                        executeGuarded(def)            scheduler.js:205
```

`runOnce` bypasses the cron trigger but still routes through the same `executeGuarded` wrapper, so the in-flight lock and error capture apply identically. It returns `{name, lastRunAt, lastError}` so a caller can assert success without scraping logs.

`stop()` (`backend/src/jobs/scheduler.js:178`) tears down every registered task and clears the runtime map. It is used by the test harness and by graceful shutdown handlers.

## Key files

| File | Role |
|------|------|
| `backend/src/jobs/scheduler.js` | Registers `JOB_DEFINITIONS`, owns lifecycle (`start`/`stop`/`runOnce`/`status`), enforces overlap guard via `executeGuarded` |
| `backend/src/jobs/slaReadyToDeliver.job.js` | **[Technical](../business/system-overview.md#glossary-technical)** Ready-to-Deliver 2-working-day SLA scan |
| `backend/src/jobs/slaPoDueDate.job.js` | **[Technical](../business/system-overview.md#glossary-technical)** **[PO](../business/system-overview.md#glossary-po)** 30-day due reminder |
| `backend/src/jobs/slaHrgaExpiry.job.js` | **[HRGA](../business/system-overview.md#glossary-hrga)** legal-document tiered expiry monitor (90d / 30d / expired) |
| `backend/src/jobs/taxDeadlineMonitor.job.js` | **[Tax & Insurance](../business/system-overview.md#glossary-tax-insurance)** monthly **[Masa Pajak](../business/system-overview.md#glossary-masa-pajak)** + **[SPT](../business/system-overview.md#glossary-spt)** scan |
| `backend/src/utils/workingDays.js` | `addWorkingDays`, `workingDaysBetween`, `isWeekend`, `isOverdue` — used by SLA math |
| `backend/src/config/env.js` | `scheduler.enabled`, `scheduler.timezone` — single-leader and TZ controls |

## Job catalogue

The four jobs registered in `JOB_DEFINITIONS` (`backend/src/jobs/scheduler.js:37-70`). All run in `Asia/Jakarta`. Notification template keys are emitted via `services/notification.service.js#emit` (see [notifications.md](./notifications.md) for the catalogue and template-gating rules); a disabled `notification_templates` row suppresses delivery without erroring.

| Job name | Cron | Purpose | Module | Tables read | Templates fired |
|----------|------|---------|--------|-------------|-----------------|
| `sla_technical_ready_to_deliver` | `0 * * * *` (hourly on the hour) | Escalate **[Admin & Log](../business/system-overview.md#glossary-admin-log)** when **[Technical](../business/system-overview.md#glossary-technical)** has flagged a record `ready_to_deliver='Yes'` and `admin_log_response_status='pending'` for >2 working days | `slaReadyToDeliver.job.js` | `installation_records`, `sparepart_records`, `technical_job_orders`, `purchase_orders`, `sla_tracking` | `admin_log.ready_to_deliver.overdue_response` to `[Admin & Log, Superadmin, CEO]` |
| `technical_po_due_reminder` | `0 8 * * *` (daily 08:00 WIB) | Flag **[Technical](../business/system-overview.md#glossary-technical)** Job Orders whose `po_due_date` is within 30 days and warn the assigned engineer + Technical team (this job interlocks with the 11-stage PO lifecycle — see [po-state-machine.md](./po-state-machine.md)) | `slaPoDueDate.job.js` | `technical_job_orders` | `technical.po.due_date_reminder` to assigned engineer + support team + `[Technical]` |
| `hrga_expiry_monitor` | `0 8 * * *` (daily 08:00 WIB) | Tiered scan of `hrga_legal_documents` — flips `compliance_flag` to `expired` / `expiring_soon_30` / `expiring_soon_90` | `slaHrgaExpiry.job.js` | `hrga_legal_documents` | `hrga.document.expired` / `hrga.document.expiring_30` / `hrga.document.expiring_90` to PIC user + `[HRGA, Superadmin, CEO]` |
| `tax_deadline_monitor` | `0 8 1 * *` (1st of month 08:00 WIB) | Three rules against the previous **[Masa Pajak](../business/system-overview.md#glossary-masa-pajak)** — missing required record, unpaid closed Masa Pajak, **[SPT](../business/system-overview.md#glossary-spt)** not filed | `taxDeadlineMonitor.job.js` | `tax_operational_records`, `sla_tracking` | `tax.reminder.unpaid` (also used as the "missing record" carrier), `tax.reminder.spt_not_filed` to PIC user + `[Tax & Insurance, Superadmin, CEO]` |

### Not yet implemented

CLAUDE.md (line 71) lists a **[Sales](../business/system-overview.md#glossary-sales)** **[PO](../business/system-overview.md#glossary-po)** 2-working-day deadline SLA whose escalation targets `[Superadmin, CEO, Admin & Log, Finance]`. There is **no `sales_*` entry in `JOB_DEFINITIONS`** as of this review (`backend/src/jobs/scheduler.js:37-70`). When the Sales SLA job is added it will register here; the per-PO `step_due_at` field on `sales_purchase_orders` already exists to drive it.

## Invariants

These are the rules the scheduler guarantees on top of each job's own contract. Do not weaken them when extending.

1. **Working-day math (skip weekends) via `backend/src/utils/workingDays.js`.** `isWeekend` (line 6-9) treats Saturday + Sunday as non-working. `workingDaysBetween` (line 50-65) is the canonical countdown helper used by `slaReadyToDeliver.job.js:146-149` to evaluate the 2-working-day SLA. Holiday-aware overrides are deliberately deferred — when added they will layer over `isWeekend` without touching callers.

2. **Jobs are idempotent — safe to `runOnce` manually.** Every job either sets a marker column or writes a dedupe row to `sla_tracking` so re-running it is a no-op against records it already processed:
   - `slaReadyToDeliver.job.js:95-101` short-circuits if `sla_tracking.escalation_sent_at` is already populated for the row keyed on `(entity_type, entity_id)`, where `entity_type` encodes the RTD window (e.g. `'installation_records.ready_to_deliver'`).
   - `slaPoDueDate.job.js:28` filters on `due_date_reminder_flag = false`, then the update at `slaPoDueDate.job.js:39-43` flips it to `true` so the next tick skips the row.
   - `slaHrgaExpiry.job.js:54-86` uses tiered `compliance_flag` matching (`<> 'expiring_soon_30'`, `= 'ok'`) so a document already in a tier never re-emits its tier event.
   - `taxDeadlineMonitor.job.js:46-64` writes `sla_tracking` rows keyed by `(entity_type, entity_id, stage)` and checks for an existing row before emitting (`taxDeadlineMonitor.job.js:243`, `:263`).

3. **Overlap guard is per-process, not cluster-wide.** `executeGuarded` (`backend/src/jobs/scheduler.js:99-123`) sets `state.inFlight=true` before invoking the job and clears it in a `finally`. A second tick from the *same* process while the first is still running logs `skip: previous run still in flight` (`scheduler.js:104`) and returns. Two scheduler instances racing is **not** prevented here — that is what the `SCHEDULER_ENABLED` flag is for.

4. **Only one node should have `SCHEDULER_ENABLED=true` in a multi-node deploy.** `backend/src/config/env.js:194-198` reads the flag with a default of `'true'`. When `start()` sees `enabled=false` it logs `SCHEDULER_ENABLED=false — jobs not scheduled` (`scheduler.js:140-142`) and registers nothing. Operator-enforced — there is no Redis-based leader election. For the current single-VPS deploy this is a no-op concern; revisit when scaling out.

5. **`start()` is re-entrant safe.** A second call after the first registration returns the existing job names without double-scheduling (`scheduler.js:144-148`). Useful for hot-reload supervisors and tests.

6. **Job errors never escape into node-cron.** `executeGuarded` catches every throw, records it on `state.lastError`, and logs at `error` level (`scheduler.js:116-119`). An uncaught error here would kill the cron timer for that job — the wrapper exists to prevent that.

## Extension points

### Adding a new job

1. Create `backend/src/jobs/<name>.job.js` exposing `module.exports = { run }` where `run` is `async () => result` and idempotent on repeat invocation. Follow the pattern in the existing four — wrap DB work in `db.withTransaction(async (c) => { ... })` and call `notificationService.emit(c, {...})` for any user-visible reminder.
2. Register it in `JOB_DEFINITIONS` (`backend/src/jobs/scheduler.js:37-70`) with `{name, schedule, run: () => mod.run()}`. Use snake_case for the name so it greps cleanly out of logs.
3. If the job has SLA semantics, prefer `backend/src/utils/workingDays.js` over raw date math so weekends are skipped.
4. Pick a dedupe mechanism *up front* — a marker column on the entity table, or an `sla_tracking` row keyed by `(entity_type, entity_id, stage)`. Without this, `runOnce` is unsafe and the scheduled tick will spam reminders on every cadence.

```js
// backend/src/jobs/myThing.job.js — minimal idempotent skeleton.
const db = require('../config/database');
const notify = require('../services/notification.service');

async function run() {
    return db.withTransaction(async (c) => {
        // 1. SELECT rows that need action AND have no dedupe marker.
        // 2. UPDATE marker column (or INSERT sla_tracking) BEFORE notify.
        // 3. notify.emit(c, { templateKey, ... }).
        return { scanned: 0, acted: 0 };
    });
}
module.exports = { run };
```

### Running a job manually

For operator dry-runs and one-off backfills, invoke via Node directly. The scheduler does not need to be `start()`-ed first — `runOnce` materializes runtime state on the fly (`backend/src/jobs/scheduler.js:200-204`).

```bash
# Run from the backend/ directory of the deploy (or via docker exec).
node -e "require('./src/jobs/scheduler').runOnce('hrga_expiry_monitor').then(console.log)"
```

Returns `{name, lastRunAt, lastError}`. Use this in cron-replacement contexts (e.g. an admin "re-scan now" button that hits a Superadmin-only API which proxies to `runOnce`).

### Inspecting state at runtime

`scheduler.status()` (`backend/src/jobs/scheduler.js:214-221`) returns `[{name, in_flight, last_run_at, last_error}]` for every registered job. Wire this to a Superadmin debug endpoint if observability beyond stdout logs is needed; nothing currently consumes it.

### Changing cadence or timezone

- **Cron expression** — edit the `schedule` field on the relevant `JOB_DEFINITIONS` entry. `cron.validate` (`scheduler.js:152`) rejects malformed expressions at boot, so a typo fails fast.
- **Timezone** — set `SCHEDULER_TIMEZONE` in the deployed `.env`. The default `Asia/Jakarta` matches the business locale; only override for tests that need UTC-evaluated schedules.

<!--
drift-anchors:
- backend/src/jobs/scheduler.js
- backend/src/jobs/slaReadyToDeliver.job.js
- backend/src/jobs/slaPoDueDate.job.js
- backend/src/jobs/slaHrgaExpiry.job.js
- backend/src/jobs/taxDeadlineMonitor.job.js
- backend/src/utils/workingDays.js
- backend/src/config/env.js
- backend/src/services/notification.service.js
- docs/backend/notifications.md
- docs/backend/po-state-machine.md
- docs/backend/architecture.md
- CLAUDE.md
-->
