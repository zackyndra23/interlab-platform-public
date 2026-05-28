# Phase 1C — Supabase (time-boxed) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.
>
> **⚠️ INFRA-ADAPTED + 3-HOUR TIME-BOX.** PRODUCTION `vps-lafayette-01`. Each task: pre-check → action → verify → rollback → commit. **postgres-global (1A) is the critical path and stays regardless** — Supabase services here are time-boxed and **gracefully partial-deferrable** (Task 1C.7).
>
> **⚠️ DEPENDENCIES:** Phase 1A COMPLETE (postgres-global healthy with Supabase substrate roles/schemas in `postgres` db; minio-global + `supabase-storage` bucket + scoped SA; Supavisor up). Phase 1B COMPLETE (Coolify Traefik is ingress; firewall up). JWT secrets generated in Phase 0 (`secrets/supabase.yaml`).
>
> **⏱️ TIME-BOX: 3 hours from 1C.2 deploy. At hour-3, run the health gate (1C.7) and DEFER whatever isn't healthy — do NOT extend.**
>
> **[SERVER]** · **[LAPTOP]** (SOPS inject via Coolify UI over Tailscale) · **[MANUAL]**.

**Goal:** Layer Supabase API services (Kong + GoTrue + PostgREST + Storage; Studio bonus) onto the existing postgres-global + minio-global, exposed at `supabase.interlab-portal.com`, within a 3h time-box with graceful partial-defer.

**Architecture:** Official Supabase self-host compose, **trimmed** — drop the bundled `db` (use postgres-global), drop `realtime`/`analytics`(logflare)/`vector`/`functions`/`imgproxy`/bundled-`supavisor`. Supabase **internal** services connect **directly** to postgres-global:5432 with their supabase roles (standard self-host); the **app/webapp** uses the 1A Supavisor txn pool (:6543). Storage uses minio-global S3 (internal network, path-style, scoped SA). Kong is the public API gateway routed via Coolify Traefik.

**Tech Stack:** Supabase self-host (Kong, GoTrue, PostgREST, storage-api, postgres-meta, Studio) · postgres-global · minio-global · Coolify.

**Spec reference:** §7 (method, time-box, health criteria, storage wiring, auth fallback), §10 (1C), §12 (R3), §13 (defer matrix).

> **Deviation-with-rationale (vs Q7 "PostgREST/Storage via Supavisor"):** Supabase **internal** services connect **directly** to postgres-global:5432 (standard self-host; avoids provisioning Supavisor tenants/roles for internal services within the time-box). The **app** still uses Supavisor :6543. Routing internal services through Supavisor = Phase 1.5 optimization if connection counts warrant.

---

### Task 1C.0: Pre-flight + start time-box clock [SERVER]

**Files:** none.

- [ ] **Step 1: Confirm substrate ready**

Run: `docker exec -e PGPASSWORD=<superuser_pw> postgres-global psql -U postgres -tAc "SELECT rolname FROM pg_roles WHERE rolname IN ('authenticator','supabase_auth_admin','supabase_storage_admin'); SELECT nspname FROM pg_namespace WHERE nspname IN ('auth','storage');"`
Expected: roles + `auth`/`storage` schemas present (from supabase/postgres init, verified in 1A.5 Step 5).

- [ ] **Step 2: Confirm minio-global bucket + SA**

Run: mc one-shot (as in 1A.9 Step 4) → `mc ls mg` shows `supabase-storage`; SA has `supabase-storage-rw`.
Expected: bucket + scoped SA ready.

- [ ] **Step 3: START TIME-BOX**

Record `T0 = now` + `T0+3h = HARD GATE` in DEPLOYMENT-LOG. All deploy/debug below counts against this.

---

### Task 1C.1: Author trimmed Supabase compose [LAPTOP]

**Files:** Create `coolify-resources/supabase/compose.yaml` (+ `.env.template`); commit.

- [ ] **Step 1: Fetch official compose at the PINNED commit (MF-1C-1 — pre-verified)**

Run: `git clone https://github.com/supabase/supabase /tmp/supabase-src && cd /tmp/supabase-src && git checkout c1276c8e9a78` (pinned commit, pre-verified 2026-05-25). Copy `docker/docker-compose.yml` as the base into `coolify-resources/supabase/compose.yaml`.
**Pinned service image tags at this commit** (keep these in the trimmed compose): `kong/kong:3.9.1`, `supabase/gotrue:v2.186.0`, `postgrest/postgrest:v14.8`, `supabase/storage-api:v1.48.26`, `supabase/postgres-meta:v0.96.3`, `supabase/studio:2026.04.27-sha-5f60601`. (These match `postgres:15.8.1.085` from 1A — same tested matrix.)

- [ ] **Step 2: Apply trim (remove services)**

Edit `coolify-resources/supabase/compose.yaml` — **remove these services entirely**: `db` (use postgres-global), `realtime`, `analytics`, `vector`, `functions`/`edge-functions`, `imgproxy`, `supavisor`/`pooler`. Remove their `depends_on` references from remaining services. **Keep:** `kong`, `auth` (GoTrue), `rest` (PostgREST), `storage`, `meta` (postgres-meta), `studio`.

- [ ] **Step 3: Point remaining services at postgres-global + minio-global**

Set env on the kept services (values injected from SOPS at deploy):
```
# DB (internal services -> postgres-global DIRECT)
POSTGRES_HOST=postgres-global
POSTGRES_PORT=5432
POSTGRES_DB=postgres
POSTGRES_PASSWORD=${POSTGRES_SUPERUSER_PASSWORD}
# JWT (from secrets/supabase.yaml)
JWT_SECRET=${SUPABASE_JWT_SECRET}
ANON_KEY=${SUPABASE_ANON_KEY}
SERVICE_ROLE_KEY=${SUPABASE_SERVICE_ROLE_KEY}
# Storage -> minio-global (spec §7 gotchas)
STORAGE_BACKEND=s3
GLOBAL_S3_BUCKET=supabase-storage
GLOBAL_S3_ENDPOINT=http://minio-global:9000
GLOBAL_S3_FORCE_PATH_STYLE=true
STORAGE_S3_REGION=us-east-1
AWS_ACCESS_KEY_ID=${STORAGE_SA_KEY}
AWS_SECRET_ACCESS_KEY=${STORAGE_SA_SECRET}
# Studio basic-auth (defense-in-depth, even Tailscale-only)
DASHBOARD_USERNAME=${SUPABASE_DASHBOARD_USER}
DASHBOARD_PASSWORD=${SUPABASE_DASHBOARD_PASSWORD}
# Public URL
API_EXTERNAL_URL=https://supabase.interlab-portal.com
SUPABASE_PUBLIC_URL=https://supabase.interlab-portal.com
```
Attach all services to the external `interlab-global` network (so they reach postgres-global + minio-global by name). Add `mem_limit` per service (kong 512m, auth 256m, rest 256m, storage 256m, meta 128m, studio 256m → ~1.7g total, spec §3).

- [ ] **Step 4: Commit** `coolify-resources/supabase/compose.yaml` + `.env.template` (the env keys, no values). Record pinned Supabase tag in DEPLOYMENT-LOG.

---

### Task 1C.2: Deploy the Supabase stack via Coolify [SERVER/LAPTOP]

**Files:** none.

- [ ] **Step 1: [LAPTOP] inject the 8 secrets + deploy (MF-1C-2 — concrete workflow)**

On laptop: `sops --decrypt secrets/supabase.yaml` + `sops --decrypt secrets/infrastructure.yaml`. In Coolify UI (over Tailscale) → Supabase resource → **Environment Variables** → paste these **8 values** one-by-one, then Save:
1. `POSTGRES_SUPERUSER_PASSWORD` (infrastructure.yaml) · 2. `SUPABASE_JWT_SECRET` · 3. `SUPABASE_ANON_KEY` · 4. `SUPABASE_SERVICE_ROLE_KEY` (supabase.yaml) · 5. `STORAGE_SA_KEY` · 6. `STORAGE_SA_SECRET` (infrastructure.yaml) · 7. `SUPABASE_DASHBOARD_USER` · 8. `SUPABASE_DASHBOARD_PASSWORD` (supabase.yaml).
Point at repo `coolify-resources/supabase/`. Deploy.
Expected: Coolify pulls + starts kong/auth/rest/storage/meta/studio on `interlab-global`.
> ⚠️ **8 manual pastes = error-prone.** Double-check each var name+value before Save (a wrong JWT_SECRET = all auth broken). If this feels risky, a Coolify-API bulk-inject script is a **Phase 1.5 automation** candidate (defer).
**Fallback (spec §7):** if Coolify compose resource is flaky → `docker compose -f coolify-resources/supabase/compose.yaml up -d` on server + systemd unit; Coolify only routes Kong.

- [ ] **Step 2: Containers up**

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep -iE 'kong|auth|rest|storage|meta|studio'`
Expected: 6 services Up (health pending — verified per-service next).

---

### Task 1C.3: Per-service health verification (concrete criteria) [SERVER]

**Files:** none. (Run all on the `interlab-global` network, e.g. via `docker exec kong ...` or a curl sidecar.)

- [ ] **Step 1: Kong (gateway) — gate-critical**

Run: `docker exec <kong> curl -sf http://localhost:8000/ -o /dev/null -w '%{http_code}\n'` and confirm routes registered (`kong` admin/config).
Expected: responds; downstream routes present. **If Kong unhealthy → FULL DEFER (no API gateway, §7).**

- [ ] **Step 2: GoTrue (auth) — smoke, not just liveness**

Run: `docker exec <kong> curl -sf http://auth:9999/health -o /dev/null -w '%{http_code}\n'` then a signup smoke: `curl -s -X POST http://auth:9999/signup -H 'Content-Type: application/json' -d '{"email":"smoke@test.local","password":"smoketest123"}' | head -c 200`
Expected: `/health` 200 + signup returns a token/JSON (not 5xx). Confirms GoTrue ↔ postgres-global `auth` schema works.

- [ ] **Step 3: PostgREST (rest)**

Run: `docker exec <kong> curl -sf http://rest:3000/ -o /dev/null -w '%{http_code}\n'`
Expected: 200 + JSON endpoint list. (Optional: query a test table via service_role.)

- [ ] **Step 4: Storage + MinIO wiring**

Run: `docker exec <kong> curl -sf http://storage:5000/status -o /dev/null -w '%{http_code}\n'` then create a logical bucket: `curl -s -X POST http://storage:5000/bucket -H "Authorization: Bearer $SERVICE_ROLE_KEY" -H 'Content-Type: application/json' -d '{"name":"interlab-prod-documents"}'`
Expected: `/status` 200; logical bucket created (object lands in minio-global `supabase-storage` under that prefix). **If minio-global unhealthy → Storage auto-defers (decoupled blame, §7).**

- [ ] **Step 5: Record** per-service health (pass/fail) + timestamp vs T0 in DEPLOYMENT-LOG.

---

### Task 1C.4: Route supabase.interlab-portal.com via Coolify Traefik [SERVER]

**Files:** Coolify resource domain config (or dynamic file).

- [ ] **Step 1: Assign public domain to Kong — REUSE existing wildcard (MF-1C-3)**

In Coolify → Supabase resource → set domain `supabase.interlab-portal.com` → Kong service (port 8000).
⚠️ **`supabase.interlab-portal.com` is covered by the `*.interlab-portal.com` wildcard cert preserved/transformed in 1B.5 — it must REUSE that, NOT request a new per-subdomain cert** (a new DNS-01 request risks LE rate-limit, esp. on retries).
**Verify post-assign (Traefik logs):**
```bash
docker logs coolify-proxy --tail 50 2>&1 | grep -iE 'supabase.interlab-portal.com|acme|certificate'
```
Expected: logs show the wildcard/stored cert being **used**, NOT `Requesting certificate for supabase.interlab-portal.com`. If a new request appears → stop, route via the wildcard cert explicitly (ensure no per-router `certResolver` forcing a fresh order for this host).

- [ ] **Step 2: Verify public route + cert**

Run: `curl -sI -o /dev/null -w '%{http_code}\n' https://supabase.interlab-portal.com/auth/v1/health` + `openssl s_client -connect supabase.interlab-portal.com:443 -servername supabase.interlab-portal.com </dev/null 2>/dev/null | openssl x509 -noout -issuer`
Expected: 200; Let's Encrypt issuer (DNS-01 wildcard or per-domain cert). **If LE rate-limit → defer cert per spec §6 (use existing wildcard if present).**

- [ ] **Step 3: Record** public endpoint live in DEPLOYMENT-LOG.

---

### Task 1C.5: Studio (bonus) — Tailscale-only + basic-auth [SERVER]

**Files:** none.

- [ ] **Step 1: Confirm Studio bound Tailscale-only + basic-auth**

Studio should NOT get a public domain. Reach via Tailscale (Coolify can bind it internal, or `tailscale serve`). Basic-auth via `DASHBOARD_USERNAME`/`PASSWORD` (set in 1C.1).
Run (Tailscale): `curl -su $DASHBOARD_USERNAME:$DASHBOARD_PASSWORD http://100.117.214.25:<studio-port>/ -o /dev/null -w '%{http_code}\n'`
Expected: 200 with creds; 401 without. **Studio = bonus; defer if not healthy, no blocker.**

---

### Task 1C.6: HEALTH GATE @ T0+3h — decision tree [MANUAL + SERVER]

**Files:** none. **This is the time-box enforcement.**

- [ ] **Step 1: Evaluate health (from 1C.3) against the gate**

Decision tree (spec §7):
- **Kong + GoTrue both healthy** → minimum viable. **Continue** (keep PostgREST/Storage/Studio if healthy; defer any that aren't).
- **Kong unhealthy** → **FULL DEFER** Supabase to Phase 1.5 (no API gateway). App uses postgres-direct (Supavisor :6543) + NextAuth fallback (1C.7).
- **GoTrue unhealthy** → defer auth to NextAuth fallback (1C.7); keep Kong/PostgREST/Storage if up.
- **PostgREST unhealthy** → defer; app queries postgres-direct via Supavisor.
- **Storage unhealthy** → defer; app uses MinIO direct (S3 SDK) or defers file feature.
- **Studio unhealthy** → defer; no blocker.

- [ ] **Step 2: Execute defer (if any) — do NOT extend the box**

For each deferred service: stop/disable its container, record state + reason in DEPLOYMENT-LOG, add to Phase 1.5 carry-over list. **Do not "just one more hour" (spec discipline).**

- [ ] **Step 3: Record** final Supabase state (up vs deferred per service) + handoff note for app-team (1E).

---

### Task 1C.7: Auth fallback (NextAuth) — contingency [LAPTOP/app-team handoff]

**Files:** none in infra repo (app-team owns). Documented for handoff.

- [ ] **Step 1: If GoTrue deferred — signal app-team contingency**

App-team uses **NextAuth.js v5 + Postgres database adapter** → tables `auth_*` in `interlab_prod` (Supabase `auth` schema stays idle), **database session** strategy. Prep is parallel/contingency, **NOT default** (default = GoTrue if it came up). Phase 1.5 migration script: `interlab_prod.auth_users → auth.users`.
Anti-fallback: no custom-JWT, no in-memory session, no defer-auth-entirely. Record in handoff package (1E).

---

## Self-Review (writing-plans)

**Spec coverage:** §7 method (trimmed compose, drop db/realtime/analytics/vector/functions/imgproxy → 1C.1), storage wiring (1C.3 S4 + env 1C.1), JWT (consumed from Phase 0 secrets), 3h time-box + health criteria + decision tree (1C.0 S3, 1C.3, 1C.6), Studio basic-auth (1C.5), auth fallback (1C.7) ✓. §10 1C ✓. §13 defer matrix → 1C.6 ✓.

**Placeholder scan:** `<kong>`/`<studio-port>`/`<pinned-tag>` = discover-at-execute (container names from `docker ps`, Supabase tag pinned at fetch); secret `${...}` = SOPS inject points. Compose = "fetch official + apply documented trims" (concrete service list to remove + exact env) rather than reproducing 400 stale lines — appropriate for infra.

**Consistency:** bucket `supabase-storage`, network `interlab-global`, postgres `postgres` db, Supavisor :6543 (app) vs direct (internal services, flagged), JWT/anon/service_role from `secrets/supabase.yaml` — consistent with 1A + spec §7.

**Deferred:** Realtime (excluded Phase 1) · internal-services-via-Supavisor (Phase 1.5) · ImgProxy (Phase 1.5).

---

## Execution Handoff
**Plan saved.** Time-boxed (3h, hard gate 1C.6). Per Path B, executed post-demo. **Next:** 1D (tools/ops + backup), 1E (verify/handover).
