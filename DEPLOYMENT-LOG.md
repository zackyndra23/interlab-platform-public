# Phase 1 Deployment Log — Interlab Global Infra

**Server:** `vps-lafayette-01` (51.79.146.14 / Tailscale 100.117.214.25) · **TZ:** UTC
**Path:** Path B — Phase 0 + 1A tonight → 6h sleep → 1B–1E post-demo.
**Demo:** 2026-05-26 ~19:00 (deadline ~16:00) — showcases DESIGN + existing system, NOT full cutover.

**Status legend:** ✅ verified · 🔄 in-progress · ⏳ pending (user/panel/manual) · ⏸️ paused (not yet run) · ❌ not done · ⚠️ caveat

> **Discipline note:** Entries marked ✅ are observed/verified facts. Anything not personally verified is ⏳/❌ — NOT marked done. (Gates 4/5 were initially marked aspirationally; corrected below.)

---

## Spec Revisions (audit)

### 2026-05-25 — Secret management: **Pilihan B** (drop SOPS → Coolify-native encrypted env)
**Decision (user-approved):** Abandon SOPS/age + git-stored secrets. Secrets live in **Coolify's encrypted env-var storage** (canonical), generated **just-in-time per deploy on the SERVER**, mirrored to `/root/.coolify-secrets-backup.txt` (chmod 600, never git) as personal working backup.
**Rationale:** solo operator + small business + Tailscale-locked admin ⇒ 2-layer (SOPS *and* Coolify) encryption is over-engineered. Guardrail = **Coolify volume backup (Phase 1D) must be 100% reliable + verified restore-able.**
**Consequences (supersede spec §5 / handoff Gate 4–5):**
- `.sops.yaml` + `secrets/*` **removed from repo**; `.gitignore` updated to ignore `secrets/` + `.sops.yaml`.
- Handoff Gate 4/5 semantics → "secrets in Coolify env at deploy time, no git storage."
- Phase 1A/1C steps "[LAPTOP] `sops -d` + paste" → **"[SERVER] generate inline (`openssl rand -base64 32`) + paste into Coolify env."**
- Secret logging rule: log **NAME + purpose + timestamp** only to this file — **never the value** (value → `/root/.coolify-secrets-backup.txt` + Coolify DB).
- CF token (fresh, post-revoke) pasted manually at **Task 1B** (DNS-01 resolver) → Coolify env + `/root` backup.
- Backup focus shift: Coolify volume backup elevated to must-verify-restorable (1D).

### 2026-05-25 — NOPASSWD sudo for `zaky` (execution-environment)
Drop-in `/etc/sudoers.d/zaky-nopasswd` (`visudo -c` OK, `sudo -n true` success). **Conscious trade-off:** solo-operator + Tailscale-locked admin + Phase 1B firewall about-to-tighten ⇒ accept blanket NOPASSWD for execution velocity. **Revisit Phase 1.5:** granular per-binary NOPASSWD if tighter posture wanted. Effect: agent runs root `[SERVER]` steps directly; per-task verify gate UNCHANGED (only the password-prompt friction removed).

### Plan-vs-reality deviations
1. **SOPS → Pilihan B** (Coolify-native env) — see above.
2. **apt mirror = `nova.clouds.archive.ubuntu.com`** (OVH cloud mirror), not `archive.ubuntu.com` that plan Task 0.2 Step-3 sed assumed. `plucky` still served (no EOL 404 yet on 2026-05-25) → **Step-3 repoint NOT triggered**; if it ever is, target `nova.clouds.archive.ubuntu.com` + `security.ubuntu.com` → `old-releases.ubuntu.com`.
3. DC = Singapore os-sgp2 (spec §0 said BHS/Canada). 4. Legacy count = 13 (spec said 7 sibyl). 5. journald via `.conf.d` drop-in. 6. THP unit `RemainAfterExit=yes`.
7. **Coolify install OWNS `/etc/docker/daemon.json` + restarts dockerd** → caused ~3–4min legacy outage (recovered); `live-restore` alone insufficient. daemon.json now = log-opts + Coolify `default-address-pools` + re-added `live-restore:true`.
8. **Deploy mechanism (tonight, user-approved):** postgres-global + minio-global = **direct `docker compose`** (agent-driven), NOT Coolify-managed. Rationale: infra rarely-changed, operator comfortable w/ docker, Phase 1D backup scripts layer-agnostic, speed post-incident. **App-layer (webapp/API) later = Coolify-managed** (spec intent preserved for frequently-deployed). Future: Coolify "Import existing Docker Compose" (Phase 1.5/2). **Secrets-B handling:** generate inline `openssl rand` → `/root/coolify-resources/<svc>/.env` (chmod 600 root:root) + mirror `/root/.coolify-secrets-backup.txt`; compose refs via `env_file`; values NEVER echoed to stdout (direct redirect). interlab-global registered in Coolify UI (1A.2 Step 2 ✅) for future app deploys.
9. **Supavisor deferred → Phase 1.5** (user-approved): plan had it in 1A; deferred — non-essential for dev, finicky env (SECRET_KEY_BASE/VAULT_ENC_KEY), surprise risk, zero app rework to add. **App connection = direct `postgres-global:5432` via `interlab_prod_app`** for dev + Phase 1. Migration trigger: >100 concurrent conns / production-load patterns. Effort: env port 5432→6543 + deploy Supavisor + tenant config.
10. **Supabase service-role passwords not auto-set under Mechanism B** (Phase 1C, T+~6min): dropping bundled `db` skipped `roles.sql` → `supabase_auth_admin`/`authenticator`/`supabase_storage_admin` had no usable password → auth/rest/storage crash-looped (28P01 SCRAM). **Fix:** `ALTER ROLE … PASSWORD` as `supabase_admin` (reserved roles need superuser; `postgres` rejected) → folded to `service-role-passwords.sql` (config-as-code, run after bootstrap on rebuild). **Lessons:** (a) verify auth via NETWORK path, not localhost (supabase pg_hba localhost=`trust` → false positive earlier); (b) `log_statement='ddl'` (supabase default) leaked the pw on the failed postgres attempt → log truncated, supabase_admin re-run used `log_statement='none'`; (c) storage healthcheck `localhost`→IPv6 `[::1]` but storage binds IPv4 only → changed to `127.0.0.1`.
11. **Phase 1D external-cred items deferred → Phase 1.5** (user-approved): Telegram bot + Sentry cloud project + B2/rclone-crypt + backup-script activation need external account setup (~30min manual) → non-blocking for "infra ready" + app integration. Backup scripts stay in repo ready-to-activate; 1E sandbox-restore drill validates the procedure using LOCAL backup (no off-site B2 needed yet). Also: **fail2ban re-scope** (sshd→no-op, target Traefik/Coolify logs) deferred to **1B** (coupled to proxy cutover + SSH Tailscale-lockdown; sshd jail still protects public :2223 until then).
12. **Phase 1B Traefik cutover deferred → Phase 1.5** (user-approved): `coolify-proxy` was **never deployed** — 1A.1 "held down" = held UNcreated (Coolify deploys its Traefik only when the server proxy is enabled via UI, which we skipped to avoid the manual-Traefik :80/:443 conflict). Atomic-swap premise (start coolify-proxy) invalid; real cutover = 5-step new setup (UI proxy create + acme transform + traefik_default attach + file-bridge + swap) — high-risk on live ingress for ZERO tonight benefit (no Coolify-managed apps yet; infra = Mechanism B + internal; manual Traefik serves all 10 legacy fine). **Trigger:** first webapp deployed as a Coolify app. **1.5 prereqs:** fresh snapshot · Coolify UI proxy enable · acme.json transform+resolver match · attach `traefik_default` · file-bridge (10 legacy + supabase) · atomic swap + per-domain validation. Manual Traefik untouched; retires 24h post-cutover.
12a. **`supabase.interlab-portal.com` public routing** rides along → 1.5. App reaches Supabase internally via `interlab-global` (`http://supabase-kong:8000`); no public route needed pre-app.
13. **Scope expansion** (user-approved): infra repo "HANYA infrastructure" → "infrastructure + app integration". Webapp consolidated into `apps/`. Executed as **A2-Direct** (not A2-Coolify — coolify-proxy absence #12 blocks Coolify-managed routing).
14. **Deep data integration deferred → Phase 1.6-pt2 / Phase 2**: webapp KEEPS isolated data stack (interlab-postgres:16 + redis + minio at `/home/zaky/data-stack`). NO migration to postgres-global/minio-global/Supabase (PG16→15.8 downgrade risk + demo-night). Approach A = repo/operational integration only.
15. **Hardcoded DB password** in webapp compose → externalized to `${DATABASE_URL}` (from `.env`) in the infra `docker-compose.yml` so no plaintext DB secret is committed. (Webapp repo original still has it = pre-existing; `DEMO_PASSWORD` default `Demo@22…` + placeholder `JWT_*` defaults remain in compose; full externalization = 1.6-pt2.)
16. **Phase 1.6 consolidation (Opsi 1a)**: webapp source copied → `apps/interlabs-crm-demo/`, re-deployed via direct compose from infra. Build **cache-hit** (source == running images → current code incl 2FA). Data stack separate + untouched; reference IaC at `apps/interlabs-crm-demo/data-stack-reference/` (NOT deployed-from). Webapp original repo `/opt/projects/interlabs-crm-demo` untouched = rollback ref.
17. **redis-global deployed (Phase 1.5)**: `redis:7.4-alpine` on interlab-global (Mechanism B), internal-only, auth + AOF, for **FUTURE apps**. **Existing webapp keeps `interlab-redis`** on interlab-data-net (deviation #14 data-layer separation preserved — NOT migrated).
18. **MinIO console accessibility fix + architecture clarification**: "root" login failed because MinIO uses the `MINIO_ROOT_USER` value, **not literal `root`**. Correct usernames: **minio-global = `mgroot_8c8e8edb`** (random-gen Phase 1A), **interlab-minio = `interlab_minio`** (webapp data-stack). Fix: (1) documented usernames in `access-guide.md`; (2) **exposed minio-global console via Tailscale `100.117.214.25:9101`** (was loopback-only → blocked admin) — verified 200, Supabase storage + bucket intact after recreate. **Architecture:** two independent MinIO servers by design (#8 hybrid: global vs isolated). User-requested "one console, superadmin sees all + project-scoped SA" = **Phase 1.6-pt2 merge (post-demo, #14)** — migrate webapp storage → minio-global + scoped SA + reroute public S3 URL. Demo state UNTOUCHED.
19. **postgres-global admin/DBeaver host port (`127.0.0.1:5440`)**: postgres-global had **no host port** (interlab-global net only) → DBeaver from the office PC errored. Added `ports: 127.0.0.1:5440:5432` to its compose (loopback only — reach via DBeaver SSH-tunnel `zaky@100.117.214.25:2223`; internal net keeps `postgres-global:5432`). Recreated — **healthy**, app dbs (`interlab_prod`/`interlab_staging`) intact, Supabase storage reconnected (200), `supabase_admin` login via 5440 OK, exact `DATABASE_URL` connects end-to-end. Centralized `.env`/`.env.example` gained a `POSTGRES_*` + `DATABASE_URL` block (user-added section) = postgres-global admin connection (`supabase_admin`/`postgres`/`5440`). interlab-postgres (live webapp DB) **NOT touched** (stays `127.0.0.1:5432`). Fixed `access-guide.md` §4 SSH-tunnel examples (were using non-resolvable container names → now `127.0.0.1:<host-port>`). **DEFERRED (user decision 2026-05-25):** wiring services to source credentials *directly* from the centralized `.env` (via `--env-file` + `${var}`) → Phase 1.5 post-demo — caveat: stateful init creds (`POSTGRES_PASSWORD`, `MINIO_ROOT_*`) are **bootstrap-only** (no live rotation on restart) + it changes the Pilihan B security posture (root-only `/root` envs → repo `.env`). The `POSTGRES_*` block in `.env`/`.env.example` is a **DBeaver connection descriptor only** (not wired to the container). **Added staging login (user request):** role `interlab_staging01` (LOGIN) **owns** new db `interlab_db_staging` on postgres-global (idempotent `CREATE ROLE`/`CREATE DATABASE` as `supabase_admin`; pw via stdin, never argv/echo). Verified login + ownership via 5440. Real pw lives in `.env` (`POSTGRES_PASSWORD`/`DATABASE_URL`) + mirrored to `/root/.coolify-secrets-backup.txt` (`interlab_staging01_password`); `.env.example` keys synced (placeholder only). This is a **fresh staging db** (separate from the empty `interlab_staging`/`interlab_prod`); webapp data still in interlab-postgres.

### 2026-05-25 — Centralized `.env` + `.env.example` (user request)
Repo `.env` (GITIGNORED, chmod 600) = operator master of all 18 creds, built from `/root/.coolify-secrets-backup.txt` (values never echoed). `.env.example` (COMMITTED) = synced 18-key reference w/ generation hints, no values. `.gitignore` already covers `.env`/`.env.*` with `!.env.example`. Verified: keys in sync, `.env` not staged.

---

## Pre-flight Gates (Tasks 0.0 / 0.1) + early read-only checks

Recorded `2026-05-25T07:19:34Z` (read-only server inspection; no mutation).

### Gate 1 / Task 0.0 — Disk type + admin access prerequisites
- **Disk type (authoritative = OVH panel):** ⏳ PENDING — paste OVH Manager → VPS → plan **Storage** field here. Committed default = **NVMe SSD** (non-blocking; flip `random_page_cost`/`effective_io_concurrency`/Sentry tier in 1A.0 only if panel shows non-NVMe).
  - Server context (NON-authoritative — `ROTA=1` is meaningless on virtio per spec §4): `sda` 200G, `sda1` 198.9G ext4 `/`; mount opts `rw,relatime,discard,errors=remount-ro,commit=30` (no `noatime` yet → Task 0.9); free **142G / 27% used**.
  - Baseline: Mem **22Gi** total / 17Gi available; **Swap 0B** (matches spec §1 → Task 0.6 adds 4G).
- **Domain (Gate #1):** ✅ `interlab-portal.com` — LOCKED (per spec/handoff).
- **Admin access:** Bitwarden ⏳ (user confirm) · laptop on Tailscale ✅ `intcomp229` **active** · phone on Tailscale ⚠️ `iphone-15-plus` **offline, last seen 4d ago** (see Gate 3).

### Gate 3 / Task 0.1 — OVH pre-deploy full-VM snapshot
- **⏸️ DEFERRED to 2026-05-26 morning** by user decision (energy budget post-SOPS-incident + snapshot not equally needed for all Phase 0 steps). **Tonight = reversible/non-system-level Phase 0 only**; snapshot taken tomorrow **before** any system-level mutation resumes (fstab/swap/mount/container-drop). Not a safety skip — a partial-tonight trade-off.
- **Snapshot ID + timestamp:** ⏳ to be taken + pasted tomorrow morning.
- OVH automated backup: ✅ skip / manual-only (per spec Gate #3).

### Gate 3 / Task 0.3 — Break-glass establishment
- **OVH KVM console responsive + reaches login prompt:** ⏳ PENDING (manual — user test in OVH Manager).
- **root password set (`passwd -S root` = `P`):** ⏳ PENDING — couldn't verify (sudo needs password non-interactively in agent session); user run `sudo passwd -S root`.
- **root password stored in Bitwarden:** ⏳ PENDING (manual).
- **sshd listener `:2223`:** ✅ LISTENING on `0.0.0.0:2223` + `[::]:2223` (IPv4+IPv6). ⚠️ currently all-interfaces — Tailscale-IP `ListenAddress` lockdown is **Phase 1B** (correctly not done yet).
- **SSH via Tailscale from laptop:** ⏳ PENDING explicit test (`intcomp229` is active on tailnet — likely the working host).
- **SSH via Tailscale from phone:** ⚠️ NOT verifiable now — `iphone-15-plus` **offline, last seen 4d ago**. Bring phone online + test before relying on phone break-glass. **Blocks Phase 1B SSH lockdown** (plan 0.3 Step 4: don't lock SSH in 1B unless laptop AND phone pass) — does NOT block Phase 0+1A tonight.
  - Tailnet peers seen: `vps-lafayette-01` (self) · `intcomp229` windows **active** · `iphone-15-plus` **offline 4d** · `laptop-46uq1qql` **offline 9h**.

### Gate 4 / Task 0.12 — age key + SOPS secrets  🔴→🟢 INCIDENT RESOLVED (plaintext purged; SOPS dropped per Pilihan B)
- ✅ `.sops.yaml` populated (age recipient `age1gaynn74l…`, no REPLACE placeholder).
- 🔴 **`secrets/{infrastructure,external-services,supabase}.yaml` committed + pushed to origin/main (commit `f617f69`) as PLAINTEXT — NOT SOPS-encrypted.** Verified `2026-05-25T07:3xZ`: 0× `ENC[AES256_GCM]`, 0× `sops:` metadata block, 0× age recipient in-file; sizes 488/51/251 B (consistent with raw YAML, not encrypted). `sops -e -i` evidently did not take effect (committed plaintext).
- **Exposed values** (now in GitLab remote history): postgres superuser_password + app_password; supavisor secret_key_base + vault_enc_key; minio root_user/root_password + storage_sa_key/secret; supabase jwt.secret + anon_key + service_role_key; dashboard username/password; **cloudflare api_token (DNS-edit scope, interlab-portal.com)**.
- **Blast radius:** none of these are DEPLOYED yet (Phase 0 not started) → DB/MinIO/Supabase/dashboard secrets are INERT once regenerated. **EXCEPTION: Cloudflare token is a live external credential → revoke + regenerate immediately (spec §5 T4: accidental exposure → immediate).**
- **Remediation (resolved path = Pilihan B, NOT re-encrypt):** (1) ✅ CF token revoked at Cloudflare (user, confirmed before prompt); (2) 🔄 git history rewrite to purge `f617f69`: backup `/opt/projects/interlab-global-pre-rewrite-1779695909` ✅ → `git reset --hard HEAD~1` (→ `e3976c3`) → remove `secrets/` + `.sops.yaml` → commit → user `git push --force-with-lease` → verify GitLab UI → `git gc --prune=now` on server; (3) no re-encryption — SOPS abandoned (see Spec Revision above); (4) leaked DB/MinIO/Supabase/dashboard values INERT (never deployed) — regenerated fresh just-in-time per deploy under Pilihan B.
- **Verified `f617f69` is the ONLY commit with secret values** (e1ac100 + e3976c3 carry only the harmless `.sops.yaml` placeholder) → HEAD~1 reset is sufficient; no filter-repo needed.

### Gate 5 — Cloudflare API token
- ✅ old token **revoked** at Cloudflare. Fresh token (edit-DNS scope, zone `interlab-portal.com`) to be pasted manually at **Task 1B** → Coolify env + `/root/.coolify-secrets-backup.txt`. No git storage (Pilihan B).

---

## Phase 0 — Prep & Safety

| Task | Description | Status | Notes |
|---|---|---|---|
| 0.0 | Pre-flight gates verification | ⏳ | disk/snapshot/admin pending above |
| 0.1 | OVH full-VM snapshot | ⏳ | snapshot ID pending |
| 0.2 | apt health pre-check (EOL repo) | ✅ | `apt-get update` EXIT=0, NO 404 (plucky still served by nova.clouds/security); Step 3 repoint NOT needed; `--reinstall ca-certificates` EXIT=0 → apt functional. ubuntu.sources backed up. |
| 0.3 | Break-glass establishment | ✅* | root pw SET (P, in Bitwarden); sshd:2223 ✅; laptop-SSH ✅ (this session). *KVM live-login + phone-SSH DEFERRED pre-1B (iPhone offline) |
| 0.4 | Preservation dumps | ✅ | exp: pg_dumpall 6KB + custom 3.8KB (pg_restore -l verified, notes=3 rows) + folder tarball 148KB. interlab-demo: DB 956KB/2db/130tbl + MinIO 234 files/16M (interlab-storage, public-assets). sibyl: DB 31KB/8tbl (sibyl schema) + MinIO EMPTY (no buckets). All in /var/backups/preservation/ |
| 0.4.5 | Drop experimental postgres-global | ✅ | container rm'd; vol pg_global_data→pg_global_data_old (46.3M, DELETE after signoff+7d); name + :25432 freed for 1A. Legacy 13 up (sibyl=200, interlab=307) |
| 0.5 | Pre-cutover hygiene | ✅ | admiring_mendeleev (node Redis-ping) + whoami-storage removed; sibyl worker logs 3.4M→0 (no restart); legacy 13, only traefik non-legacy |
| 0.6 | Tuning — swap 4G | ✅ | /swapfile 4G active + fstab persisted (fstab.bak saved) |
| 0.7 | Tuning — sysctl drop-in | ✅ | swappiness=10, overcommit=1, dirty 5/10, inotify 524288/512 |
| 0.8 | Tuning — persist THP=madvise | ✅ | disable-thp.service (RemainAfterExit), Result=success, active; THP=[madvise] |
| 0.9 | Tuning — noatime root | ✅ | fstab root +noatime, remount OK (rw,noatime,discard,…) |
| 0.10 | Docker daemon.json | ✅ | json-file 10m×3 + live-restore=true via **reload** (not restart); legacy 13 up, sibyl/interlab=200 |
| 0.11 | journald caps | ✅ | .conf.d drop-in 1G/100M/2G; restarted; usage 12.4M |
| 0.12 | SOPS/age init + generate secrets | ⏭️ SKIPPED | obsolete — Pilihan B (Coolify-native env, no SOPS) |
| 0.13 | Repo scaffold + config-as-code | ✅ | system-config/* mirrors host configs; coolify-resources/* + scripts/{recovery,deploy} + cron/ scaffolded; RECOVERY.md skeleton. No secrets/ (Pilihan B) |

## Phase 1A — Foundation (Mechanism B for infra; CORE-ONLY tonight)
| Task | Description | Status |
|---|---|---|
| 1A.0 | Disk-knob lock | ✅ NVMe → random_page_cost=1.1, eff_io=200 (no flip) |
| 1A.1 | Install Coolify + hold proxy + :8000 lockdown | ✅ v4.1.0; bundled proxy never bound 80/443; :8000 Tailscale-locked (DOCKER-USER); admin created (Bitwarden). ⚠️ caused legacy outage → recovered (deviation #7) |
| 1A.2 | Shared `interlab-global` network | ✅ 10.0.2.0/24 bridge; registered in Coolify UI |
| 1A.3 | postgres-global compose authored | ✅ Mechanism B; tuning via `-c` (preserves preload libs/substrate) |
| 1A.4 | Deploy postgres-global | ✅ supabase/postgres **15.8** healthy, mem 4G, on interlab-global; secret via /root/.env (600) |
| 1A.5 | App dbs interlab_prod/staging + roles | ✅ both dbs + 4 roles (owner/app login), vector 0.8.0 each, public schema hardened (PUBLIC revoked, app=USAGE), owner DDL+DML verified. Pws→/root. Fixed postgres-not-superuser via `GRANT owner TO postgres` before CREATE DATABASE |
| 1A.6 | WAL archiving verify | ✅ archived=1 failed=0; segment staged /var/backups/wal-stage |
| 1A.7 | Supavisor pooler | ⏸️ **DEFERRED → Phase 1.5** (deviation #9; non-essential for dev — app uses direct postgres:5432) |
| 1A.8 | Deploy minio-global | ✅ healthy; S3 :9000 internal-only; console loopback :9101; mc auth OK / 0 buckets |
| 1A.9 | Bucket `supabase-storage` + scoped SA | ✅ bucket (private) + SA `supabase-storage-sa` + policy supabase-storage-rw. Upload/download verified; **cross-bucket isolation verified** (SA denied ls/read other-bucket, can't create buckets). Creds→/root |
| 1A.10 | Foundation sign-off (CORE) | ✅ core signed off: postgres-global + app dbs + minio + bucket/SA. (Supavisor=1.5) |

## Phase 1C — Supabase (Mechanism B, trimmed) — brought forward to 2026-05-25 night
**T0 deploy 11:05Z** (3h gate 14:05Z — PASSED well within box). Trimmed self-host @c1276c8: KEPT kong/auth/rest/storage/meta/studio; DROPPED db (use postgres-global) / realtime / imgproxy / functions / analytics / vector / supavisor. All on `interlab-global`, direct to `postgres-global:5432` + storage→`minio-global:9000` (S3 backend via `supabase-storage-sa`, force_path_style, dummy region).

| Service | Image | Health (spec §7) |
|---|---|---|
| kong | kong:3.9.1 | ✅ healthy — gateway + key-auth (`/`=401) |
| auth (gotrue) | v2.186.0 | ✅ healthy — `/health` 200 + **signup smoke → access_token** |
| rest (postgrest) | v14.8 | ✅ Up — `/rest/v1/`=200 |
| storage | v1.48.26 | ✅ healthy — `/status` 200 + **bucket-create→MinIO OK** (fixed IPv4 healthcheck) |
| meta | v0.96.3 | ✅ healthy |
| studio | 2026.04.27 | ✅ healthy — kong basic-auth (401→307) |

**HEALTH GATE: PASSED** (all critical kong+gotrue+postgrest+storage functional). Secrets → `/root/coolify-resources/supabase/.env` (600); keys mirrored in `/root/.coolify-secrets-backup.txt` (supabase_jwt_secret/anon_key/service_role_key/dashboard_password/pg_meta_crypto/s3proto_*). Kong on `127.0.0.1:8002` (loopback). Smoke artifacts cleaned (auth.users=0, buckets=0). Fixed deviation #10 (service-role pw).
**⏸️ DEFERRED — public routing** `supabase.interlab-portal.com`: needs DNS record + cert. Manual traefik = TLS-ALPN (not wildcard) → would be a NEW LE request, not reuse → defer to 1B / app-setup. App reaches supabase internally via `interlab-global` (`http://supabase-kong:8000`).

## Phase 1D — Tools & Ops (no-cred items; rest → 1.5 per deviation #11)
- **Uptime Kuma** ✅ `louislam/uptime-kuma:1.23.16`, Tailscale-only `100.117.214.25:3001`, healthy. Admin first-boot + monitors = user UI (pre-1B gate).
- **Netdata** ✅ `netdata/netdata:v1.47.5`, Tailscale-only `100.117.214.25:19999`, **Cloud DISABLED** (cloud-enabled=False + DO_NOT_TRACK=1), dbengine cap 512MB (~3d ring buffer), pid:host.
- **fail2ban**: active (sshd jail protects public :2223). Re-scope → deferred to 1B (deviation #11).
- **DEFERRED → 1.5:** Telegram, Sentry, B2/rclone-crypt + backup activation (deviation #11).

## Phase 1B — Traefik cutover → DEFERRED Phase 1.5 (deviation #12). Manual Traefik remains the proxy (10 legacy domains served).

## Phase 1E — Verify & Sign-off (current working state)
- **E2E matrix ✅:** 10 legacy domains via manual Traefik all routed (200/307 healthy; api=404 + storage=403 = normal backend responses for unauth root, NOT Traefik errors); admin (Coolify/UptimeKuma/Netdata/MinIO-console) Tailscale-reachable; **DB path** interlab_prod_app SCRAM network login ✅; **Supabase E2E** auth/health+rest+storage 200 + **storage upload→MinIO→retrieve round-trip ✅**.
- **Sandbox restore drill ✅:** dump→restore→verify 100/100 rows, ~1s (procedure validated; off-site = 1.5). Logged in RECOVERY.md.
- **Census:** legacy 13/13 + traefik + supabase 6/6 + global 2/2 + coolify 4 + monitor 2/2. No regression.
- **Handover doc:** `docs/handover/app-team-phase1.md` ✅.
- ⏳ **Post-deploy OVH snapshot** ("Phase 1 baseline") = user panel action — paste ID + timestamp.

## 🏁 PHASE 1 SIGN-OFF — 2026-05-25
**Delivered:** Phase 0 (safety/tuning/config-as-code) · 1A core (Coolify + postgres-global PG15 + app dbs + minio-global + scoped SA) · 1C Supabase (kong/auth/rest/storage/meta/studio, direct-to-postgres, storage→MinIO) · 1D no-cred monitoring (Uptime Kuma + Netdata Tailscale-only) · 1E verify + restore drill. Centralized `.env`/`.env.example`. 12 deviations (+12a) all documented.
**Deferred → Phase 1.5:** Supavisor (#9) · external creds: Telegram/Sentry/B2-offsite (#11) · 1B Traefik cutover + supabase public routing (#12/#12a) · OS 26.04 LTS reinstall.
**Production:** 13 legacy containers healthy throughout (zero data loss; one recovered ~4min Coolify-install outage). Manual Traefik untouched.

## Phase 1.6 — App consolidation (Opsi 1a, 2026-05-25) — Approach A / A2-Direct
Webapp `interlabs-crm-demo` (interlab-api+app, **stateless**) consolidated into `apps/interlabs-crm-demo/`; data stack (postgres:16/redis/minio, separate project at `/home/zaky/data-stack`) **KEPT untouched**.
- **Copy:** rsync app source (6.5M; excluded `.git`/`.worktrees`-730M/`node_modules`/`.next`/nested-docs). Added `docker-compose.yml` (DB pw → `${DATABASE_URL}`), `.env` (gitignored), `.env.example` (committed), `data-stack-reference/` (IaC ref + README). Nested `.claude/` gitignored; `CLAUDE.md` kept.
- **Switch:** `docker rm -f interlab-api interlab-app` → `docker compose up -d --build` from infra. Build **cache-hit** (source == running images) → current code (2FA/reCaptcha/pwd-reset/profile). `migrate` skipped (029 already applied → no schema change), `seed` idempotent.
- **Verify:** routes app=307/api=404 (match baseline); **data integrity confirmed** (users=8/roles=8/migrations=29/role_permissions=245 = baseline → ZERO change); WS `/api/ws` attached (api log); **zero regression** (28 containers, no Traefik errors, sibyl=200); **browser smoke ✅** (login+reCaptcha+forgot-pwd+profile+2FA; Uptime Kuma app/api green).
- **Rollback ref (intact):** `cd /opt/projects/interlabs-crm-demo && docker compose -f docker-compose.demo.yml up -d`.
- **Deviations #13–#16** documented above. ⏳ Phase 1.6-pt2 (post-demo): data-stack deploy migration into `apps/` + decommission old webapp repo + full secret externalization.

## Phase 1.5 (partial) — redis-global + access guide + connectivity matrix (2026-05-25)
- **redis-global** `redis:7.4-alpine` deployed via Mechanism B (`coolify-resources/redis-global/`), on interlab-global, internal-only (no host port), `requirepass` + AOF, healthy. Auth ping PONG; reachable on interlab-global; no-auth rejected. Pw → `coolify-resources/redis-global/.env` (gitignored) + `/root` backup `redis_global_password` + centralized `.env`. **Deviation #17.** For future apps only — webapp keeps interlab-redis.
- **`docs/access-guide.md`** generated — operator reference (public / Tailscale admin / internal docker / SSH tunnels / monitoring / backup / common ops); commit-safe (Bitwarden + `/root` key refs only).
- **Connectivity matrix (verified all PASS):** public 10/10 routed (app=307/api=404/s3=403/200, sibyl 200); admin coolify=302/uptime=302/netdata=200; interlab-global postgres-global SCRAM=1 / redis-global PONG / supabase auth+rest+storage=200; webapp data stack postgres+redis+minio OK.
- ⏳ Uptime Kuma: add `redis-global` TCP 6379 monitor (user UI). Still deferred (#11): Telegram/Sentry/B2.

---

## Live timeline (append per task: timestamp · action · expected vs actual · anomaly)

- `2026-05-25T07:19Z` — Session resume. Read 4 docs (spec + Phase 0 + 1A + handoff). Confirmed running ON server `vps-lafayette-01` (Mode A: agent runs [SERVER], user runs [LAPTOP]/[MANUAL]).
- `2026-05-25T07:19Z` — Mismatch caught: Gates 4/5 marked aspirationally; repo confirms NOT done. **PAUSED server-side execution** at user request. User executing Gate 4/5 on laptop.
- `2026-05-25T07:19Z` — Read-only break-glass + disk + baseline checks recorded above. No server mutation performed.
- `2026-05-25T07:3xZ` — User signalled "SOPS ready". `git pull` → HEAD `f617f69`. Verified `.sops.yaml` populated ✅. **Verified secrets ARE PLAINTEXT, not encrypted 🔴** (0 ENC/sops markers, tiny sizes). **STOPPED — security incident logged (Gate 4 above). Task 0.2 NOT started.** Awaiting laptop remediation (CF revoke + regenerate + real encrypt + history purge + force-push).
- ⚠️ Also: user's "SOPS ready" paste left disk type / snapshot ID / timestamp as literal `<…>` placeholders — actual values still PENDING.
- `2026-05-25T07:5xZ` — **Spec revision Pilihan B approved** (drop SOPS → Coolify-native env; see Spec Revisions). CF token revoked ✅. Incident remediation begun: backup taken, pre-state verified (HEAD `f617f69`, reset target `e3976c3`, `f617f69` = sole secret-bearing commit).
- `2026-05-25T08:0xZ` — Purge executed (user "iya"): `reset --hard HEAD~1` → commit `045d217` (del `.sops.yaml`, gitignore `secrets/`+`.sops.yaml`, add this log). GitLab force-push initially blocked (protected branch) → user temporarily allowed force-push, pushed, re-protected.
- `2026-05-25T08:0xZ` — **🟢 INCIDENT RESOLVED.** Verified `origin/main = 045d217` & `f617f69` not in origin history; `f617f69` purged from local `.git` (reflog expire + `gc --prune=now`); plaintext backup dir deleted. (GitLab Housekeeping to fully drop orphaned SHA = user optional.)
- `2026-05-25T08:1xZ` — **Tonight scope revised (user):** OVH snapshot deferred to tomorrow AM. Tonight = reversible/non-system-level Phase 0 only. HARD STOP before first of: fstab/swap/mount change, container drop/destroy (incl 0.4.5), or anything destructive/needs-snapshot. Tomorrow: snapshot → resume from STOP → Phase 1A before demo 19:00.
- `2026-05-25T08:2xZ` — NOPASSWD sudo granted for `zaky` (see Spec Revisions). **Task 0.2 COMPLETE:** Step1 backup ✅ · Step2 `apt-get update` EXIT=0 no-404 ✅ · Step3 repoint skipped (not needed) · Step4 `--reinstall ca-certificates` EXIT=0 ✅. apt NOT unrecoverable → no phase-STOP. **STOPPED for review before Task 0.3.**
- `2026-05-25T09:2xZ` — **Tasks 0.3 / 0.4 / 0.4.5 done** (full-send mode, snapshot insurance active). 0.3 break-glass: root pw restored (P → Bitwarden), laptop-SSH = this session; KVM-live + phone deferred pre-1B. 0.4 preservation: all DB dumps + MinIO mirrors verified (table). 0.4.5: experiment dropped, volume→`_old` (46.3M preserved), name/volume/:25432 freed.
- **Deviation #4 (count):** actual legacy = **13** (8 sibyl + 5 interlab); spec §1 said 7 sibyl. Undercount, no regression — only the experiment + (next) stray/test containers removed.
- `2026-05-25T09:3xZ` — **Tasks 0.5–0.11 + 0.13 done** (auto-proceed, snapshot insurance active): hygiene (stray/test rm + worker-log truncate), swap 4G, sysctl, THP-persist, noatime, daemon.json (reload), journald caps, repo scaffold + config-as-code mirror + RECOVERY.md skeleton. 0.12 skipped (Pilihan B). Legacy 13 healthy throughout (sibyl/interlab=200).
- **🎉 PHASE 0 COMPLETE** — server at safe/tuned/recoverable baseline. Milestone → propose commit (await "iya"), then Phase 1A.
- `2026-05-25T09:30Z` — Phase 0 committed `2188ba0`, pushed.
- `2026-05-25T09:35Z` — **🔴 INCIDENT (recovered): Coolify install caused ~3–4 min legacy outage.** 1A.1 Step 2 ran `coolify install` (v4.1.0, EXIT=0) which **overwrote `/etc/docker/daemon.json`** (dropped our `live-restore:true`, added `default-address-pools 10.0.0.0/8`) **and restarted dockerd** (09:35:25Z). Despite restart policies + prior live-restore, the **13 legacy containers Exited and did not auto-restart** (likely address-pool change during the live-restore→off transition). Sibyl (active users) + interlab down.
- `2026-05-25T09:38Z` — **Recovery:** `docker start` all 13 (data layer → app layer); came up healthy; sibyl=200 after healthchecks passed (traefik withholds routing until healthy → transient 404). coolify-proxy never bound (manual traefik held 80/443). :8000 locked to Tailscale (DOCKER-USER drop). 
- `2026-05-25T09:40Z` — daemon.json **fixed**: re-added `live-restore:true` (kept Coolify's `default-address-pools` + log-opts) via **reload** (non-disruptive); verified live-restore=true. All legacy `unless-stopped` (traefik `always`). **STABLE.**
- **Deviation #7 (important for RECOVERY.md):** Coolify installer OWNS `/etc/docker/daemon.json` + restarts dockerd → live-restore alone does NOT protect legacy across the install. Mitigation next time: pre-merge `default-address-pools` into daemon.json BEFORE install, or stop-with-intent / accept brief outage. **1A.1 status:** Coolify v4.1.0 up (coolify/db/redis/realtime healthy), bundled proxy held down, :8000 Tailscale-locked. **PENDING: first-boot admin (Step 6, your browser).**
- `2026-05-25T10:00Z` — User decision: continue, **Mechanism B** (direct compose) + **core-only**. Coolify admin created (Bitwarden); interlab-global net created + registered in Coolify UI.
- `2026-05-25T10:06Z` — **postgres-global UP** (supabase/postgres 15.8). Tuning via `-c` overrides — **preserved `shared_preload_libraries`** (avoided breaking substrate; key catch vs plan's config_file replacement). Substrate roles (8) + extensions (vector/pg_cron/vault) verified; WAL archiving verified (archived=1/failed=0, staged on host). Secret → /root/coolify-resources/postgres-global/.env.
- `2026-05-25T10:1xZ` — **minio-global UP** (pinned RELEASE.2025-09-07). S3 :9000 internal-only (NOT host-published), console loopback :9101, mc auth OK / 0 buckets. Secret → /root/coolify-resources/minio-global/.env.
- **🎉 PHASE 1A CORE COMPLETE** (postgres-global + minio-global). Legacy 13 healthy throughout. **DEFERRED to tomorrow AM:** 1A.5 app dbs, 1A.7 Supavisor, 1A.9 bucket/SA, full 1A sign-off → then 1C Supabase.
- `2026-05-25T10:4xZ` — **1A.5 done** (app dbs+roles+vector+hardening; fixed postgres-not-superuser membership). **1A.7 Supavisor → deferred Phase 1.5 (deviation #9).** **1A.9 done** (supabase-storage bucket + scoped SA; cross-bucket isolation verified). **1C Supabase confirmed = tomorrow** (not pulled into tonight).
- **🎉 PHASE 1A CORE FOUNDATION COMPLETE.** Tonight: Coolify + postgres-global (PG15 substrate+tuning+WAL+app dbs+pgvector) + minio-global (+supabase-storage bucket + scoped SA). Legacy 13 healthy throughout.

---

## 🌙 STATE CAPTURE — resume tomorrow 2026-05-26 ~08:00 WIB
**Up & healthy:** Coolify v4.1.0 (:8000 Tailscale-locked, admin in Bitwarden) · postgres-global (supabase/postgres 15.8, container, mem 4G, WAL→/var/backups/wal-stage) · minio-global (S3 internal-only, console 127.0.0.1:9101) · 13 legacy (manual Traefik still owns 80/443).
**DBs:** `postgres` (substrate: supabase roles+extensions) · `interlab_prod` + `interlab_staging` (owner+app roles, vector, hardened) · `_supavisor` NOT created (Supavisor deferred).
**Secrets:** all in `/root/.coolify-secrets-backup.txt` (chmod 600) + per-svc `/root/coolify-resources/<svc>/.env`. Keys: coolify_admin_*, postgres_global_superuser_password, minio_global_root_*, minio_storage_sa_*, interlab_{prod,staging}_{owner,app}_password.
**Deferred:** Supavisor→1.5 · 1B Traefik cutover→post-demo · phone Tailscale SSH→pre-1B.
**Tomorrow plan:** optional fresh snapshot → **1C Supabase** (JWT gen → Kong → GoTrue → PostgREST → Storage; all direct to `postgres-global:5432`; storage via `supabase-storage-sa` + `http://minio-global:9000`, `GLOBAL_S3_FORCE_PATH_STYLE=true`) → target <13:00 WIB → demo prep 14–16:00 → demo 19:00.
**⚠️ Tomorrow gotchas:** Coolify-install-overwrites-daemon.json lesson (deviation #7) — no docker restarts; postgres `postgres` role ≠ superuser (use membership grants / supabase_admin for superuser ops); secrets generated inline never echoed.
- _(next: milestone commit → STOP for night)_
