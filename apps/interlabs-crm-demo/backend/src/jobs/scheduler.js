'use strict';

const cron = require('node-cron');

const env = require('../config/env');
const slaReadyToDeliver = require('./slaReadyToDeliver.job');
const slaPoDueDate = require('./slaPoDueDate.job');
const slaHrgaExpiry = require('./slaHrgaExpiry.job');
const taxDeadlineMonitor = require('./taxDeadlineMonitor.job');
const dispatchWorker = require('../services/notification_dispatch.worker');

// Background job scheduler.
//
// Wires the four existing job modules onto cron triggers per
// CTX_architecture.txt §BACKGROUND JOB SCHEDULE and IMPL_backend.txt §B7.
// Every job module exposes an async run() that is idempotent and
// transaction-scoped; this module only handles cadence and overlap.
//
// Cron expressions are evaluated in env.scheduler.timezone (default
// Asia/Jakarta — the business locale). That way "daily at 08:00" means
// 08:00 WIB regardless of where the process runs.
//
// Overlap prevention: a single runtime lock per job prevents a second
// tick from starting while the previous run is still in flight. This
// matters for the SPT / HRGA scans whose worst-case runtime could exceed
// their cron interval under load. It does NOT protect against two
// scheduler *instances* racing — that concern is addressed via the
// SCHEDULER_ENABLED env flag (only one node should have it enabled).

// ---------------------------------------------------------------------------
// JOB REGISTRY
// ---------------------------------------------------------------------------
//
// Job naming convention: the `name` is the stable identifier used in log
// lines and operator tooling (e.g. `runJob <name>`). Keep it snake_case
// so it is easy to grep in logs.

const JOB_DEFINITIONS = Object.freeze([
    {
        name: 'sla_technical_ready_to_deliver',
        // Every hour on the hour — CTX_architecture §BACKGROUND JOB SCHEDULE.
        // Scans installation_records + sparepart_records with
        // ready_to_deliver='Yes' and admin_log_response_status='pending'
        // for >2 working days and escalates to Admin & Log.
        schedule: '0 * * * *',
        run: () => slaReadyToDeliver.run(),
    },
    {
        name: 'technical_po_due_reminder',
        // Daily at 08:00 — CTX_architecture §BACKGROUND JOB SCHEDULE.
        // Flags technical_job_orders with po_due_date within 30 days and
        // fires technical.po.due_date_reminder to the assigned engineer.
        schedule: '0 8 * * *',
        run: () => slaPoDueDate.run(),
    },
    {
        name: 'hrga_expiry_monitor',
        // Daily at 08:00 — MOD_hrga.txt §COMPLIANCE & EXPIRY MONITORING.
        // Tiers: expired → expiring_soon_30 → expiring_soon_90.
        schedule: '0 8 * * *',
        run: () => slaHrgaExpiry.run(),
    },
    {
        name: 'tax_deadline_monitor',
        // First of each month at 08:00 — MOD_tax_insurance.txt §TAX
        // BACKGROUND JOB. Three rules: missing required record, unpaid
        // closed Masa Pajak, SPT not filed.
        schedule: '0 8 1 * *',
        run: () => taxDeadlineMonitor.run(),
    },
]);

// Exposed so ops/tests can inspect the registry without triggering cron.
function listJobs() {
    return JOB_DEFINITIONS.map(({ name, schedule }) => ({ name, schedule }));
}

// ---------------------------------------------------------------------------
// RUNTIME STATE
// ---------------------------------------------------------------------------

// name → { task, inFlight, lastRunAt, lastError }
const tasks = new Map();

// setInterval handle for the 30s dispatch worker (sub-minute, so node-cron
// cannot express it — managed separately from the cron task registry).
let dispatchInterval = null;

function log(level, jobName, message, extra) {
    const line = `[scheduler] ${level} job=${jobName} ${message}`;
    if (extra !== undefined) {
        // eslint-disable-next-line no-console
        console[level === 'error' ? 'error' : 'log'](line, extra);
    } else {
        // eslint-disable-next-line no-console
        console[level === 'error' ? 'error' : 'log'](line);
    }
}

// Wrap the job's async run() so a tick:
//   1. skips when the previous run is still in flight (overlap guard);
//   2. captures duration + error info for basic observability;
//   3. never throws into node-cron (uncaught errors would crash the timer).
async function executeGuarded(definition) {
    const state = tasks.get(definition.name);
    if (!state) return;

    if (state.inFlight) {
        log('warn', definition.name, 'skip: previous run still in flight');
        return;
    }
    state.inFlight = true;
    const startedAt = Date.now();
    try {
        const result = await definition.run();
        state.lastRunAt = new Date();
        state.lastError = null;
        const durationMs = Date.now() - startedAt;
        log('info', definition.name,
            `ok in ${durationMs}ms`, result || {});
    } catch (err) {
        state.lastRunAt = new Date();
        state.lastError = err;
        log('error', definition.name, 'failed', err);
    } finally {
        state.inFlight = false;
    }
}

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

/**
 * Register every job with node-cron and begin firing according to schedule.
 * Returns an array of the job names that were started. When
 * `env.scheduler.enabled` is false, nothing is scheduled — logged once so
 * operators know why the timers are quiet.
 *
 * Safe to call more than once: re-invocations are ignored so a unit test
 * or a supervisor that restarts the HTTP server doesn't double-schedule.
 */
function start() {
    if (!env.scheduler.enabled) {
        // eslint-disable-next-line no-console
        console.log('[scheduler] SCHEDULER_ENABLED=false — jobs not scheduled');
        return [];
    }
    if (tasks.size > 0) {
        // eslint-disable-next-line no-console
        console.log('[scheduler] already started — start() is a no-op');
        return [...tasks.keys()];
    }

    const tz = env.scheduler.timezone;
    for (const def of JOB_DEFINITIONS) {
        if (!cron.validate(def.schedule)) {
            throw new Error(
                `[scheduler] invalid cron expression '${def.schedule}' for job '${def.name}'`,
            );
        }
        const task = cron.schedule(def.schedule, () => executeGuarded(def), {
            scheduled: true,
            timezone: tz,
        });
        tasks.set(def.name, {
            task,
            inFlight: false,
            lastRunAt: null,
            lastError: null,
        });
        // eslint-disable-next-line no-console
        console.log(
            `[scheduler] registered job=${def.name} schedule='${def.schedule}' tz=${tz}`,
        );
    }

    // Notification dispatch — every 30 seconds via setInterval.
    // node-cron v3 does not support sub-minute intervals, so we use
    // setInterval. The handle is .unref()'d so it doesn't prevent clean exit.
    if (!dispatchInterval) {
        let dispatchInFlight = false;
        dispatchInterval = setInterval(async () => {
            if (dispatchInFlight) return;
            dispatchInFlight = true;
            try {
                await dispatchWorker.tick();
            } catch (err) {
                // eslint-disable-next-line no-console
                console.error('[scheduler] notification_dispatch tick failed', err.message);
            } finally {
                dispatchInFlight = false;
            }
        }, 30_000);
        dispatchInterval.unref();
        // eslint-disable-next-line no-console
        console.log('[scheduler] registered notification_dispatch interval=30s');
    }

    return [...tasks.keys()];
}

/**
 * Stop every registered job. Used by test harnesses and graceful shutdown.
 */
function stop() {
    for (const [, state] of tasks) {
        if (state.task && typeof state.task.stop === 'function') {
            state.task.stop();
        }
    }
    tasks.clear();
    if (dispatchInterval) {
        clearInterval(dispatchInterval);
        dispatchInterval = null;
    }
}

/**
 * Run a single job by name out-of-band. Useful for operator dry-runs
 * (`node -e "require('./src/jobs/scheduler').runOnce('hrga_expiry_monitor')"`)
 * and integration tests. Bypasses the cron trigger but still goes through
 * the same overlap guard + error capture as a scheduled tick.
 */
async function runOnce(name) {
    const def = JOB_DEFINITIONS.find((d) => d.name === name);
    if (!def) throw new Error(`[scheduler] unknown job '${name}'`);

    // If the job has never been registered via start(), materialize its
    // runtime state on the fly so executeGuarded's inFlight bookkeeping
    // still works.
    if (!tasks.has(name)) {
        tasks.set(name, {
            task: null, inFlight: false, lastRunAt: null, lastError: null,
        });
    }
    await executeGuarded(def);
    const state = tasks.get(name);
    return {
        name,
        lastRunAt: state.lastRunAt,
        lastError: state.lastError ? state.lastError.message : null,
    };
}

function status() {
    return [...tasks.entries()].map(([name, state]) => ({
        name,
        in_flight: state.inFlight,
        last_run_at: state.lastRunAt,
        last_error: state.lastError ? state.lastError.message : null,
    }));
}

module.exports = {
    start,
    stop,
    runOnce,
    status,
    listJobs,
    JOB_DEFINITIONS,
};
