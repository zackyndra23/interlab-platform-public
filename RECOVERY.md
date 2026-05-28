# RECOVERY.md — Interlab Global Infra Disaster Recovery

> **Status:** Phase 0 skeleton. Timing rows marked `TODO` are filled from DEPLOYMENT-LOG
> actuals after Phase 1. Target total RTO ~4.5–5.5h (spec §8).
>
> **Secrets model = Pilihan B:** no SOPS/age. Secrets live in **Coolify encrypted env**
> (canonical) + `/root/.coolify-secrets-backup.txt` (chmod 600, off-git) + Bitwarden
> (break-glass/root). On full rebuild, regenerate per-service secrets and re-inject via
> Coolify env. Coolify volume backup (Phase 1D) is the primary secret-restore path → must
> be verified restore-able.

## Recovery scenarios (RTO/RPO — spec §8)
| Scenario | RTO | Path |
|---|---|---|
| Container/service crash | minutes | Coolify restart + Netdata alert |
| Logical corruption | ~1h | restore dump/PITR → sandbox → swap |
| Server lost, OVH ok | ~1h | OVH snapshot restore (full-VM) |
| Total provider loss | ~4–6h | provision new + this doc from B2 |

## Full rebuild sequence (total ~4.5–5.5h — TODO: confirm actuals)
1. **Fresh OS** (Ubuntu 26.04 LTS target post-Phase-1.5) — _TODO timing_
2. **Install tooling** — Docker, Git, (no sops/age under Pilihan B) — _15m_
3. **Break-glass / access** — restore root pw (Bitwarden), Tailscale re-auth, SSH keys — _TODO_
4. **Clone repo** `git@gitlab.com:lafayette-group/interlab-infra-v1.git` — _TODO_
5. **Apply host tuning** — `system-config/` (see README-host-tuning.md) + swap + noatime — _10m_
6. **Restore Coolify** — Coolify DB + `/data/coolify` tar (incl acme.json) from B2 — _30m_
7. **Restore postgres-global** — base backup + WAL replay (PITR) / latest dump — _60–90m_
8. **Restore minio-global** — `rclone`/`mc` restore from B2 — _30–60m_
9. **Re-inject secrets** — regenerate + paste into Coolify env (Pilihan B) — _TODO_
10. **Start order** — postgres-global → minio-global → Supabase → Coolify-Traefik → apps — _TODO_
11. **Verify E2E** — public routes, admin (Tailscale), DB, MinIO — _30m_
12. **DNS** — Cloudflare API token → auto-update A/AAAA records — _5m_

## Sibyl recovery (ownership boundary)
Separate section — Sibyl owned by Sibyl team; preservation dumps in `/var/backups/preservation/`
(2026-05-25): `sibyl-dumpall-*.sql` (8 tables, `sibyl` schema). Sibyl MinIO was empty.

## App recovery — interlabs-crm-demo (Phase 1.6, Approach A / A2-Direct)
- **Redeploy (normal):** `cd apps/interlabs-crm-demo && docker compose up -d --build` (auto-loads `.env`; stateless api/app; connects to the data stack on `interlab-data-net`).
- **Rollback to pre-consolidation:** `cd /opt/projects/interlabs-crm-demo && docker compose -f docker-compose.demo.yml up -d` (original repo + compose untouched = safety net). `docker rm -f interlab-api interlab-app` first if names clash.
- **Data stack** (postgres:16/redis/minio) is a **separate, independent** project at `/home/zaky/data-stack` — volumes `data-stack_{postgres,redis,minio}_data`. App recovery does NOT touch it. Restore its data from dumps in `/var/backups/preservation/` if ever needed.
- **redis-global** (infra, interlab-global; for future apps): `cd coolify-resources/redis-global && docker compose up -d`. Data = `redis_global_data` volume (AOF + RDB) — recovery = mount volume / replay AOF; or accept cold start (it's a cache). Auth `redis_global_password`.
- **Secrets:** app `.env` is off-git — restore from `/root/.coolify-secrets-backup.txt` / Bitwarden / regenerate per `apps/interlabs-crm-demo/.env.example`.

## DR drill cadence
Monthly sandbox restore + annual full + post-significant-arch-change. Log results here.

### Drill history
- **2026-05-25 (Phase 1E):** sandbox restore drill — `pg_dump -Fc interlab_prod` → new `restore_sandbox` db → `pg_restore` → row count verified (100/100 match). Duration ~1s for 100 rows (tiny dataset; real RTO scales with data + WAL replay). **Procedure validated** (local; off-site B2 restore = Phase 1.5). Gotcha logged: `DROP`+`CREATE DATABASE` must be separate `psql -c` calls (can't run in a txn block).
