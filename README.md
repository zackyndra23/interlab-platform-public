# Interlab Global Infrastructure

Self-hosted shared infrastructure for **Interlab Sentra Solusi Indonesia** internal webapps,
on OVH `vps-lafayette-01` (Singapore os-sgp2). Foundational + reusable across apps.

> **Scope:** infrastructure **+ app integration** (expanded Phase 1.6, 2026-05-25). Apps live under `apps/<name>/`.
> **Operator access reference: [`docs/access-guide.md`](docs/access-guide.md).** Current state + every deviation (#1–#19): [`DEPLOYMENT-LOG.md`](DEPLOYMENT-LOG.md).

## What's live (Phase 1 + 1.6 complete, 2026-05-25)
- **Coolify** v4.1.0 (control plane; admin :8000 Tailscale-only). Its proxy NOT yet deployed — manual Traefik still serves ingress (cutover = Phase 1.5).
- **postgres-global** `supabase/postgres:15.8` — substrate roles/schemas + app dbs `interlab_prod`/`interlab_staging` (owner+app roles, pgvector) + WAL archiving.
- **minio-global** — S3 internal-only + scoped SA `supabase-storage-sa`.
- **redis-global** — `redis:7.4-alpine`, internal-only, for FUTURE apps (existing webapp keeps `interlab-redis`, deviation #17).
- **Supabase** (trimmed): kong · auth(gotrue) · rest(postgrest) · storage(→MinIO) · meta · studio — direct-to-postgres-global, internal (`http://supabase-kong:8000`).
- **Monitoring:** Uptime Kuma + Netdata (Tailscale-only, Netdata cloud disabled).
- **Apps:** `apps/interlabs-crm-demo/` (Next.js + Node/Express) — deployed direct-compose; data stack (postgres:16/redis/minio) kept isolated at `/home/zaky/data-stack`.

## Key decisions (override original plan — see DEPLOYMENT-LOG deviations)
- **Pilihan B (#1):** no SOPS. Secrets in `.env` (gitignored) + `.env.example` (committed) + `/root/.coolify-secrets-backup.txt` (chmod 600) + Bitwarden.
- **Mechanism B (#8):** infra + apps deployed via **direct `docker compose`** (not Coolify-managed yet). App-layer Coolify-management + Traefik cutover (#12) = Phase 1.5.
- **Sentry / Supavisor / off-site backup deferred** to Phase 1.5 (#9/#11).

## Repo layout
```
coolify-resources/   # infra service composes (postgres-global, minio-global, supabase, uptime-kuma, netdata)
apps/                # consolidated apps — apps/<name>/ {backend,frontend,docker-compose.yml,.env(ignored),.env.example}
system-config/       # sysctl, docker daemon.json, journald, THP, host-tuning README
scripts/             # backup/, recovery/, deploy/
docs/                # specs, plans, handover/
RECOVERY.md          # disaster recovery runbook
DEPLOYMENT-LOG.md    # full per-task execution log + deviations #1–#19
.env / .env.example  # centralized credentials (.env gitignored)
```

## Deploy
- **Infra service:** `cd coolify-resources/<svc> && sudo docker compose --env-file /root/coolify-resources/<svc>/.env up -d`
- **App:** `cd apps/<name> && docker compose up -d --build` (auto-loads `apps/<name>/.env`)

## Status
- [x] Phase 0 (prep/safety/tuning) · 1A core (Coolify + postgres-global + minio-global) · 1C Supabase · 1D monitoring · 1E verify+restore-drill
- [x] **Phase 1.6** — webapp consolidated into `apps/interlabs-crm-demo/` (Approach A, data stack kept)
- [ ] **Phase 1.5 / 1.6-pt2** (post-demo): 1B Traefik cutover + coolify-proxy · Supavisor · Sentry/Telegram/B2 off-site · data-stack deep integration · OS 26.04 LTS reinstall (≤ 2026-09-30)
