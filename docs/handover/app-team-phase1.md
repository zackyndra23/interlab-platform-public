# Interlab Infra — App-Team Handover (Phase 1)

**Date:** 2026-05-25 · **Server:** `vps-lafayette-01` (Tailscale `100.117.214.25`, Singapore os-sgp2)
**Status:** Phase 1 foundation live (postgres-global + minio-global + Supabase + monitoring). Deploy your webapp against these.

> **Secrets:** all credential VALUES live in the repo `.env` (gitignored) + `/root/.coolify-secrets-backup.txt` (chmod 600) + Bitwarden. Key names are in `.env.example`. No SOPS (Pilihan B). Never commit `.env`.

## 1. Database (PostgreSQL 15 — direct, NOT Supavisor)
> Supavisor pooling deferred to Phase 1.5 (deviation #9) — connect **direct to `postgres-global:5432`**. Migration later = just change host/port; no app rework.

- **From a Coolify-deployed app** (attach it to the `interlab-global` docker network):
  ```
  host=postgres-global port=5432 dbname=interlab_prod  user=interlab_prod_app  password=<.env: interlab_prod_app_password>
  ```
  Staging: `dbname=interlab_staging user=interlab_staging_app password=<.env: interlab_staging_app_password>`.
- **Roles per env:** `*_owner` (migrations/DDL) · `*_app` (runtime DML, USAGE-only on public, least-privilege). `pgvector 0.8.0` available in both dbs.
- Substrate db `postgres` holds Supabase's `auth`/`storage` schemas — don't put app tables there.
- No public/Tailscale port on postgres yet; dev access = via a Coolify app on `interlab-global` (or request a Tailscale-bound port).

## 2. Supabase (BaaS) — internal only (public routing = Phase 1.5, deviation #12a)
- **Gateway (Kong):** `http://supabase-kong:8000` from any container on `interlab-global`. (No public `supabase.interlab-portal.com` yet — rides along with the 1B Traefik cutover in 1.5.)
- **Keys** (`.env`): `supabase_anon_key` (client), `supabase_service_role_key` (server-only, full access — never ship to browser), `supabase_jwt_secret`.
- **Auth (GoTrue):** `…:8000/auth/v1/*` — email signup enabled, autoconfirm ON (dev). **REST (PostgREST):** `…/rest/v1/*` (schemas: public, storage, graphql_public). **Studio:** `http://100.117.214.25:3001`-style Tailscale-only + kong basic-auth (`supabase` / `.env: supabase_dashboard_password`).

## 3. Storage (Supabase Storage API → MinIO backend)
- Access **via Supabase Storage API** (`…:8000/storage/v1/*`), **NOT** MinIO directly (S3 `:9000` is internal-only, scoped SA).
- Logical bucket naming: `<app>-<env>-<purpose>` (e.g. `interlab-prod-documents`). Default **private**; public opt-in + justify.
- Backed by the physical `supabase-storage` bucket in minio-global (verified upload→retrieve round-trip).

## 4. The webapp (interlabs-crm-demo) — consolidated + live (Phase 1.6)
Now in **`apps/interlabs-crm-demo/`** in THIS repo, deployed **direct-compose (A2-Direct)**:
- **Redeploy/develop:** edit `apps/interlabs-crm-demo/{backend,frontend}` → `cd apps/interlabs-crm-demo && docker compose up -d --build`.
- **Routing:** manual Traefik labels → `app.` / `api.interlab-portal.com` (service names `interlab-api`/`interlab-app` preserved).
- **Data (Approach A):** its OWN isolated stack (postgres:16/redis/minio at `/home/zaky/data-stack`) — NOT postgres-global/Supabase yet (deep integration = deviation #14, Phase 1.6-pt2). Connects via `interlab-data-net` (`postgres:5432`/`redis:6379`/`minio:9000`).
- **Env:** `apps/interlabs-crm-demo/.env` (gitignored; keys in `.env.example`); DB pw via `${DATABASE_URL}`.
- **Future Coolify-managed app** (spec model, post-1B + coolify-proxy): create as a Coolify resource on `interlab-global`, inject env in Coolify UI, route via Coolify Traefik.

## 5. Deferred to Phase 1.5 (carry-over — full context in DEPLOYMENT-LOG deviations)
| # | Item |
|---|---|
| 1 | SOPS → Pilihan B (Coolify-native env / `.env`) |
| 2 | apt mirror = nova.clouds.archive (no EOL repoint yet) |
| 3 | NOPASSWD sudo for `zaky` |
| 4 | Snapshot gate placeholder discovery (process lesson) |
| 5 | root pw was LOCKED → set (break-glass) |
| 6 | Phone Tailscale SSH (iPhone offline) — verify pre-1B |
| 7 | Coolify install overwrote daemon.json + restarted dockerd (live-restore re-armed) |
| 8 | postgres-global + minio-global = direct compose (hybrid; app layer stays Coolify-managed) |
| 9 | **Supavisor deferred** (app connects direct postgres:5432) |
| 10 | Supabase service-role passwords set as supabase_admin (`service-role-passwords.sql`) |
| 11 | **Sentry + Telegram + B2/offsite-backup deferred** (external creds) |
| 12 | **1B Traefik cutover deferred** (coolify-proxy never deployed; do when first Coolify app ships) |
| 12a | `supabase.interlab-portal.com` public routing rides along → 1.5 |

## 6. Ops
- **Monitoring:** Uptime Kuma `http://100.117.214.25:3001`, Netdata `http://100.117.214.25:19999` (both Tailscale-only).
- **Backups:** scripts in `scripts/backup/` (ready; B2/off-site activation = 1.5). Local dump/restore validated (sandbox drill). **No off-site backup active yet** — treat data as single-site until 1.5.
- **Sentry:** DEFERRED (1.5). Add DSN when the cloud project exists.
