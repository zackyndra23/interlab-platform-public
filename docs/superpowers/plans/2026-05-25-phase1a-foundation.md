# Phase 1A — Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans. Steps use checkbox (`- [ ]`) syntax.
>
> **⚠️ INFRA-ADAPTED PLAN (not TDD code).** PRODUCTION server `vps-lafayette-01`, active workload (Sibyl + Interlab demo on manual Traefik 80/443). Each task: **pre-check → action → verify (expected output) → rollback note → commit config-as-code**. The "test" = verification command.
>
> **⚠️ DEPENDENCY:** Phase 0 must be COMPLETE (snapshot taken, system tuned, SOPS secrets generated, repo scaffolded). Do not start 1A otherwise.
>
> **⚠️ TWO PRODUCTION-RISK INVARIANTS for all of 1A:**
> 1. **Coolify's bundled Traefik must NOT seize ports 80/443** — manual Traefik keeps serving Sibyl + Interlab demo until the Phase **1B** cutover. We stop Coolify's proxy immediately post-install.
> 2. **Coolify UI :8000 is briefly public before the 1B firewall** — apply an interim DOCKER-USER drop right after install (Task 1A.1 Step 5) + set a strong admin password on first boot.
>
> **[SERVER]** = `vps-lafayette-01`. **[LAPTOP]** = laptop (age key/SOPS, Coolify env injection). **[MANUAL]** = human (Coolify UI first-boot).
>
> **🔑 Secret injection mechanism (MF-3 — applies to every `[LAPTOP] inject` step below):** For each Coolify resource — on the **laptop**, run `sops --decrypt secrets/<file>.yaml`, then **paste each value** into Coolify UI → Resource → Environment Variables (browser over Tailscale). **NEVER `scp`/write plaintext env files to the server.** age key + decrypted plaintext stay on the laptop only (spec §5). Phase 1.5 may evaluate Coolify-API push automation.

**Goal:** Stand up the shared data foundation — Coolify orchestrator + `postgres-global` (supabase/postgres, tuned, per-DB roles, pgvector, WAL archiving) + Supavisor pooler + `minio-global` (bucket + scoped service-account) — without disturbing the live manual-Traefik workload.

**Architecture:** Coolify installed but its proxy held down (manual Traefik still owns 80/443). `postgres-global` deployed from the `supabase/postgres` image (its init creates Supabase roles + `auth`/`storage`/`realtime` schemas in the `postgres` db — that db IS the Supabase substrate; app data lives in separate `interlab_prod`/`interlab_staging` dbs for per-DB isolation). Supavisor provides transaction (:6543) + session pooling in front. `minio-global` exposes S3 on the internal Docker network only. All resources defined as git-backed Coolify Docker-Compose resources.

**Tech Stack:** Coolify · `supabase/postgres` (PG17 + pgvector + pg_cron) · `supabase/supavisor` · `minio/minio` + `mc` · Docker shared network.

**Spec reference:** §2 (arch), §3 (resources), §4 (postgres tuning + Supavisor + per-DB isolation), §7 (MinIO wiring), §10 (1A), §11 (rollback).

> **Naming reconciliation (vs Q7 `_supabase`):** Supabase self-host conventionally bootstraps its substrate in the **`postgres`** database (the image's init target). We use `postgres` db AS the Supabase substrate (least friction, on critical path) and isolate **app** data in `interlab_prod`/`interlab_staging`. The conceptual "_supabase isolation" is satisfied by the substrate living in its own db (`postgres`) separate from app dbs. `sibyl` db = Phase 2 (consolidation).

---

### Task 1A.0: Disk-knob decision lock [recap, no mutation]

**Files:** none.

- [ ] **Step 1: Resolve the NVMe-default vs flip**

Check Task 0.0 Step 2 result in DEPLOYMENT-LOG:
- NVMe (default) → `postgresql.conf` uses `random_page_cost=1.1`, `effective_io_concurrency=200` (no change).
- SATA SSD → before Task 1A.3, set `random_page_cost=1.5`, `effective_io_concurrency=100`.
- HDD → `random_page_cost=4`, `effective_io_concurrency=2`; Sentry stays cloud; flag MinIO dedicated-volume Phase 2.
Record the chosen profile in DEPLOYMENT-LOG. **Non-blocking** — proceed with NVMe if panel still unconfirmed.

---

### Task 1A.1: Install Coolify + hold its proxy + interim :8000 lockdown [SERVER]

**Files:** none (Coolify installs to `/data/coolify`). 

- [ ] **Step 1: Pre-check — ports 80/443 owned by manual Traefik; 8000 free**

Run: `ss -tlnp | grep -E ':80 |:443 |:8000 '`
Expected: `:80` and `:443` held by manual Traefik (docker-proxy); `:8000` NOT listening.

- [ ] **Step 2: Install Coolify**

Run: `curl -fsSL https://cdn.coollabs.io/coolify/install.sh | sudo bash 2>&1 | tail -20`
Expected: install completes; prints the dashboard URL (`http://<ip>:8000`).

- [ ] **Step 3: Immediately stop Coolify's bundled proxy (avoid 80/443 conflict)**

Run: `docker ps --format '{{.Names}}' | grep -i 'coolify-proxy' && docker stop coolify-proxy 2>/dev/null; ss -tlnp | grep -E ':80 |:443 '`
Expected: `coolify-proxy` stopped (if it started); `:80`/`:443` STILL held by **manual Traefik** only. (Coolify proxy may have failed to bind anyway since ports were taken — confirm manual Traefik unaffected.)

- [ ] **Step 4: Verify Sibyl/Interlab still served**

Run: `curl -sI -o /dev/null -w '%{http_code}\n' https://sibyl.bisikan.app; curl -sI -o /dev/null -w '%{http_code}\n' https://app.interlab-portal.com`
Expected: both `200`/`301` (manual Traefik untouched). **ROLLBACK:** if down → `docker start traefik` (manual) and investigate before continuing.

- [ ] **Step 5: Interim :8000 lockdown (pre-1B firewall)**

Run: `sudo iptables -I DOCKER-USER -p tcp --dport 8000 ! -s 100.64.0.0/10 -j DROP && sudo ip6tables -I DOCKER-USER -p tcp --dport 8000 -j DROP 2>/dev/null; sudo iptables -L DOCKER-USER -n | grep 8000`
Expected: rule present (only Tailscale CIDR can reach :8000). Full firewall lands in 1B.

- [ ] **Step 6: [MANUAL] First-boot — set strong admin via Tailscale**

From laptop browser (on Tailscale): open `http://100.117.214.25:8000`, create the admin account with a strong password. Store in Bitwarden + `secrets/infrastructure.yaml` (laptop, SOPS).
Expected: Coolify dashboard reachable ONLY over Tailscale; admin created.

- [ ] **Step 7: Record** Coolify version + admin-created + proxy-held in DEPLOYMENT-LOG.

---

### Task 1A.2: Create Coolify shared Docker network [SERVER]

**Files:** none.

- [ ] **Step 1: Create the shared network for global services**

Run: `docker network create interlab-global 2>&1 || echo "exists"; docker network inspect interlab-global --format '{{.Name}}: {{.Driver}}'`
Expected: `interlab-global: bridge`. (postgres-global, minio-global, Supavisor, and later Supabase attach here so they resolve each other by name — addresses spec §7 gotcha#4.)

- [ ] **Step 2: [MANUAL] Register network in Coolify**

Coolify UI → Server → Networks → add `interlab-global` as a predefined network so Coolify resources can attach.
Expected: network selectable when creating resources.

---

### Task 1A.3: Author postgres-global config (tuning + WAL archive script) in repo [LAPTOP]

**Files:** Create `coolify-resources/postgres-global/postgresql-tuning.conf`, `scripts/backup/postgres-wal-archive.sh`, `coolify-resources/postgres-global/compose.yaml` (+ `.env.template`).

- [ ] **Step 1: Write postgresql tuning conf**

Create `coolify-resources/postgres-global/postgresql-tuning.conf` (NVMe profile; flip per 1A.0 if needed):
```
listen_addresses = '*'
password_encryption = scram-sha-256
shared_buffers = 1536MB
effective_cache_size = 6GB
work_mem = 16MB
maintenance_work_mem = 512MB
max_connections = 200
random_page_cost = 1.1
effective_io_concurrency = 200
max_wal_size = 4GB
min_wal_size = 1GB
checkpoint_completion_target = 0.9
checkpoint_timeout = 15min
wal_compression = on
synchronous_commit = on
huge_pages = try
timezone = 'UTC'
log_timezone = 'Asia/Jakarta'
log_min_duration_statement = 1000
log_connections = on
log_disconnections = on
log_line_prefix = '%t [%p]: user=%u,db=%d,app=%a,client=%h '
archive_mode = on
archive_command = '/wal-archive/postgres-wal-archive.sh %p %f'
```

- [ ] **Step 2: WAL archive script — already in repo (`scripts/backup/postgres-wal-archive.sh`)**

Pre-written + committed. It runs **IN-container** as `archive_command`, stages each WAL **atomically** to `/wal-stage` (a HOST bind-mount = `/var/backups/wal-stage`), and **exits non-zero on failure** so Postgres retries + keeps the WAL locally (anti silent-death, §8). No rclone in the DB container — the host cron **`wal-push.sh` (Phase 1D)** ships staged WAL → `b2crypt:wal/`; **`wal-lag-check.sh`** monitors `pg_stat_archiver`. `postgresql-tuning.conf` (Step 1) already sets `archive_command = '/wal-archive/postgres-wal-archive.sh %p %f'`.
Run (prep the host stage dir before deploy): `sudo mkdir -p /var/backups/wal-stage`
Expected: stage dir exists (the bind-mount target). PITR base = `postgres-basebackup.sh` (Phase 1D); WAL replays onto it.

- [ ] **Step 3: Write Coolify compose for postgres-global**

Create `coolify-resources/postgres-global/compose.yaml`:
```yaml
services:
  postgres-global:
    image: supabase/postgres:15.8.1.085  # PINNED (verified). NOTE: official Supabase self-host (compose @c1276c8) pins PG15 15.8.1.085 — gotrue v2.186.0 / storage-api v1.48.26 are TESTED against it. PG17 = off the tested matrix (migration risk in the 3h box). pgvector + pg_cron ARE bundled here, so Sibyl-consolidation (Q2) requirement holds. Deviation-from-Q7-PG17 documented; flagged for override.
    container_name: postgres-global
    restart: unless-stopped
    networks: [interlab-global]
    environment:
      POSTGRES_PASSWORD: ${POSTGRES_SUPERUSER_PASSWORD}
    command:
      - postgres
      - -c
      - config_file=/etc/postgresql/postgresql.conf
    volumes:
      - pg_global_data:/var/lib/postgresql/data
      - ./postgresql-tuning.conf:/etc/postgresql/postgresql.conf:ro
      - ../../scripts/backup/postgres-wal-archive.sh:/wal-archive/postgres-wal-archive.sh:ro
      - /var/backups/wal-stage:/wal-stage          # host bind-mount: archive_command stages WAL here; host wal-push.sh ships to B2
    mem_limit: 4g
    ulimits:
      nofile: { soft: 65536, hard: 65536 }
    healthcheck:
      test: ["CMD-SHELL", "pg_isready -U postgres"]
      interval: 10s
      timeout: 5s
      retries: 10
networks:
  interlab-global:
    external: true
volumes:
  pg_global_data:
    external: true   # created fresh in 1A.4 Step 1 (old experiment volume renamed in 1B/0)
```
And `.env.template` listing `POSTGRES_SUPERUSER_PASSWORD=` (real value injected from SOPS at deploy).

- [ ] **Step 4: Commit** the three files to repo.

---

### Task 1A.4: Deploy postgres-global via Coolify [SERVER]

**Files:** none (deploys from repo compose).

- [ ] **Step 1: Pre-check — experiment already dropped (Phase 0.4.5) + create fresh volume**

Run: `docker ps -a --format '{{.Names}}' | grep -x postgres-global || echo "name free (good)"; docker volume ls | grep pg_global`
Expected: NO `postgres-global` container; `pg_global_data_old` present (Phase 0.4.5 copy), `pg_global_data` free. Create fresh: `docker volume create pg_global_data`.
**If experiment still present:** Phase 0.4.5 was skipped — go run it (dump-verify → stop/rm → volume copy-to-old) before proceeding. Do NOT `docker volume rename` (that command does not exist).

- [ ] **Step 2: [LAPTOP] inject secret + deploy via Coolify**

Per the Secret injection mechanism (header): on laptop `sops --decrypt secrets/infrastructure.yaml`, then **paste** `POSTGRES_SUPERUSER_PASSWORD` into Coolify UI → postgres-global resource → Environment Variables (browser over Tailscale; no plaintext file to server). Point the Coolify resource at repo `coolify-resources/postgres-global/` (git-deploy). Deploy.
Expected: Coolify pulls + starts `postgres-global`.

- [ ] **Step 3: Verify healthy + tuning applied**

Run: `docker exec postgres-global pg_isready -U postgres && docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -tAc "SHOW server_version; SHOW shared_buffers; SHOW random_page_cost; SHOW archive_mode;"`
Expected: `accepting connections`; server_version `15.x` (confirms PG15 15.8.1.085 — matches official Supabase self-host pin); `1536MB`; `1.1` (or flipped value); `on`.

- [ ] **Step 4: Verify it's on the shared network**

Run: `docker inspect postgres-global --format '{{json .NetworkSettings.Networks}}' | grep interlab-global`
Expected: attached to `interlab-global`.

- [ ] **Step 5: Record** in DEPLOYMENT-LOG.

---

### Task 1A.5: Bootstrap pgvector + per-DB roles + databases [SERVER]

**Files:** Create `coolify-resources/postgres-global/bootstrap.sql` in repo (committed); run it once.

- [ ] **Step 1: Write bootstrap.sql (least-privilege, per spec §4)**

Create `coolify-resources/postgres-global/bootstrap.sql`:
```sql
-- pgvector in the Supabase substrate db (postgres) + app dbs
CREATE EXTENSION IF NOT EXISTS vector;

-- App databases with dedicated owner + app roles (no superuser for apps)
CREATE ROLE interlab_prod_owner LOGIN PASSWORD :'prod_owner_pw' NOSUPERUSER CREATEDB;
CREATE ROLE interlab_prod_app   LOGIN PASSWORD :'prod_app_pw'   NOSUPERUSER;
CREATE DATABASE interlab_prod OWNER interlab_prod_owner;
REVOKE CONNECT ON DATABASE interlab_prod FROM PUBLIC;
GRANT  CONNECT ON DATABASE interlab_prod TO interlab_prod_owner, interlab_prod_app;

CREATE ROLE interlab_staging_owner LOGIN PASSWORD :'stg_owner_pw' NOSUPERUSER CREATEDB;
CREATE ROLE interlab_staging_app   LOGIN PASSWORD :'stg_app_pw'   NOSUPERUSER;
CREATE DATABASE interlab_staging OWNER interlab_staging_owner;
REVOKE CONNECT ON DATABASE interlab_staging FROM PUBLIC;
GRANT  CONNECT ON DATABASE interlab_staging TO interlab_staging_owner, interlab_staging_app;
```

- [ ] **Step 2: Tighten public schema + pgvector per app db**

Append to bootstrap.sql (run per app db):
```sql
\connect interlab_prod
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT  ALL ON SCHEMA public TO interlab_prod_owner;
GRANT  USAGE ON SCHEMA public TO interlab_prod_app;
CREATE EXTENSION IF NOT EXISTS vector;
\connect interlab_staging
REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT  ALL ON SCHEMA public TO interlab_staging_owner;
GRANT  USAGE ON SCHEMA public TO interlab_staging_app;
CREATE EXTENSION IF NOT EXISTS vector;
```
(`sibyl` db = Phase 2 consolidation; not created now.)

- [ ] **Step 3: [LAPTOP→SERVER] Run bootstrap with injected role passwords**

From laptop, decrypt role pws from SOPS, then:
```bash
docker exec -i -e PGPASSWORD=<superuser_pw> postgres-global \
  psql -U postgres -v prod_owner_pw=<..> -v prod_app_pw=<..> -v stg_owner_pw=<..> -v stg_app_pw=<..> \
  < coolify-resources/postgres-global/bootstrap.sql
```
Expected: roles + dbs created, no error.

- [ ] **Step 4: Verify dbs, roles, extension**

Run: `docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -tAc "SELECT datname FROM pg_database WHERE datname LIKE 'interlab_%';"` and per-db: `psql -d interlab_prod -tAc "SELECT extname FROM pg_extension WHERE extname='vector';"`
Expected: `interlab_prod`, `interlab_staging` listed; `vector` present in each.

- [ ] **Step 5: Verify Supabase substrate roles exist (image init)**

Run: `docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -tAc "SELECT rolname FROM pg_roles WHERE rolname IN ('authenticator','supabase_admin','supabase_auth_admin','supabase_storage_admin');"`
Expected: all four present (created by supabase/postgres init) — confirms 1C can layer on without bootstrapping the DB.

- [ ] **Step 6: Commit** `bootstrap.sql` (no plaintext pws — passed via `-v`) to repo.

---

### Task 1A.6: Confirm WAL archiving active (local stage) [SERVER]

**Files:** none.

- [ ] **Step 1: Force a WAL switch + check archiver**

Run: `docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -c "SELECT pg_switch_wal();" && sleep 3 && docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -tAc "SELECT archived_count, failed_count, last_archived_wal FROM pg_stat_archiver;"`
Expected: `archived_count` ≥ 1, `failed_count` = 0, a `last_archived_wal` name.

- [ ] **Step 2: Verify WAL staged locally**

Run: `docker exec postgres-global ls /var/lib/postgresql/wal-stage | head`
Expected: at least one WAL file staged. (rclone off-site push + lag-monitor cron wired in Phase 1D.)

- [ ] **Step 3: Record** archiver working (local stage) in DEPLOYMENT-LOG.

---

### Task 1A.7: Deploy Supavisor pooler (transaction + session) [SERVER]

**Files:** Create `coolify-resources/postgres-global/supavisor-compose.yaml` + `.env.template`; commit.

- [ ] **Step 1: Create Supavisor metadata db**

Run: `docker exec -e PGPASSWORD=<pw> postgres-global psql -U postgres -c "CREATE DATABASE _supavisor;"`
Expected: db created (Supavisor stores tenant/pool config here).

- [ ] **Step 2: Write Supavisor compose**

Create `coolify-resources/postgres-global/supavisor-compose.yaml`:
```yaml
services:
  supavisor:
    image: supabase/supavisor:1.1.56
    container_name: supavisor
    restart: unless-stopped
    networks: [interlab-global]
    environment:
      DATABASE_URL: ecto://postgres:${POSTGRES_SUPERUSER_PASSWORD}@postgres-global:5432/_supavisor
      SECRET_KEY_BASE: ${SUPAVISOR_SECRET_KEY_BASE}
      VAULT_ENC_KEY: ${SUPAVISOR_VAULT_ENC_KEY}
      API_JWT_SECRET: ${SUPAVISOR_API_JWT_SECRET}
      METRICS_JWT_SECRET: ${SUPAVISOR_METRICS_JWT_SECRET}
      PORT: "4000"
      PROXY_PORT_TRANSACTION: "6543"
      PROXY_PORT_SESSION: "5432"
    ports:
      - "127.0.0.1:6543:6543"   # transaction pool (internal-only)
      - "127.0.0.1:5433:5432"   # session pool (internal-only; host 5433 to avoid clash)
    mem_limit: 512m
    depends_on: [postgres-global]
networks:
  interlab-global: { external: true }
```
`.env.template`: the 4 Supavisor secrets (generate `openssl rand -base64 32` each → `secrets/infrastructure.yaml`).

- [ ] **Step 3: [LAPTOP] Deploy with injected secrets**

Decrypt SOPS → inject 4 Supavisor secrets + `POSTGRES_SUPERUSER_PASSWORD` → deploy via Coolify.
Expected: `supavisor` container Up + healthy.

- [ ] **Step 4: Provision the tenant (pool to postgres-global)**

> **NTH-2 — Tenant model = SINGLE-TENANT.** One Supavisor tenant `interlab` fronting postgres-global. Apps/services select the **target database** (`postgres` / `interlab_prod` / `interlab_staging`) via the connection string's `dbname`, not via separate tenants. Multi-tenant Supavisor deferred (no Phase 1 need; healthier to keep one tenant).

Run (Supavisor admin API, token = API_JWT_SECRET): `curl -s -X PUT 'http://127.0.0.1:4000/api/tenants/interlab' -H "Authorization: Bearer <API_JWT_SECRET>" -H 'Content-Type: application/json' -d '{"tenant":{"db_host":"postgres-global","db_port":5432,"db_database":"postgres","users":[{"db_user":"postgres","db_password":"<pw>","pool_size":20,"mode_type":"transaction","is_manager":true}]}}'`
Expected: tenant created (JSON 200).

- [ ] **Step 5: Verify both pool endpoints reachable**

Run: `PGPASSWORD=<pw> psql 'host=127.0.0.1 port=6543 user=postgres.interlab dbname=postgres' -tAc 'select 1'`
Expected: `1` (transaction pool routes to postgres-global). Repeat for session port 5433.

- [ ] **Step 6: Commit** Supavisor compose + .env.template. Record per-service routing intent in DEPLOYMENT-LOG: PostgREST/Storage→:6543 (txn), GoTrue→session, set when 1C connects.

---

### Task 1A.8: Deploy minio-global [SERVER]

**Files:** Create `coolify-resources/minio-global/compose.yaml` + `.env.template`; commit.

- [ ] **Step 1: Write minio-global compose (S3 internal-only)**

Create `coolify-resources/minio-global/compose.yaml`:
```yaml
services:
  minio-global:
    image: minio/minio:RELEASE.2025-09-07T16-13-09Z   # pinned (Q19 reproducibility)
    container_name: minio-global
    restart: unless-stopped
    networks: [interlab-global]
    command: server /data --console-address ":9001"
    environment:
      MINIO_ROOT_USER: ${MINIO_ROOT_USER}
      MINIO_ROOT_PASSWORD: ${MINIO_ROOT_PASSWORD}
    volumes:
      - minio_global_data:/data
    ports:
      - "127.0.0.1:9101:9001"   # console -> Tailscale-only via firewall 1B (loopback for now)
    mem_limit: 1g
    # NOTE: no internal healthcheck — minio/minio image bundles NO curl/wget/mc,
    # so an in-image probe can't work. Health verified externally via mc one-shot
    # (Task 1A.9/1A.10) hitting http://minio-global:9000/minio/health/live.
networks:
  interlab-global: { external: true }
volumes:
  minio_global_data:
```
Note: **NO published :9000** (S3 API stays on the Docker network only — spec §7/§10). Console on loopback now, Tailscale-bound in 1B.

- [ ] **Step 2: [LAPTOP] Deploy with injected root creds**

Decrypt SOPS → inject `MINIO_ROOT_USER`/`MINIO_ROOT_PASSWORD` → deploy via Coolify.
Expected: `minio-global` Up + healthy.

- [ ] **Step 3: Verify S3 NOT publicly published**

Run: `docker port minio-global; ss -tlnp | grep 9000 || echo "9000 not host-published (correct)"`
Expected: no `0.0.0.0:9000`. S3 reachable only in-network.

- [ ] **Step 4: Record** in DEPLOYMENT-LOG.

---

### Task 1A.9: Init MinIO bucket + scoped service-account [SERVER/LAPTOP]

**Files:** Create `scripts/init-minio-supabase.sh` (idempotent) + `coolify-resources/minio-global/storage-policy.json`; commit.

- [ ] **Step 1: Write least-privilege policy**

Create `coolify-resources/minio-global/storage-policy.json`:
```json
{ "Version": "2012-10-17", "Statement": [ {
  "Effect": "Allow",
  "Action": ["s3:GetObject","s3:PutObject","s3:DeleteObject","s3:ListBucket","s3:GetBucketLocation"],
  "Resource": ["arn:aws:s3:::supabase-storage","arn:aws:s3:::supabase-storage/*"]
} ] }
```
(No ListAllMyBuckets/CreateBucket/DeleteBucket — spec §7.)

- [ ] **Step 2: Write idempotent init script**

Create `scripts/init-minio-supabase.sh`:
```bash
#!/usr/bin/env bash
set -euo pipefail
: "${MINIO_ROOT_USER:?}"; : "${MINIO_ROOT_PASSWORD:?}"
: "${STORAGE_SA_KEY:?}"; : "${STORAGE_SA_SECRET:?}"
mc alias set mg http://minio-global:9000 "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD"
mc mb --ignore-existing mg/supabase-storage
mc anonymous set none mg/supabase-storage
mc admin policy create mg supabase-storage-rw /policy/storage-policy.json || true
mc admin user add mg "$STORAGE_SA_KEY" "$STORAGE_SA_SECRET" || true
mc admin policy attach mg supabase-storage-rw --user "$STORAGE_SA_KEY" || true
echo "init-minio-supabase: done"
```

- [ ] **Step 3: Run it (via a one-shot mc container on the shared network)**

Run (with SOPS-injected vars + policy mounted):
```bash
docker run --rm --network interlab-global \
  -e MINIO_ROOT_USER=<..> -e MINIO_ROOT_PASSWORD=<..> -e STORAGE_SA_KEY=<..> -e STORAGE_SA_SECRET=<..> \
  -v "$PWD/scripts/init-minio-supabase.sh:/init.sh:ro" \
  -v "$PWD/coolify-resources/minio-global/storage-policy.json:/policy/storage-policy.json:ro" \
  --entrypoint sh minio/mc:RELEASE.2025-08-13T08-35-41Z /init.sh
```
Expected: `init-minio-supabase: done`.

- [ ] **Step 4: Verify bucket + SA + policy**

Run: `docker run --rm --network interlab-global -e ... --entrypoint sh minio/mc:RELEASE.2025-08-13T08-35-41Z -c 'mc alias set mg http://minio-global:9000 $MINIO_ROOT_USER $MINIO_ROOT_PASSWORD && mc ls mg && mc admin user info mg <STORAGE_SA_KEY>'`
Expected: `supabase-storage` bucket exists; SA user listed with `supabase-storage-rw` policy attached.

- [ ] **Step 5: Verify SA is scoped (negative test)**

Using the SA creds (not root): attempt `mc mb mg2/should-fail` → expect **AccessDenied** (proves least-privilege).
Expected: denied.

- [ ] **Step 6: Commit** init script + policy. Record SA key id (NOT secret) in DEPLOYMENT-LOG.

---

### Task 1A.10: Foundation health verification [SERVER]

**Files:** none (gate).

- [ ] **Step 1: All foundation containers healthy**

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep -E 'coolify|postgres-global|supavisor|minio-global'`
Expected: all `Up`/`healthy`.

- [ ] **Step 2: Data path end-to-end (pooler → pg)**

Run: `PGPASSWORD=<prod_app_pw> psql 'host=127.0.0.1 port=6543 user=interlab_prod_app.interlab dbname=interlab_prod' -tAc "CREATE TABLE _t(i int); INSERT INTO _t VALUES(1); SELECT count(*) FROM _t; DROP TABLE _t;"`
Expected: `1` (app role → Supavisor txn pool → postgres-global, RW works).

- [ ] **Step 3: Legacy still healthy (regression gate)**

Run: `curl -sI -o /dev/null -w '%{http_code}\n' https://sibyl.bisikan.app https://app.interlab-portal.com; docker ps --format '{{.Names}}' | grep -cE 'sibyl-|interlab-'`
Expected: legacy routes `200`/`301`; 12 legacy containers present. **Manual Traefik still owns 80/443 — cutover is 1B.**

- [ ] **Step 4: Resource sanity vs budget**

Run: `docker stats --no-stream --format '{{.Name}} {{.MemUsage}}' | grep -E 'postgres-global|minio-global|supavisor'; free -h`
Expected: within §3 budget (pg ≤4g, minio ≤1g, supavisor ≤512m); host RAM headroom remains.

- [ ] **Step 5: Record** foundation sign-off in DEPLOYMENT-LOG.

---

## Self-Review (writing-plans)

**Spec coverage:** §10 1A row → Coolify (1A.1), shared net (1A.2), postgres-global tuning+roles+pgvector+WAL (1A.3–1A.6), Supavisor (1A.7), minio-global+init (1A.8–1A.9), verify (1A.10) ✓. §4 tuning conf values verbatim ✓. §4 per-DB isolation → 1A.5 (interlab_prod/staging owner+app roles, REVOKE PUBLIC) ✓. §4 Supavisor txn+session → 1A.7 ✓. §7 MinIO scoped SA + no public S3 → 1A.8–1A.9 ✓. User focus areas (disk-knob 1A.0, Supavisor 1A.7, per-DB roles 1A.5, pgvector 1A.5) ✓.

**Production-risk invariants:** Coolify proxy held (1A.1 S3–S4), interim :8000 lockdown (1A.1 S5), legacy regression gate (1A.10 S3) ✓.

**Placeholder scan:** `<pw>`/`<..>` are deliberate secret-injection points (decrypted from SOPS at deploy, never hardcoded) — flagged as [LAPTOP] inject steps, not placeholders. Images: minio `RELEASE.2025-09-07T16-13-09Z` + mc `RELEASE.2025-08-13T08-35-41Z` **pinned** (pulled + verified); `supabase/postgres` + `supavisor` tags = verify latest-stable at execute time (flagged in 1A.0/1A.7). No hand-waved logic. **Fixed:** removed broken minio internal healthcheck (image has no curl/mc).

**Consistency:** network `interlab-global`, db names `interlab_prod`/`interlab_staging`, roles `*_owner`/`*_app`, bucket `supabase-storage`, ports (6543 txn / 5433 session / no-public-9000) consistent across tasks + with spec §2/§4/§7.

**Deferred to later plans:** WAL rclone push + lag-monitor + backup cron (1D) · firewall + Tailscale binding of :8000/:9101/:9001 (1B) · Supabase API services + per-service pool routing (1C).

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-phase1a-foundation.md`.**

> ⚠️ Depends on Phase 0 complete + execute-tonight-vs-defer decision. Production-risk invariants (Coolify proxy held, :8000 locked, legacy regression gate) are mandatory checkpoints.

Execution options (when ready): **1. Subagent-Driven (recommended)** — fresh subagent per task + mandatory review gates (infra: review between every task). **2. Inline** — checkpoints.

**Next (after your 1A review):** Phase **1B — Traefik cutover** (firewall + sshd lockdown + cert preservation + file-bridge + Interlab-canary→Sibyl + <15min rollback).
