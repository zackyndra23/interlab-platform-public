# Interlab Infra — Access Guide

Operator reference for `vps-lafayette-01` (Singapore os-sgp2; Tailscale `100.117.214.25`, SSH `:2223`).
**No secrets here** — values live in `.env` (gitignored) / `/root/.coolify-secrets-backup.txt` (chmod 600) / Bitwarden.
Current state + deviations: [`DEPLOYMENT-LOG.md`](DEPLOYMENT-LOG.md). Verified 2026-05-25 (connectivity matrix all green).

## 1. Public services (HTTPS via manual Traefik)
| Service | URL | Purpose | Auth | Verify |
|---|---|---|---|---|
| CRM frontend | https://app.interlab-portal.com | Next.js webapp | app login (`Demo@22April2026!` seed) | `curl -I …` → 307 |
| CRM API + WS | https://api.interlab-portal.com (`/api/ws`) | Node/Express + WebSocket | JWT (app) | `curl -I …` → 404 at root (normal) |
| CRM S3 storage | https://s3-storage.interlab-portal.com | interlab-minio S3 | S3 keys | → 403 at root (normal) |
| CRM MinIO console | https://s3-minio.interlab-portal.com | interlab-minio console | user `interlab_minio`, pw `/home/zaky/data-stack/.env` | → 200 |
| Sibyl (6) | sibyl / www / dashboard / api / storage / s3-minio `.bisikan.app` | legacy tenant | per Sibyl | → 200/404/403 |
| Supabase | `supabase.interlab-portal.com` | **internal-only now** (public routing pending 1B cutover, deviation #12/#12a) | — | internal via kong |

## 2. Admin access (Tailscale-only — `100.117.214.25`)
| Service | URL | Auth (Bitwarden entry) | Verify |
|---|---|---|---|
| Coolify | http://100.117.214.25:8000 | "Coolify admin — interlab" | → 302 |
| Uptime Kuma | http://100.117.214.25:3001 | "Uptime Kuma admin — interlab" | → 302 |
| Netdata | http://100.117.214.25:19999 | none (Tailscale-gated; cloud disabled) | → 200 |
| Supabase Studio | via kong `127.0.0.1:8002/` (loopback) | basic-auth `supabase` / `/root`:`supabase_dashboard_password` | SSH-tunnel (§4); Tailscale-bind pending 1B |
| MinIO-global console | **http://100.117.214.25:9101** (Tailscale) | user `mgroot_8c8e8edb`, pw `/root`:`minio_global_root_password` | → 200 |
| SSH | `ssh zaky@100.117.214.25 -p 2223` (key) | break-glass: OVH KVM + Bitwarden "vps-lafayette-01 root — break-glass" | — |

> ⚠️ **Two independent MinIO servers** (deviation #8/#14): `minio-global` (shared/global, console above — username `mgroot_8c8e8edb`) vs `interlab-minio` (webapp project, §1 — username `interlab_minio`). Each console sees **only its own buckets**. MinIO admin user is the `MINIO_ROOT_USER` value, **never literally `root`**. Single-console "superadmin sees all + project-scoped SA" = **Phase 1.6-pt2 merge (post-demo, deviation #18)**.

## 3. Internal services (docker networks — no public/Tailscale port)
| Service | host:port | Network | Auth (key in `/root/.coolify-secrets-backup.txt`) |
|---|---|---|---|
| postgres-global | `postgres-global:5432` (net) + `127.0.0.1:5440` (host, admin/DBeaver #19) | interlab-global | `postgres_global_superuser_password`; app: `interlab_prod_app_password` / `interlab_staging_app_password` (+ `_owner_`) |
| minio-global S3 | `minio-global:9000` | interlab-global | `minio_global_root_*`; scoped SA `minio_storage_sa_*` |
| redis-global | `redis-global:6379` | interlab-global | `redis_global_password` (NEW; for future apps) |
| supabase-kong | `supabase-kong:8000` | interlab-global | apikey `supabase_anon_key` / `supabase_service_role_key` |
| supabase-auth/rest/storage/meta | `:9999`/`:3000`/`:5000`/`:8080` | interlab-global | JWT (`supabase_jwt_secret`); via kong |
| interlab-postgres | `postgres:5432` | interlab-data-net | webapp `.env` / mirror (`/home/zaky/data-stack/.env`) |
| interlab-redis | `redis:6379` | interlab-data-net | webapp redis pw |
| interlab-minio | `minio:9000` / `:9001` | interlab-data-net | webapp S3 keys |

**Verify (from a container on the net):**
`docker run --rm --network interlab-global -e PGPASSWORD=… --entrypoint psql supabase/postgres:15.8.1.085 -h postgres-global -U interlab_prod_app -d interlab_prod -tAc 'SELECT 1'`
`docker run --rm --network interlab-global redis:7.4-alpine redis-cli -h redis-global -a … ping`

## 4. SSH tunnels (office PC / laptop → internal services)
SSH endpoint: `zaky@100.117.214.25 -p 2223` (Tailscale — the client PC must be on the tailnet) + your SSH key.
**DBeaver/clients:** tunnel targets must resolve **server-side** → use `127.0.0.1:<host-port>`, **never** container names
(`postgres-global`, `redis-global`… don't resolve from the SSH host). In DBeaver's *SSH* tab use the endpoint above,
then *Main* tab host = `127.0.0.1`, port = the host-port below (DBeaver opens its own local forward).
```bash
# postgres-global (admin/superuser) — host port 127.0.0.1:5440 (deviation #19)
ssh -L 5440:127.0.0.1:5440 zaky@100.117.214.25 -p 2223   # DBeaver/psql host=127.0.0.1 port=5440 user=supabase_admin db=postgres|interlab_prod
# interlab-postgres (webapp data) — host port 127.0.0.1:5432
ssh -L 5433:127.0.0.1:5432 zaky@100.117.214.25 -p 2223   # host=127.0.0.1 port=5433 user=interlab_user db=interlab_db (pw=/home/zaky/data-stack/.env)
# minio-global console — bound to Tailscale 100.117.214.25:9101 (browse directly if on tailnet)
ssh -L 9101:100.117.214.25:9101 zaky@100.117.214.25 -p 2223   # browser http://127.0.0.1:9101
# Supabase Studio (via kong, loopback 127.0.0.1:8002)
ssh -L 8002:127.0.0.1:8002 zaky@100.117.214.25 -p 2223   # browser http://127.0.0.1:8002 (basic-auth)
# redis-global — INTERNAL only (no host port); tunnel via its container IP:
#   IP=$(docker inspect -f '{{.NetworkSettings.Networks.interlab-global.IPAddress}}' redis-global)
#   ssh -L 6379:$IP:6379 zaky@100.117.214.25 -p 2223   # redis-cli -h 127.0.0.1 -a <redis_global_password>
```
(SSH currently listens on all interfaces; Tailscale-only lockdown = Phase 1B.)

## 5. Monitoring & observability
- **Uptime Kuma** (`:3001`) — public+internal monitors (16 incl `redis-global` TCP 6379). **Netdata** (`:19999`) — host+container metrics, ~3d ring buffer, cloud disabled.
- **Logs:** `docker logs <container> --tail 100 -f`.
- **Deferred (Phase 1.5, deviation #11):** Telegram alerts · Sentry (app errors) · B2 off-site backup. Alerts currently in-app (Uptime Kuma) only.

## 6. Backup & recovery (detail: [`RECOVERY.md`](RECOVERY.md))
- **OVH snapshot** (manual via panel) + OVH automated daily (Standard tier). Latest baseline IDs in DEPLOYMENT-LOG.
- **Local dump scripts** `scripts/backup/*.sh` (B2 off-site push DEFERRED #11). Sandbox restore drill validated (1E).
- **Preservation dumps** `/var/backups/preservation/` (pre-Phase-1 demo+sibyl).
- **Rollback refs (untouched):** webapp `/opt/projects/interlabs-crm-demo`; data stack `/home/zaky/data-stack`.

## 7. Common operational tasks
```bash
# deploy/redeploy an app
cd apps/<name> && docker compose up -d --build
# deploy/redeploy an infra service
cd coolify-resources/<svc> && docker compose up -d        # (uses ./.env or /root .env)
docker logs <container> -f            # live logs
docker restart <container>            # restart
# emergency webapp rollback (pre-consolidation)
cd /opt/projects/interlabs-crm-demo && docker compose -f docker-compose.demo.yml up -d
# deviation history
grep -nE '^[0-9]+[a-z]?\. ' DEPLOYMENT-LOG.md     # the deviation list
```
