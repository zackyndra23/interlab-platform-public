# data-stack-reference — REFERENCE IaC ONLY (DO NOT deploy from here)

Documentation/reference for the demo's data stack. **The actual running deploy lives at
`/home/zaky/data-stack/` — do NOT `docker compose up` from this directory.**

## Why reference-only (Phase 1.6 — deviations #14/#16)
Moving the data-stack *deploy* into the infra repo means stopping postgres/redis/minio and
reattaching the volumes (`data-stack_{postgres,redis,minio}_data`). That's a volume-reattach
operation we deferred to avoid endangering the **live demo data the night before the demo**
(2026-05-26 19:00). Approach A keeps the data stack **untouched + isolated**.

## What's here
- `docker-compose.yml` — copy of `/home/zaky/data-stack/docker-compose.yml`
  (postgres:16 `interlab-postgres`, redis:7 `interlab-redis`, minio `interlab-minio`;
  serves `s3-minio` + `s3-storage.interlab-portal.com`).
- `.env.example` — key template (real `.env` stays at `/home/zaky/data-stack/.env`).

## Data baseline (captured 2026-05-25, pre-consolidation)
postgres `interlab_db`: 65 public tables — users=8, roles=8, role_permissions=245,
activity_logs=119, user_sessions=55, schema_migrations=29, app_settings=21.

## Migration path (Phase 1.6-part-2, post-demo)
1. Fresh OVH snapshot first.
2. In this compose, declare volumes `external: true` referencing the existing
   `data-stack_{postgres,redis,minio}_data`.
3. `cd /home/zaky/data-stack && docker compose down` (stops containers; volumes KEPT — never `-v`).
4. `cd apps/interlabs-crm-demo/data-stack-reference && docker compose up -d` (reattaches same volumes).
5. Verify row counts match the baseline above → then decommission `/home/zaky/data-stack/`.
