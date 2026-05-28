---
audience: operator
reading_time: 6 min
last_reviewed: 2026-04-27
---

# Scheduler runbook

Operator-facing procedures for the in-process background scheduler that runs the four SLA / compliance jobs. The scheduler lives inside the `interlab-api` container — there is no separate worker. This runbook covers confirming it is running, firing a job manually, designating a leader when running multiple replicas, and diagnosing missed runs. For *why* a job is scheduled the way it is, and how each job dedupes, see [scheduler internals](../backend/jobs.md).

## Purpose

You are here because:

- A reminder email did or did not go out and you need to confirm whether the scheduler ticked.
- You have a multi-node deploy and need to designate which node owns the cron triggers.
- You need to fire a job out-of-band — backfill after a crash, dry-run after a code change, or "rescan now" on operator request.
- Logs show `[scheduler]` warnings or errors and you need to interpret them.

What this runbook does **not** cover: writing a new job (see [extension points](../backend/jobs.md#extension-points)), changing cadence (edit `JOB_DEFINITIONS` in `backend/src/jobs/scheduler.js:37` and redeploy), or notification-template enablement (see [notifications.md](../backend/notifications.md)).

## Prerequisites

- The `interlab-api` container is running. Confirm with `docker ps --filter name=interlab-api`. If it is restart-looping, fix the deployment first — see [deployment.md](./deployment.md#failure-backend-container-restart-looping).
- You have shell access to the host (`51.79.146.14`) and can run `docker exec`.
- You know which node is the designated scheduler leader. In the current single-VPS deploy, the only node *is* the leader and `SCHEDULER_ENABLED=true` in `docker-compose.demo.yml:32`. In a multi-node deploy this is operator-enforced — there is no leader election.
- Two relevant env vars (read by `backend/src/config/env.js:194-198`):
  - `SCHEDULER_ENABLED` — `"true"` (default) registers cron timers on `start()`; `"false"` skips registration and logs `SCHEDULER_ENABLED=false — jobs not scheduled`.
  - `SCHEDULER_TIMEZONE` — IANA zone for cron evaluation. Falls back to `TZ`, then to literal `Asia/Jakarta`. The deployed `.env` already pins `TZ=Asia/Jakarta`.

## Procedures

### Procedure: Confirm scheduler is leader on this node

Two checks. Run both — env says it *should* be enabled, logs say it actually registered.

```bash
# 1. Env flag is set to true on this container.
docker exec interlab-api env | grep SCHEDULER_ENABLED
# Expect: SCHEDULER_ENABLED=true

# 2. Startup log shows the four jobs were registered.
docker logs interlab-api 2>&1 | grep '\[scheduler\]'
# Expect 4 lines like:
#   [scheduler] registered job=sla_technical_ready_to_deliver schedule='0 * * * *' tz=Asia/Jakarta
#   [scheduler] registered job=technical_po_due_reminder      schedule='0 8 * * *' tz=Asia/Jakarta
#   [scheduler] registered job=hrga_expiry_monitor            schedule='0 8 * * *' tz=Asia/Jakarta
#   [scheduler] registered job=tax_deadline_monitor           schedule='0 8 1 * *' tz=Asia/Jakarta
```

If the env says `true` but the registered lines are absent, the container was restarted with `SCHEDULER_ENABLED=false` and then changed without a restart, or the API process crashed before `start()` was reached. Restart the container and re-check.

If you see `[scheduler] SCHEDULER_ENABLED=false — jobs not scheduled` instead, this node is intentionally not the leader — find the node that is.

### Procedure: Manually fire a job

Use this for operator dry-runs (after a code change), backfills (after the scheduler was disabled or crashed), and one-off "rescan now" requests. `runOnce` goes through the same overlap guard and error capture as a scheduled tick, and every job is idempotent — repeat invocations are safe.

```bash
docker exec interlab-api node -e \
  "require('./src/jobs/scheduler').runOnce('<job_name>').then(r=>console.log(r))"
```

Valid job names (from `JOB_DEFINITIONS` in `backend/src/jobs/scheduler.js:37-70`):

- `sla_technical_ready_to_deliver`
- `technical_po_due_reminder`
- `hrga_expiry_monitor`
- `tax_deadline_monitor`

Returns `{name, lastRunAt, lastError}`. `lastError: null` means the run completed; a non-null string is the error message — re-read the container log around that timestamp for the stack trace, or re-run inside the REPL to capture the error directly (see failure mode below).

### Procedure: Disable the scheduler on a node

Use when running multiple replicas. Exactly one node should keep `SCHEDULER_ENABLED=true`; the rest must set it `false` so they do not double-fire reminders. Also useful when temporarily quieting the cron timers on the leader (e.g. to migrate data without spamming "expiring soon" notifications).

```bash
# 1. Edit the compose env on the node you want to silence.
#    docker-compose.demo.yml:32 currently sets:
#      SCHEDULER_ENABLED: "true"
#    Change it to:
#      SCHEDULER_ENABLED: "false"

# 2. Restart only the api service.
docker compose -f docker-compose.demo.yml up -d --force-recreate interlab-api

# 3. Verify.
docker logs interlab-api 2>&1 | grep '\[scheduler\] SCHEDULER_ENABLED=false'
# Expect: [scheduler] SCHEDULER_ENABLED=false — jobs not scheduled
```

The cron timers are not registered at all on a disabled node. `runOnce` still works because it materializes runtime state on the fly (`backend/src/jobs/scheduler.js:200-204`) — useful if you need to fire a one-off job from a non-leader node.

### Procedure: Inspect job status

`scheduler.status()` returns the in-memory state for every registered job — last run time, in-flight flag, last error. Use it after a job log line you can't fully interpret, or to confirm the most recent tick completed.

```bash
docker exec interlab-api node -e \
  "console.log(JSON.stringify(require('./src/jobs/scheduler').status(), null, 2))"
```

Output shape (one entry per registered job):

```json
[
  {
    "name": "sla_technical_ready_to_deliver",
    "in_flight": false,
    "last_run_at": "2026-04-27T03:00:00.142Z",
    "last_error": null
  }
]
```

Two caveats:

- The state is **per-process and in-memory**. Restarting the container resets every `last_run_at` to `null`. The "did this job actually run?" answer of record lives in the database (entity marker columns and `sla_tracking` rows — see [job idempotency](../backend/jobs.md#invariants)).
- On a node with `SCHEDULER_ENABLED=false`, `status()` returns `[]` until `runOnce` materializes a state row.

## Failure modes

### Failure: A job is logged as "skip: previous run still in flight"

```
[scheduler] warn job=hrga_expiry_monitor skip: previous run still in flight
```

The previous tick is still executing when the next one fires. The overlap guard (`backend/src/jobs/scheduler.js:103-106`) skips rather than queueing. One occurrence is benign (a single slow tick). Chronic occurrences mean the job's runtime exceeds its cron interval — for the hourly `sla_technical_ready_to_deliver` this is the most likely victim under data growth.

Recovery:

1. Run `scheduler.status()` (procedure above) — confirm the affected job has `in_flight: true` for an unreasonably long time.
2. Check the matching job's recent log lines — `docker logs interlab-api 2>&1 | grep 'job=<name>'` — and look at the `ok in <ms>ms` timing on its successful runs.
3. If the duration is creeping past the cadence, investigate query plans (`EXPLAIN ANALYZE` in `psql`) and data growth on the tables it scans (`installation_records` + `sparepart_records` for RTD; `hrga_legal_documents` for HRGA expiry; `tax_operational_records` for the tax monitor — see [job catalogue](../backend/jobs.md#job-catalogue)).
4. Stop-gap: increase the cron interval in `JOB_DEFINITIONS` (`backend/src/jobs/scheduler.js:37`) and redeploy. Real fix: index or query rewrite in the job module.

### Failure: Two nodes both have SCHEDULER_ENABLED=true

Symptom: duplicated `notifications` rows for the same SLA event, duplicated `email_queue` rows fired against the same recipient, recipients reporting two of every reminder.

The overlap guard is per-process. It does not coordinate across nodes — that is the contract `SCHEDULER_ENABLED` enforces. Two leaders means every cron tick fires twice; idempotency markers help (`sla_tracking` rows are keyed `(entity_type, entity_id, stage)`) but **the notification emit happens before the marker write in some jobs**, so duplicates can leak through.

Recovery:

1. `docker exec <each-node> env | grep SCHEDULER_ENABLED` on every API node — find all nodes set to `true`.
2. Pick one to keep as leader. Set the rest to `false` per [Disable the scheduler on a node](#procedure-disable-the-scheduler-on-a-node) and restart them.
3. For already-sent duplicate emails: nothing to undo. For duplicate dashboard notifications: a Superadmin can mark them read in bulk via the notifications panel.
4. Confirm with `docker logs ... | grep '\[scheduler\] registered'` on each node — only the leader should show `registered job=...` lines.

### Failure: Cron didn't fire at the expected time

The two daily jobs (`technical_po_due_reminder`, `hrga_expiry_monitor`) and the monthly `tax_deadline_monitor` run at `08:00` in the configured timezone. If a job log line never appears for a day it should have fired:

1. Check the env: `docker exec interlab-api env | grep -E '^TZ=|^SCHEDULER_TIMEZONE='`. The deployed default is `Asia/Jakarta`. If neither is set, node-cron falls back to the process default which Docker images often leave as UTC — the job *will* fire, just at `08:00 UTC` (`15:00 WIB`), which looks like "missed at 08:00 WIB".
2. Check the registered line in the startup log: `docker logs interlab-api 2>&1 | grep 'registered job=<name>'`. The trailing `tz=...` is the actual zone the timer was created with.
3. If the timezone is wrong, set `SCHEDULER_TIMEZONE=Asia/Jakarta` in compose env and restart. node-cron evaluates cron expressions in the configured zone, so changing it is a restart-only fix — running tasks are not retroactively rescheduled.
4. If the timezone is correct but the job still didn't fire, the API process may have been down at `08:00`. node-cron does not catch up on missed ticks while the process was off — fire the job manually with `runOnce`.

### Failure: Job error logged but unclear what

```
[scheduler] error job=tax_deadline_monitor failed Error: ...
```

The container log truncates long stacks and interleaves lines from concurrent requests. To capture the error cleanly, re-run the job in a Node REPL — `runOnce` returns the error message in its result and the full stack prints to stdout:

```bash
docker exec -it interlab-api node -e "
  require('./src/jobs/scheduler')
    .runOnce('tax_deadline_monitor')
    .then(r => console.log('result:', r))
    .catch(e => { console.error('threw:', e); process.exit(1); })
"
```

If the job is idempotent (all four are — see [job idempotency](../backend/jobs.md#invariants)), this is safe to repeat as many times as needed to reproduce. If the error is in a DB query, jump to the file referenced in the stack and read it against the current schema (`docker exec interlab-postgres psql -U interlab_user -d interlab_db -c '\d <table>'`).

## Reference

### Cron cheat sheet — the four registered jobs

All evaluated in `Asia/Jakarta`. Source: `backend/src/jobs/scheduler.js:37-70`.

| Job name | Cron | Reads as | Module |
|---|---|---|---|
| `sla_technical_ready_to_deliver` | `0 * * * *` | hourly on the hour | `backend/src/jobs/slaReadyToDeliver.job.js` |
| `technical_po_due_reminder` | `0 8 * * *` | daily 08:00 WIB | `backend/src/jobs/slaPoDueDate.job.js` |
| `hrga_expiry_monitor` | `0 8 * * *` | daily 08:00 WIB | `backend/src/jobs/slaHrgaExpiry.job.js` |
| `tax_deadline_monitor` | `0 8 1 * *` | 1st of each month 08:00 WIB | `backend/src/jobs/taxDeadlineMonitor.job.js` |

Cron field order: `minute hour day-of-month month day-of-week`. `*` matches every value. node-cron rejects malformed expressions at boot via `cron.validate` (`scheduler.js:152`) — a typo fails fast rather than silently skipping.

For *why* each schedule was chosen, the entity tables each job scans, and the notification templates fired, see [the job catalogue](../backend/jobs.md#job-catalogue). For idempotency mechanisms (which marker column or `sla_tracking` keys make `runOnce` safe to repeat), see [job invariants](../backend/jobs.md#invariants).

### Env vars

Read by `backend/src/config/env.js:194-198`.

| Var | Default | Purpose |
|---|---|---|
| `SCHEDULER_ENABLED` | `"true"` | `"false"` skips cron registration on this node. Use to designate a single leader in multi-node deploys. |
| `SCHEDULER_TIMEZONE` | `TZ` env, then `Asia/Jakarta` | IANA zone in which cron expressions are evaluated. |
| `TZ` | (set to `Asia/Jakarta` in deployed `.env`) | Process timezone. Acts as the fallback for `SCHEDULER_TIMEZONE` and is what `node-cron` reads if both are unset. |

### Public API of `scheduler.js`

| Export | Purpose | Used by |
|---|---|---|
| `start()` | Register and begin firing every job in `JOB_DEFINITIONS`. Re-entrant safe. Returns the registered job names. | API server boot |
| `stop()` | Stop every registered task. | Graceful shutdown, test harness |
| `runOnce(name)` | Fire a single job out-of-band. Goes through the overlap guard. Returns `{name, lastRunAt, lastError}`. | This runbook, integration tests |
| `status()` | Return `[{name, in_flight, last_run_at, last_error}]` for every registered job. | This runbook, future Superadmin debug endpoint |
| `listJobs()` | Return `[{name, schedule}]` without triggering anything. | Tests |
| `JOB_DEFINITIONS` | The frozen registry array. | Read-only inspection |

### Related runbooks

- [deployment.md](./deployment.md) — restart-looping container, redeploy after env change.
- [database.md](./database.md) — `psql` access for inspecting job side-effects.
- [incidents.md](./incidents.md) — synthesizes scheduler failures into wider incident response.

### Related dev docs

- [backend/jobs.md](../backend/jobs.md) — internals: wiring diagram, per-job dedupe mechanism, extension points, working-day math.
- [backend/notifications.md](../backend/notifications.md) — template enablement and recipient-group rules that gate every reminder a job fires.

<!--
drift-anchors:
- backend/src/jobs/scheduler.js
- backend/src/jobs/slaReadyToDeliver.job.js
- backend/src/jobs/slaPoDueDate.job.js
- backend/src/jobs/slaHrgaExpiry.job.js
- backend/src/jobs/taxDeadlineMonitor.job.js
- backend/src/config/env.js
- docker-compose.demo.yml
- docs/backend/jobs.md
- docs/backend/notifications.md
-->
