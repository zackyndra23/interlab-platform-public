# Phase 1E — Verify & Sign-off Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.
>
> **⚠️ INFRA-ADAPTED, mostly PASSIVE verification.** PRODUCTION `vps-lafayette-01`. DEPENDENCIES: Phase 1A–1B complete; 1C full-or-partial; 1D complete. This phase proves the system works end-to-end and hands off to the app-team.
>
> **[SERVER]** · **[LAPTOP]** · **[MANUAL]**.

**Goal:** Prove the foundation works end-to-end, validate recovery via a sandbox restore drill, produce the app-team handover package, sign off Phase 1, and take a post-deploy OVH snapshot.

**Architecture:** Verification only (no new services). One real recovery drill (restore latest dump → sandbox DB) to validate backups + feed realistic RTO timing into RECOVERY.md. Handover package gives app-team everything to start building on the foundation.

**Spec reference:** §8 (DR drill, RECOVERY.md timing), §10 (1E + handover package), §18-equivalent (RTO).

---

### Task 1E.1: End-to-end verification [SERVER/LAPTOP]

**Files:** none (record to DEPLOYMENT-LOG).

- [ ] **Step 1: Public ingress (Coolify Traefik)**

Run: `for h in app.interlab-portal.com supabase.interlab-portal.com sibyl.bisikan.app api.sibyl.bisikan.app; do echo -n "$h: "; curl -sI -o /dev/null -w '%{http_code}\n' "https://$h"; done`
Expected: legacy + (if 1C up) supabase routes serve; certs valid (Let's Encrypt, preserved). (`app.interlab-portal.com` = demo until new webapp deployed post-infra.)

- [ ] **Step 2: Admin surfaces Tailscale-only**

Verify (Tailscale): Coolify :8000, MinIO console, Uptime Kuma, Netdata :19999, Supabase Studio (if up) reachable. Off-Tailscale: all blocked.
Expected: admin = Tailscale-only; public = blocked (DOCKER-USER).

- [ ] **Step 3: DB path (app role → Supavisor → postgres-global)**

Run: `PGPASSWORD=<prod_app_pw> psql 'host=127.0.0.1 port=6543 user=interlab_prod_app.interlab dbname=interlab_prod' -tAc "SELECT 1;"`
Expected: `1` (pooled app path works).

- [ ] **Step 4: Storage path (if 1C Storage up)**

Upload a test object via Supabase Storage API (service_role) → confirm it lands in minio-global `supabase-storage`; download it back.
Expected: round-trip OK. (If Storage deferred: verify minio-global S3 reachable in-network only.)

- [ ] **Step 5: Legacy regression final**

Run: confirm Sibyl functional (browser load) + 12 legacy containers Up.
Expected: no regression from cutover. Record full matrix in DEPLOYMENT-LOG.

---

### Task 1E.2: Sandbox restore drill (validate backups) [SERVER]

**Files:** none.

- [ ] **Step 1: Create sandbox DB**

Run: `docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -c "CREATE DATABASE restore_sandbox;"`
Expected: sandbox db created.

- [ ] **Step 2: Restore latest interlab_prod dump from B2**

Run: `rclone copy b2crypt:postgres/<latest interlab_prod dump> /tmp/ && docker exec -i -e PGPASSWORD=<superuser_pw> postgres-global pg_restore -U postgres -d restore_sandbox --no-owner < /tmp/<dump>`
Expected: restore completes (errors-free or only benign ownership notices with `--no-owner`).

- [ ] **Step 3: Verify restored content**

Run: `docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -d restore_sandbox -tAc "SELECT count(*) FROM information_schema.tables WHERE table_schema NOT IN ('pg_catalog','information_schema'); SELECT extname FROM pg_extension;"`
Expected: table count matches source; `vector` extension present. (Sample a row count from a known table if data exists.)

- [ ] **Step 4: MinIO subset restore check**

Run: `rclone copy b2crypt:minio/supabase-storage/<a test prefix> /tmp/minio-restore/ && ls -R /tmp/minio-restore | head`
Expected: object(s) restored + readable.

- [ ] **Step 4.5: PITR drill — physical base + WAL replay to a target time (MF-1E-1)**

> Validates the Opsi-B RPO-minutes claim for real (NOT testable via logical dump — needs the `pg_basebackup` physical base from `scripts/backup/postgres-basebackup.sh` + archived WAL).
```bash
# (a) Mark a recovery target on the LIVE db
docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -d interlab_prod -c \
  "CREATE TABLE IF NOT EXISTS _pitr_probe(t timestamptz); INSERT INTO _pitr_probe VALUES (now());"
T_TARGET=$(docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -tAc "SELECT now();")
sleep 5
# (b) Insert an AFTER-target marker we expect PITR to EXCLUDE
docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -d interlab_prod -c \
  "INSERT INTO _pitr_probe VALUES (now());"   # this row must NOT appear after recovery
# (c) Restore latest physical base into a sandbox data dir + WAL restore_command + recovery_target_time
rclone copy b2crypt:basebackup/<latest base>.tar.gz /tmp/ && mkdir -p /tmp/pitr-data && tar xzf /tmp/<latest base>.tar.gz -C /tmp/pitr-data
cat > /tmp/pitr-data/recovery.signal <<<''   # PG12+ recovery signal
# postgresql.auto.conf: restore_command pulls WAL from b2crypt:wal/, recovery_target_time=$T_TARGET, recovery_target_action=promote
# (d) Start a throwaway PG container (same image) on the restored dir, alt port
docker run --rm -d --name pitr-sandbox -v /tmp/pitr-data:/var/lib/postgresql/data \
  -e POSTGRES_PASSWORD=x -p 127.0.0.1:5599:5432 supabase/postgres:15.8.1.085
sleep 20
# (e) Verify recovery reached target: probe table has the pre-target row, NOT the after-target row
PGPASSWORD=<superuser_pw> psql 'host=127.0.0.1 port=5599 user=postgres dbname=interlab_prod' -tAc "SELECT count(*) FROM _pitr_probe;"
```
Expected: sandbox replays WAL to `T_TARGET`; `_pitr_probe` row count = **1** (pre-target row present, after-target row excluded) → PITR precision validated. Record actual replay duration.
**Teardown:** `docker rm -f pitr-sandbox; rm -rf /tmp/pitr-data /tmp/<base>.tar.gz`. Also drop `_pitr_probe` from live: `... -c "DROP TABLE _pitr_probe;"`.
**If base backup absent** (postgres-basebackup.sh not yet run) → PITR untestable; record as gap + ensure base-backup cron active (1D).

- [ ] **Step 5: Teardown + record realistic timing**

Run: `docker exec ... psql -U postgres -c "DROP DATABASE restore_sandbox;"` + clean `/tmp`. Record actual restore durations → **update RECOVERY.md realistic-timing fields** (replaces the TODO placeholders). This is the interim DR drill (full drill = Phase 1.5 reinstall).

---

### Task 1E.3: App-team handover package [LAPTOP]

**Files:** Create `docs/handover/app-team-phase1.md`; commit.

- [ ] **Step 1: Compile handover doc**

Create `docs/handover/app-team-phase1.md` containing:
- **Supabase** (if up): `https://supabase.interlab-portal.com`, anon key, service_role key (reference SOPS location, NOT plaintext in doc), which services are live vs deferred.
- **Postgres connection strings** per env via Supavisor txn pool: `host=<server> port=6543 user=interlab_prod_app.interlab dbname=interlab_prod` (+ staging). Note app role (not superuser).
- **Data access pattern B** reminder (FE→Next.js→Supabase; RLS = second line).
- **Storage:** logical bucket naming `<app>-<env>-<purpose>`, size limits, default-private; access via Supabase Storage API only (not direct MinIO).
- **Sentry:** DSN (SOPS ref) + **MANDATORY** `beforeSend` PII-strip (email/NIK/NPWP/salary) + exclude finance/tax module — blocking for go-live.
- **Telegram** alert channel invite.
- **If GoTrue deferred:** NextAuth v5 + Postgres adapter contingency + Phase 1.5 migration note.
- **Coolify** deploy guide: how to deploy the webapp as a git-backed resource on `interlab-global` network.
- **Phase 1.5 Carry-Over Schedule (NTH-1E-1 — app-team awareness):** what's deferred + ETA, so the app-team builds with the roadmap in mind: OS LTS reinstall (≤30 Sep 2026) · any deferred Supabase services (e.g. Storage/PostgREST if time-boxed out → ETA Phase 1.5) · pgBackRest PITR-automation · Sentry self-host eval · internal-services-via-Supavisor · NextAuth→GoTrue migration (if GoTrue was deferred). Flag which app features depend on a deferred service.

- [ ] **Step 2: Commit** handover doc.

---

### Task 1E.4: Sign-off + post-deploy snapshot [SERVER/MANUAL]

**Files:** finalize `DEPLOYMENT-LOG.md`.

- [ ] **Step 1: Sign-off checklist**

Confirm + record: foundation healthy (postgres/minio/supavisor) · cutover stable (8 legacy domains on Coolify Traefik, certs preserved) · firewall locked · Supabase state (up/deferred per service) · backups running + verified + off-site · monitoring + alerts live · RECOVERY.md filled · handover delivered.
Expected: all checked (deferred items explicitly listed for Phase 1.5).

- [ ] **Step 2: [MANUAL] Post-deploy OVH snapshot**

Take a fresh OVH snapshot (post-Phase-1 baseline). Record ID in DEPLOYMENT-LOG. (Manual-only per Gate #3.)

- [ ] **Step 3: Schedule deferred carry-overs**

Record Phase 1.5 carry-over list (from 1C defers + §14): OS LTS reinstall (≤30 Sep), pgBackRest, Sentry self-host eval, deferred Supabase services, fail2ban tuning, drift-detection, manual-Traefik retirement (after 24h stable), internal-services-via-Supavisor. Set the manual-Traefik retirement reminder (+24h).

- [ ] **Step 4: Finalize DEPLOYMENT-LOG** → commit (config-as-code repo now reflects the deployed reality).

---

## Self-Review (writing-plans)

**Spec coverage:** §10 1E → E2E (1E.1), sandbox restore drill (1E.2), handover package (1E.3), sign-off + post-deploy snapshot (1E.4) ✓. §8 DR drill + RECOVERY.md realistic timing (1E.2 S5) ✓. Handover package contents match §10 + spec (Supabase keys, conn strings via Supavisor, Sentry DSN+PII-strip, Telegram, NextAuth fallback, Coolify guide) ✓.

**Placeholder scan:** `<latest dump>`/`<prod_app_pw>`/`<superuser_pw>` = runtime values (from B2 listing / SOPS) — not hand-waves. Keys referenced by SOPS location, never plaintext in handover doc.

**Consistency:** Supavisor :6543 conn string, bucket naming, db names, B2 `b2crypt:` paths — consistent with 1A/1C/1D + spec.

**Deferred:** full DR reinstall drill = Phase 1.5; manual-Traefik retirement = +24h stable.

---

## Execution Handoff
**Plan saved.** Passive verification + handover. Per Path B, post-demo. **This completes the Phase 1 plan set (0, 1A, 1B, 1C, 1D, 1E).**
