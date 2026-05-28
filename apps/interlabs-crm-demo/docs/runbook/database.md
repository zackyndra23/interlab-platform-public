---
audience: operator
reading_time: 8 min
last_reviewed: 2026-04-27
---

# Database runbook

## Purpose

How to manage the Postgres database for the Interlabs CRM demo: applying migrations, seeding demo data, connecting directly with `psql`, inspecting migration state, and recovering from migration / seed failures. The schema is owned by `backend/migrations/*.sql`; the runner is `backend/scripts/migrate.js`; the demo data loader is `backend/scripts/seed.js`.

For "what the schema looks like" see [`../backend/architecture.md`](../backend/architecture.md). This file is operator-only — no architectural prose.

---

## Prerequisites

- The `interlab-postgres` container is running and reachable on the `interlab-data-net` Docker network. Confirm with:

  ```bash
  docker ps --filter name=interlab-postgres --format '{{.Names}}\t{{.Status}}'
  docker network inspect interlab-data-net --format '{{range .Containers}}{{.Name}} {{end}}'
  ```

  Both `interlab-postgres` and `interlab-api` must appear in the network membership list.

- `DATABASE_URL` is set in the repo-root `.env` (loaded by `docker-compose.demo.yml`). The runner reads it from `process.env.DATABASE_URL` and exits non-zero if missing (`migrate.js:29-32`, `seed.js:117`, `wait-for-postgres.js:10-13`). Do not paste values from `.env` into this doc or into chat logs.

- The `interlab-api` container is running (procedures shell into it to invoke the migration / seed scripts). If the API container is restart-looping because of a migration error, see the failure modes below — fix the migration on disk first, then redeploy.

- Database superuser / app-user credentials live only in the repo-root `.env`. The demo app role is `interlab_user` against database `interlab_db`. The Postgres hostname **inside `interlab-data-net`** is `postgres` (the compose network alias), not `interlab-postgres` (the container name) — both resolve, but DSNs in `.env` use `postgres`.

- For GUI inspection from an operator workstation, the VPS publishes Postgres
  only on loopback: `127.0.0.1:5432 -> interlab-postgres:5432`. Do not expose
  Postgres on `0.0.0.0`; use an SSH tunnel to the VPS instead. The SSH daemon
  listens on port `2223`.

---

## Procedures

### Procedure: Apply pending migrations

The backend entrypoint runs `wait-for-postgres → migrate → seed` automatically on every container start, so a normal `docker compose up -d` already applies any new migration files. To run it manually (e.g. after copying a new migration file in without restarting):

```bash
docker exec interlab-api node scripts/migrate.js
```

Expected output is one line per file, either `[migrate] skip <file>` or `[migrate] apply <file>`, followed by `[migrate] done`. The runner walks `backend/migrations/` sorted by filename, skips any row already in `schema_migrations`, applies the `-- +migrate Up` block, and then inserts the filename into `schema_migrations` (`migrate.js:42-72`). Any failure exits non-zero and aborts the container start.

### Procedure: Add a new migration

1. **Choose the next number.** Filenames are `NNN_short_name.sql`, three-digit zero-padded, applied in `sort` order (`migrate.js:42-44`). The current highest is `016_app_settings_and_email_queue.sql`, so the next is `017_*.sql`. Never renumber an existing file once it has been applied anywhere.

2. **Use the required Up/Down envelope.** The runner only executes the section between `-- +migrate Up` and `-- +migrate Down`. Both markers are mandatory (`migrate.js:19-25`):

   ```sql
   -- ============================================================================
   -- Migration 017: <one-line purpose>
   -- ============================================================================

   -- +migrate Up
   BEGIN;
   CREATE TABLE IF NOT EXISTS my_table (
       id          uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
       created_at  timestamptz  NOT NULL DEFAULT now()
   );
   COMMIT;

   -- +migrate Down
   BEGIN;
   DROP TABLE IF EXISTS my_table;
   COMMIT;
   ```

   The Down block is **not** executed by the runner — it exists as documentation for manual rollback. There is no `migrate.js down` command.

3. **DDL must be idempotent where possible.** Use `CREATE TABLE IF NOT EXISTS`, `CREATE INDEX IF NOT EXISTS`, `ADD COLUMN IF NOT EXISTS`. Reason: if the Up block partially succeeds and crashes before the `INSERT INTO schema_migrations` line (`migrate.js:61-64`), the file will be re-run on the next container start. Idempotent DDL keeps the retry safe; non-idempotent statements (`CREATE TYPE` without guard, `INSERT` without `ON CONFLICT`) require manual cleanup before retry.

4. **Commit the file without running it.** Just add it under `backend/migrations/`, commit, and let the next deploy apply it via the entrypoint. Do **not** apply it on the running container before the deploy — that creates drift between the image and the live database.

5. **Verify shape before deploy.** Quick local check:

   ```bash
   grep -q '^-- +migrate Up' backend/migrations/017_*.sql || echo "MISSING Up MARKER"
   grep -q '^-- +migrate Down' backend/migrations/017_*.sql || echo "MISSING Down MARKER"
   ```

### Procedure: Connect to Postgres directly

```bash
docker exec -it interlab-postgres psql -U interlab_user -d interlab_db
```

Read-only inspection from outside the container, piping a single statement:

```bash
docker exec interlab-postgres psql -U interlab_user -d interlab_db \
    -c 'SELECT count(*) FROM users;'
```

For ad-hoc SQL files, copy in then run:

```bash
docker cp ./query.sql interlab-postgres:/tmp/query.sql
docker exec interlab-postgres psql -U interlab_user -d interlab_db -f /tmp/query.sql
```

### Procedure: Connect with DBeaver over SSH tunnel

Use this for read-only monitoring or ad-hoc inspection from a laptop. The
database stays private because DBeaver reaches it through SSH and Postgres is
bound only to `127.0.0.1` on the VPS.

In DBeaver, create a PostgreSQL connection:

```text
Host: 127.0.0.1
Port: 5432
Database: interlab_db
Username: interlab_user
Password: <POSTGRES_PASSWORD from repo-root .env>
```

Open the SSH tab and enable the tunnel:

```text
SSH Host: 51.79.146.14
SSH Port: 2223
User: zaky
Authentication: Public Key
Private key: <operator private key, not the .pub file>
Passphrase: <key passphrase, if the key is encrypted>
```

If DBeaver has explicit tunnel destination fields, set:

```text
Remote host: 127.0.0.1
Remote port: 5432
```

If DBeaver has trouble decrypting the key, verify the same key outside DBeaver
first:

```bash
ssh -p 2223 -i ~/.ssh/id_ed25519 zaky@51.79.146.14
```

As a fallback, create the SSH tunnel manually and connect DBeaver without its
SSH tab:

```bash
ssh -p 2223 -L 5433:127.0.0.1:5432 zaky@51.79.146.14
```

Then use `localhost:5433` as the DBeaver host/port.

### Procedure: Re-seed demo data

```bash
docker exec interlab-api node scripts/seed.js
```

The seed is fully idempotent for the RBAC registry — features, capabilities, roles, and `role_permissions` rows all use `ON CONFLICT DO NOTHING` (`seed.js:121-169`). Demo users use `ON CONFLICT (email) DO UPDATE` and will overwrite `password_hash`, `role`, `display_name`, and reactivate (`account_status='active'`, `deleted_at=NULL`) on every run (`seed.js:198-211`). If you have changed any of those fields by hand on a demo user, re-seeding will revert your change. The script logs `[seed] demo password: <value>` on success — that value is read from `DEMO_PASSWORD` env (default `Demo@2025!`, `seed.js:20`).

### Procedure: Inspect schema_migrations

```sql
SELECT filename, applied_at
  FROM schema_migrations
 ORDER BY applied_at DESC;
```

Expected: one row per file under `backend/migrations/`, ordered by when it was first applied. A file present on disk but **missing** from this table will be applied on the next migrate run; a row present here but **missing** on disk is harmless (the runner only loops over disk files).

To see how many migrations are pending without applying them:

```bash
docker exec interlab-api sh -c '
  ls /app/migrations/*.sql | xargs -n1 basename | sort > /tmp/disk.txt
  psql "$DATABASE_URL" -At -c "SELECT filename FROM schema_migrations ORDER BY filename" > /tmp/db.txt
  comm -23 /tmp/disk.txt /tmp/db.txt
'
```

Output lists pending filenames; empty output means fully applied.

---

## Failure modes

### Failure: migration script syntax error

**Detection:** Backend container logs show `[migrate] FAILED <file>: <pg error>` (`migrate.js:65-69`). The runner exits with code 1, the entrypoint aborts, and the container restart-loops. `docker ps` shows `interlab-api` cycling through `Restarting (1)`.

**Recovery:**

1. Read the exact error: `docker logs interlab-api --tail 50`.
2. Fix the offending SQL on disk (`backend/migrations/<file>.sql`).
3. If the failure happened **before** `INSERT INTO schema_migrations` ran (the common case — the SQL itself errored), no DB cleanup is needed. The runner will retry on the next start.
4. If the failure happened **after** partial DDL succeeded but before the row was inserted, see the next failure mode for cleanup.
5. Redeploy: `docker compose -f docker-compose.demo.yml up -d --build`.

### Failure: schema_migrations row written but Up SQL failed mid-way

**Background:** The runner does **not** wrap each migration in a Postgres transaction itself — it executes a single `client.query(sqlUp)` (`migrate.js:60`) and only inserts into `schema_migrations` if that query resolved (`migrate.js:61-64`). If the migration file contains its own `BEGIN;` / `COMMIT;` (every existing one does), the file's own transaction protects most cases: a failure rolls back the whole Up block, the `INSERT` never runs, and the next start retries cleanly.

The risk window is a migration file authored **without** an explicit `BEGIN;` / `COMMIT;`, or one whose Up block contains statements Postgres cannot run inside a transaction (e.g. `CREATE INDEX CONCURRENTLY`, `ALTER SYSTEM`). In that case `client.query(sqlUp)` may apply some statements and fail on a later one — leaving the schema half-applied with no `schema_migrations` row.

**Detection:**

- Logs show `[migrate] FAILED <file>` but `psql ... -c '\dt'` shows tables / columns from that file already present.
- Re-running migrate fails again on the same statement (idempotent DDL would have masked the half-apply, so this signals the file is not safe to re-run).

**Recovery (manual):**

1. Connect: `docker exec -it interlab-postgres psql -U interlab_user -d interlab_db`.
2. Inspect what was applied. Compare the file's Up block against `\d` output for each table it touches.
3. Two options:
   - **Forward:** finish the Up block by hand (run only the un-applied statements), then `INSERT INTO schema_migrations (filename) VALUES ('<file>');`. Use this when the migration is non-trivial to undo.
   - **Backward:** run the file's Down block by hand to reach a clean slate, fix the file, then let the runner apply it normally on the next start. Use this when undo is straightforward.
4. Restart the API container and confirm migrate now logs `[migrate] skip <file>` for the repaired migration.

**Prevention:** every new migration must wrap its Up block in `BEGIN;` / `COMMIT;` and avoid statements that cannot run inside a transaction. If you genuinely need `CREATE INDEX CONCURRENTLY`, split it into its own migration file and accept the half-apply risk — document the manual recovery in the file header.

### Failure: seed.js fails after migration succeeds

**Background:** The backend entrypoint runs migrate **then** seed in the same shell. A failed seed exits non-zero and the entrypoint aborts the container start (same restart-loop symptom as a failed migrate). Typical causes: schema drift (a column the seed writes was renamed without updating `seed.js`), a unique-constraint violation on a hand-edited demo row that breaks the `ON CONFLICT` target, or a Postgres connection drop mid-seed.

**Detection:**

```bash
docker logs interlab-api --tail 100 | grep -E '^\[seed\]'
```

A successful run ends in `[seed] done`. A failure ends in `[seed] fatal <error>` (`seed.js:218-221`). Migrations will already have logged `[migrate] done` before the seed error appears.

**Recovery:**

1. Read the error message — it names the failing INSERT or constraint.
2. If it's a schema drift, fix `backend/scripts/seed.js` to match the current migration shape and rebuild the image.
3. If it's a hand-edited row blocking the upsert, fix the row in psql (e.g. `UPDATE users SET email = '<original>' WHERE id = '...';`) so the `ON CONFLICT (email)` target lines up again.
4. Redeploy. Migrations will log `skip` for everything; seed will retry.

If you need to start the API without running the seed (rare — used to investigate the failure live), shell into the container with the entrypoint overridden:

```bash
docker run --rm -it --network interlab-data-net \
    --env-file .env \
    --entrypoint sh interlab-api:demo
```

From inside, run `node scripts/migrate.js` and `node scripts/seed.js` independently.

---

## Reference

### `schema_migrations` table

Created on first run by `migrate.js:35-40`:

```sql
CREATE TABLE IF NOT EXISTS schema_migrations (
    filename   text         PRIMARY KEY,
    applied_at timestamptz  NOT NULL DEFAULT now()
);
```

One row per applied file. `filename` is the bare basename (e.g. `001_users_and_sessions.sql`), not the full path. There is no `checksum`, `version`, or `dirty` column — the table is intentionally minimal and the runner trusts disk content.

### Migration files

| File | Purpose |
| ---- | ------- |
| `001_users_and_sessions.sql` | `users`, `user_sessions`, `user_preferences`; enables `pgcrypto` and `pg_trgm` extensions. |
| `002_rbac.sql` | `feature_definitions`, `capability_definitions`, `roles`, `role_permissions`, `role_menu_visibility`, `user_role_scope`; closes `users.role -> roles.role_key` FK. |
| `003_purchase_orders.sql` | `purchase_orders` (master 11-stage lifecycle), `purchase_order_status_history`, `purchase_order_tracking_events`. |
| `004_customers.sql` | `customers`; closes the forward FK from `purchase_orders.customer_id`. |
| `005_sales_forms.sql` | `sales_forecasts`, `quotations`, `harga_pokok_penjualan`, `sales_purchase_orders`, `purchase_requests_sales`. |
| `006_admin_log_forms.sql` | `awb_records` + history, `delivery_orders` + history, `admin_operational_records`. |
| `007_finance_forms.sql` | `po_customer_records`, `purchase_requisitions`, `invoice_manufactures`, `invoice_customers`. |
| `008_technical_forms.sql` | `technical_job_orders`, `installation_records`, `pm_records`, `sparepart_records`, `inspection_qc_records`, `bast_records`; closes `invoice_customers.related_bast_id` FK. |
| `009_hrga_forms.sql` | `hrga_legal_documents`, `letter_templates`, `company_letters`, `hrga_archive_records`; FTS tsvector columns + Smart Search trigger. |
| `010_tax_insurance.sql` | `tax_operational_records`, `tax_operational_audit_log`. |
| `011_notifications_and_chat.sql` | `notifications`, `notification_templates`, `notification_logs`, `chat_channels`, `chat_topics`, `chat_messages`, `chat_channel_members`, `chat_message_reads`. |
| `012_file_attachments.sql` | `file_attachments`; closes forward FKs from `purchase_orders.overdue_attachment_id` and `sales_purchase_orders.overdue_attachment_id`. |
| `013_sla_and_workflow.sql` | `sla_tracking`, `workflow_step_history`, `todo_items`. |
| `014_indexes.sql` | All performance indexes called out in `IMPL_backend.txt` Phase B2 (FK indexes, status filters, SLA scans, GIN trigram on `customers.company_name`). |
| `015_activity_logs.sql` | `activity_logs` audit trail with denormalized `user_email`/`user_role` for post-deletion readability. |
| `016_app_settings_and_email_queue.sql` | `app_settings` (JSONB key/value), `email_queue` outbox; seeds default general + email settings. |

### Files consulted while writing this runbook

- `backend/scripts/migrate.js` — runner contract.
- `backend/scripts/wait-for-postgres.js` — DB readiness probe used by the entrypoint before migrate.
- `backend/scripts/seed.js` — RBAC registry + demo user upsert.
- `backend/migrations/*.sql` — every file, for the table above.
- `docker-compose.demo.yml` — container names, network alias, DSN shape.

### Container names and DSN

| Item | Value |
| ---- | ----- |
| API container | `interlab-api` |
| Postgres container | `interlab-postgres` |
| Postgres network alias (used in `DATABASE_URL`) | `postgres` |
| Network | `interlab-data-net` |
| App role / database | `interlab_user` / `interlab_db` |

Cross-link: see [`../backend/architecture.md`](../backend/architecture.md) for the layered runtime that consumes this schema, and [`./deployment.md`](./deployment.md) for the surrounding entrypoint sequence.

<!-- drift-anchors:
  backend/scripts/migrate.js
  backend/scripts/wait-for-postgres.js
  backend/scripts/seed.js
  backend/migrations/001_users_and_sessions.sql
  backend/migrations/002_rbac.sql
  backend/migrations/003_purchase_orders.sql
  backend/migrations/004_customers.sql
  backend/migrations/005_sales_forms.sql
  backend/migrations/006_admin_log_forms.sql
  backend/migrations/007_finance_forms.sql
  backend/migrations/008_technical_forms.sql
  backend/migrations/009_hrga_forms.sql
  backend/migrations/010_tax_insurance.sql
  backend/migrations/011_notifications_and_chat.sql
  backend/migrations/012_file_attachments.sql
  backend/migrations/013_sla_and_workflow.sql
  backend/migrations/014_indexes.sql
  backend/migrations/015_activity_logs.sql
  backend/migrations/016_app_settings_and_email_queue.sql
  docker-compose.demo.yml
-->
