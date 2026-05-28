# Interlab Global Infrastructure — Implementation Design Spec

- **Tanggal:** 2026-05-25
- **Penulis:** Zaky (data scientist & AI engineer) + brainstorm Claude
- **Status:** Approved for planning → handover ke `/superpowers:write-plan`
- **Server:** OVH VPS `vps-lafayette-01` (51.79.146.14 / 2402:1f00:8000:800::3153), region BHS (Canada)
- **Scope:** Foundational self-hosted shared infrastructure untuk multiple internal webapps Interlab Sentra Solusi Indonesia. Reusable lintas app (Interlab webapp sekarang, app lain ke depan).
- **Approach:** INFRA-FIRST — infra solid dulu (~24 jam: 16h kerja + 6h tidur + 2h buffer) sebelum integrasi app yang sudah jalan.

> Spec ini = **architecture + decisions + risk + phase boundary + ordered steps**, BUKAN command-by-command. Eksekusi server dilakukan via `/superpowers:write-plan` → `/superpowers:execute-plan`. **NO server modification dilakukan saat brainstorm ini** (semua temuan dari inspeksi read-only).

---

## 0. Locked Decisions (jangan re-litigate)

**Stack:** Self-hosted everything (data sovereignty mutlak — finance/tax) · single server OVH Phase 1 · Coolify (BUKAN K8s/Swarm) · PostgreSQL via image `supabase/postgres` · MinIO sebagai Storage backend Supabase · Auth GoTrue (BUKAN Clerk/Auth0) · Sentry **cloud** Phase 1 (self-host eval Phase 1.5) · Uptime Kuma · Netdata (metrics) · Cloudflare DNS · Tailscale admin · GitHub Flow · dev(laptop)+staging+prod via Coolify.

**Reverse proxy:** Coolify-managed Traefik = **SINGLE SOURCE OF TRUTH**. Manual Traefik di-decommission. Cert Let's Encrypt existing di-preserve. Rollback <15 menit.

**Naming:** `coolify`, `postgres-global`, `minio-global`, `supabase-global`, `sentry-global`(defer), `uptime-kuma-global`.

**Anti-goals:** K8s/Swarm/service-mesh · Supabase Cloud/RDS/S3-AWS · Grafana/Loki/Prometheus full stack Phase 1 · microservices split · Clerk/Auth0 · VPN custom (pakai Tailscale) · ganti fail2ban · dua reverse proxy · push past time-box · skip tidur.

### Deviasi dari asumsi awal brief (3, semua justified)
1. **Off-site backup automation → IN Phase 1** (brief asumsi defer). RPO finance/tax menuntut WAL archiving + B2 sejak hari-1; WAL = capability minimum, ergonomic defer.
2. **Sentry → cloud-default, BUKAN time-boxed** (brief asumsi self-host 2h time-box). Resource math (~30 container, 4–8 GB) override aspiration; self-host re-eval Phase 1.5 di VPS terpisah.
3. **Netdata → IN Phase 1** (brief "disiplin reminder / defer"). Unknown bertumpuk (tipe disk, memory-limit estimate, WAL accumulation) butuh visibility, dengan guardrail disiplin.

---

## 1. Current State Server (TIDAK clean slate) — inventory tervalidasi

**HW/OS:** 8 vCPU Intel Haswell (no TSX) · 22 GB RAM (~17 GB available, buff/cache reclaimable) · **Swap 0** · 200 GB disk (49 GB used, 144 GB free) · **Ubuntu 25.04 (EOL Jan 2026 — sudah lewat!)** · kernel 6.14 · KVM/OpenStack · TZ UTC.

**Sudah terpasang:** Docker 29.2 · Compose v5 · Git 2.48 · fail2ban (running) · Tailscale (100.117.214.25, running) · SSH port 2223 · containerd. **Tidak ada:** Node, nginx, Caddy, ufw, `/etc/docker/daemon.json` (→ log json-file UNLIMITED), firewall (`nft` ruleset kosong).

**Workload berjalan (validated via `docker ps`/`inspect`):**
- **Manual Traefik v3.6.1** — port 80/443/**8080**; provider = Docker label (`exposedbydefault=false`); challenge TLS-ALPN; resolver `myresolver`; cert store bind `/home/zaky/traefik/letsencrypt/acme.json` (600, root) berisi **8 cert** (sibyl cert sudah bundle `www`+`dashboard` sebagai SAN). ⚠️ **`--api.insecure=true` di `:8080` public** = lubang aktif (mati saat decom).
- **Sibyl** (7 ctr, active users): frontend/api healthy; **worker-ai & worker-default crash-loop** (`restarts=579`, root cause `redis:16379 connection refused` — bug connstring internal Sibyl, **out of scope**); scheduler unhealthy. Aktual mem total **~1.2 GB**. Semua ber-memory-limit ✅.
- **Interlab CRM demo** (5 ctr): app/api/postgres/redis/minio. **UNLIMITED memory** (semua, tapi decom-target). Aktual ~0.4 GB.
- **postgres-global eksperimen** (`postgres:17-alpine`, Tailscale :25432): hanya `mydb_vps` (1 tabel, 7.6 MB), **0 koneksi klien**. Image vanilla = **TIDAK punya pgvector** (README confirm). → drop. Punya `postgresql.conf` tuned + `01-bootstrap.sql.tpl` (pola least-privilege bagus, carry-over).
- **`admiring_mendeleev`** (node:20): leftover Redis-ping one-liner dari worktree, running sejak 2 Mei. → stop+rm (hygiene).
- **`whoami-storage`** (traefik/whoami): test only. → drop.

**Tailscale tailnet:** vps (100.117.214.25), workstation `intcomp229` (active), iphone (offline).

---

## 2. Final Architecture (Success Criteria #2)

### Network boundary

```
                       INTERNET (Cloudflare DNS-only / grey cloud)
                                     │  :80/:443
                          ┌──────────▼───────────┐
                          │  Coolify Traefik      │  (SINGLE SOURCE OF TRUTH)
                          │  acme.json (preserved)│  TLS termination
                          └──┬─────────┬──────────┘
            ┌────────────────┘         │          └───────────────┐
   Docker label provider        file-provider bridge        Docker label
   (Coolify-managed)            (legacy, zero-touch)         (Coolify-managed)
            │                          │                            │
   ┌────────▼─────────┐     ┌──────────▼───────────┐      ┌─────────▼────────┐
   │ app.<domain>     │     │ sibyl.* (7 routes)    │      │ supabase.<domain>│
   │ staging.<domain> │     │ interlab demo routes  │      │  → Kong gateway  │
   │ (Next.js monolith)│    │ (existing containers) │      └─────────┬────────┘
   └──────────────────┘     └───────────────────────┘                │
                                                          ┌───────────▼─────────────┐
                                                          │ GoTrue · PostgREST ·     │
                                                          │ Storage · (Studio bonus) │
                                                          └───────────┬──────────────┘
   ══════════════════════════ INTERNAL DOCKER NETWORK ═══════════════│══════════════
   ┌─────────────────┐   ┌──────────────────┐   ┌─────────────────┐  │
   │ postgres-global │◄──┤ Supavisor pooler │◄──┴──(txn/session)───┘  │
   │ (supabase/pg)   │   └──────────────────┘                        │
   │ +pgvector       │   ┌─────────────────────────────────────────┐ │
   └─────────────────┘   │ minio-global (S3 API internal-only) ◄────┘ │ Storage→MinIO
                         └─────────────────────────────────────────┘
   ══════════════════════════ TAILSCALE-ONLY (100.117.214.25) ════════════════════
   Coolify UI :8000 · Supabase Studio · MinIO Console · Uptime Kuma · Netdata :19999
   + SSH :2223 (Tailscale CIDR only) + break-glass: OVH KVM console
```

### Subdomain mapping (final; `<domain>` = `interlab-portal.com` — **LOCKED** per Gate #1: satu-satunya domain dimiliki, no alternative)

| Subdomain | Target | Boundary |
|---|---|---|
| `app.interlab-portal.com` | Interlab webapp fullstack (Next.js: FE + `/api/*` BFF) | 🌐 Public 80/443 |
| `staging.interlab-portal.com` | webapp staging | 🌐 Public 80/443 |
| `supabase.interlab-portal.com` | Kong → GoTrue + PostgREST + Storage | 🌐 Public 80/443 |
| `www.app.interlab-portal.com` | → 301 → `app.` | 🌐 Public (redirect) |
| `sibyl.bisikan.app` (+www,dashboard,api,storage,s3-minio) | legacy via file-bridge | 🌐 Public (unchanged) |
| `app/api/s3-*/s3-storage.interlab-portal.com` (demo) | legacy via file-bridge | 🌐 Public (sampai decom) |
| Coolify UI `:8000` · Supabase Studio · MinIO Console · Uptime Kuma · Netdata | admin | 🔒 Tailscale IP + MagicDNS, HTTP-over-tailnet (Tailscale Serve kalau feature break) |
| MinIO **S3 API** | Supabase Storage backend | 🔫 Internal Docker net only |

**App architecture (working assumption):** monolith Next.js fullstack. Business logic finance/tax (tax calc, workflow approval, SLA working-day, audit middleware, report gen) di `/api/*` + server actions. **Data access Pattern B** (FE→Next.js→Supabase; RLS = second line, bukan primary; GoTrue login browser-direct). Trigger revisit→split + `api.<domain>`: ops >30s · heavy-CPU · mobile/3rd-party API <6bln · tim FE/BE split formal. **Phase 2:** `worker.<domain>` (internal-only, BullMQ/scheduled) = expected addition.

---

## 3. Resource Allocation (Success Criteria #3) — total ≤ 22 GB / 8 vCPU

Validated baseline: usage container existing aktual ~1.6 GB; available ~17 GB. Single shared Postgres (Opsi A) menghemat ~3–4 GB vs dua instance.

### RAM — steady-state (Interlab demo decom, Sibyl present, Supabase up, Realtime excluded)

| Komponen | Limit | Reasoning |
|---|---|---|
| System (OS, dockerd, tailscale, fail2ban) | ~1.5 GB | non-container |
| Sibyl stack (7 ctr, pre-consolidation) | ~2.0 GB | aktual 1.2 GB + margin; zero-touch Phase 1 |
| Coolify (app+db+redis+realtime+Traefik) | ~1.5 GB | control plane |
| **postgres-global** (supabase/postgres, shared) | **~4.0 GB** | `shared_buffers` 1.5 GB + conn + maint + cache |
| minio-global | ~1.0 GB | scale w/ transfer |
| Supabase services (kong/gotrue/postgrest/storage/studio/meta; **Realtime❌ analytics❌ functions❌ vector❌ imgproxy❌**) | ~1.7 GB | (Realtime exclusion hemat ~300 MB) |
| Uptime Kuma | ~0.25 GB | |
| Netdata | ~0.15 GB | ring buffer 1–3 hari |
| Interlab webapp prod | ~1.0 GB | pasca-infra |
| Interlab webapp staging | ~0.75 GB | pasca-infra |
| Sentry | **0** | → cloud |
| **Subtotal** | **~13.85 GB** | **headroom ~8.1 GB** ✅ |

Headroom untuk page cache, build jobs Coolify, spike, transition (demo+legacy unlimited sementara ~0.4 GB).

### CPU (8 vCPU)
- Tanpa hard-pin runtime; **memory limit** (bukan CPU limit) di tiap service. cgroup fair-share.
- **Coolify build: max 2 concurrent, `--cpus=4`/build** → reserve 4 vCPU runtime.

### Disk (144 GB free) — budget
OS/container/image ~30 GB · Postgres data ~30 GB ceiling · MinIO objects ~40 GB ceiling · local backup retention ~30 GB · buffer ~14 GB. **Alert 80% (~115 GB) → escalate.** Growth utama = MinIO + WAL. Wajib docker image/build-cache prune policy.

---

## 4. System Tuning Checklist (Success Criteria #6)

> ⚠️ **`lsblk ROTA=1` di VPS = NO INFORMATION** (virtio default rotational=1 terlepas backend NVMe/HDD). **JANGAN** pakai sinyal ini untuk justifikasi tuning. Authoritative = OVH plan spec. Commit **NVMe SSD profile** (prior strong: OVH discontinue HDD VPS bertahun lalu; profil 8vCPU/22GB/200GB = tier NVMe). Verifikasi async (pre-flight).

### sysctl + swap + limits

| Knob | Current | Target | Alasan |
|---|---|---|---|
| Swap | 0 | **4 GB swapfile** | OOM safety-valve (lindungi Postgres dari OOM-killer) |
| `vm.swappiness` | 60 | **10** | swap hanya saat tekanan nyata |
| `vm.dirty_background_ratio` / `vm.dirty_ratio` | 10/20 | **5/10** | kurangi writeback burst |
| `vm.overcommit_memory` | 0 | **1** | Redis mandate (BGSAVE fork); aman karena **semua container ber-memory-limit** |
| `net.core.somaxconn` / `fs.file-max` / `kernel.shmmax` | 4096 / huge / huge | **keep** | sudah memadai |
| `fs.inotify.max_user_watches` | 184930 | **524288** | Coolify Node build |
| `fs.inotify.max_user_instances` | 128 | **512** | idem |
| nofile (ulimit) | host tinggi | **per-container `nofile=65536`** (postgres/minio/supabase via Coolify) | host tak disentuh |
| Transparent Huge Pages | `madvise` (sudah baik) | **persist madvise via systemd unit** | THP compaction = latency spike random (distinct dari Postgres `huge_pages=try`) |
| mount root | `relatime,discard` | **+`noatime`** (fstab + remount) | gain marginal (sudah relatime), zero-risk; semua data di sda1, no separate volume |
| Timezone | UTC | **host UTC + Postgres `timezone=UTC` (storage) + `log_timezone=Asia/Jakarta`** | storage portable lintas-region; log readable utk tim ID |

Defer Phase 1.5: `net.ipv4.tcp_tw_reuse` (kalau workload outbound signal); pre-alloc `vm.nr_hugepages`.

### Docker daemon (`/etc/docker/daemon.json`) — apply sebelum deploy stack
```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" }, "live-restore": true }
```
Cap 30 MB/container (json-file supaya Coolify UI viewer jalan); `live-restore` = container survive docker restart. Restart docker sekali di maintenance window. Berlaku container baru/recreated; Sibyl/Interlab existing tetap unbounded sampai recreate.

### journald (`/etc/systemd/journald.conf`)
`SystemMaxUse=1G` + `SystemMaxFileSize=100M` + `SystemKeepFree=2G` (3-layer).

### postgres-global tuning (HDD-safe / SSD-fine; scaled ke budget 4 GB)
Carry-over dari eksperimen: `password_encryption=scram-sha-256`, logging (`log_min_duration_statement=1000`, `log_connections/disconnections`, `log_line_prefix`). Pola bootstrap least-privilege (`NOSUPERUSER CREATEDB CREATEROLE`, `REVOKE CONNECT/ALL FROM PUBLIC`) di-adaptasi ke supabase/postgres + per-DB isolation.
```
shared_buffers = 1536MB          effective_cache_size = 6GB
work_mem = 16MB                  maintenance_work_mem = 512MB
max_connections = 200            # ceiling; actual diatur Supavisor
random_page_cost = 1.1           effective_io_concurrency = 200   # NVMe profile
max_wal_size = 4GB               min_wal_size = 1GB
checkpoint_completion_target = 0.9   checkpoint_timeout = 15min
wal_compression = on             synchronous_commit = on          # finance/tax: WAJIB
huge_pages = try                 # graceful fallback; pre-alloc defer 1.5
archive_mode = on                archive_command = '<scripts/backup/postgres-wal-archive.sh %p %f>'
```
**Ternary disk fallback** (kalau OVH panel ungkap bukan NVMe): NVMe = 1.1/200 (committed) · SATA SSD legacy = 1.5/100 · HDD = 4/2 + Sentry tetap cloud + flag MinIO dedicated volume Phase 2. "Bukan NVMe ≠ HDD".

**Connection pooling (Supavisor):** PostgREST/Storage → **transaction pool** (:6543); GoTrue → **session pool**; Realtime (kalau nanti) → direct (LISTEN/NOTIFY incompatible pool). Per-service quota di pooler, bukan di `max_connections`.

**Per-database isolation:** `interlab_prod`, `interlab_staging`, `sibyl` (post-consolidation), `_supabase` — masing-masing owner role sendiri, no cross-DB access. App connect via dedicated app role (bukan superuser).

---

## 5. Security & Access

### Firewall (Q9) — break-glass prereq WAJIB sequential SEBELUM apply
1. Test OVH KVM console responsive + root login works.
2. Verify `passwd -S root` = `P`; simpan root password di Bitwarden.
3. Harden `sshd_config`: `ListenAddress` = Tailscale IP + 127.0.0.1 (defense-in-depth — tak listen public bahkan kalau firewall gagal). Verify `ss -tlnp | grep 2223`.
4. Test SSH via Tailscale dari **laptop + mobile**.
5. **Baru** apply firewall.

**Insight:** Docker bypass ufw (DNAT di chain sendiri). Titik filter benar = `DOCKER-USER`.
- **nftables** `/etc/nftables.conf` (family `inet`, IPv4+IPv6 — cover `2402:1f00:...`): INPUT allow loopback + established/related; allow `tailscale0` penuh; allow `tcp/80,443` any; `tcp/2223` **hanya CIDR Tailscale `100.64.0.0/10`**; drop sisanya. Log-drop rate-limit 5/min.
- **`DOCKER-USER`** via `iptables -I` (iptables-nft backend) + iptables-persistent; **ip6tables untuk v6**. Drop ingress published port kecuali 80/443; **explicit drop Coolify `:8000` + Netdata `:19999` dari external**.
- Persist: `nftables.service` + iptables-persistent. **Versioning:** `nftables.conf` + `rules.v4`/`v6` commit ke repo.
- **fail2ban re-scope:** sshd jail no-op (Tailscale-only) → re-target Traefik access log + Coolify auth log.
- Defer 1.5: Tailscale ACL (restrict node SSH), OVH Network Firewall (provider-level).

### Access boundary (Q10)
Tailscale-only delivery = **bind ke Tailscale IP + MagicDNS, no public DNS untuk admin**. TLS hybrid: default HTTP-over-tailnet (Coolify/Uptime/MinIO Console/Netdata); Studio start HTTP → escalate Tailscale Serve kalau clipboard/WebAuthn break; batch-migrate Phase 1.5. Cloudflare Access defer 1.5 (sharing admin ke vendor/auditor non-Tailscale). **DNS posture:** Cloudflare DNS-only (grey cloud); Traefik TLS termination; wildcard `*.interlab-portal.com` via Let's Encrypt **DNS-01** (Cloudflare); Sibyl `*.bisikan.app` cert terpisah preserve. **TTL:** public app 60s, admin 300s+. CF proxy/WAF eval 1.5 (trade-off DDoS/WAF vs visibility finance/tax).

### Secret management (Q11) — Opsi A: Coolify env (live) + SOPS/age (durable) + Bitwarden (root)
- **age key handling:** Primary = Bitwarden; working = laptop `~/.config/sops/age/keys.txt` (**BUKAN server**); DR = hard-copy offline (sealed envelope). Anti-pattern: age key di server yang sama dengan SOPS files = SKIP.
- **Workflow Phase 1:** manual deploy dari laptop — decrypt lokal → push env ke Coolify via API/UI. Phase 1.5 eval auto-decrypt (convenience vs principle).
- **Inventory (5 file, SOPS-encrypted, commit ke repo):**
  - `secrets/infrastructure.yaml`: Postgres superuser + per-app role pw, MinIO root + bucket SA keys, Coolify APP_KEY + root pw, Tailscale auth key
  - `secrets/supabase.yaml`: JWT signing secret, anon key, service_role key, dashboard pw, internal db roles (supabase_admin/authenticator/…)
  - `secrets/external-services.yaml`: Cloudflare API token (DNS-01), Sentry DSN, SMTP key, OVH API, **backup destination creds (B2 + rclone-crypt key)**
  - `secrets/apps/{interlab-prod,interlab-staging,sibyl}.yaml`: per-env app secrets
  - `secrets/bootstrap.yaml`: root OS password (break-glass), SSH deploy keys
- **Rotation tiered:** T1 (annual+trigger) external API/Sentry/backup creds · T2 (180d+trigger) per-app DB role, MinIO bucket keys, Coolify users · T3 (90d+trigger) Postgres superuser, MinIO root, Supabase service_role + JWT signing secret · T4 (immediate) accidental exposure. Force-triggers: leaver, suspected compromise, CVE affecting secret-tool, post-incident. Generate **fresh** semua secret kritikal saat deploy (jangan warisi dari setup EOL/eksperimen). Automated rotation defer Phase 2.
- **Note:** age key (SOPS) **independent** dari rclone-crypt key (backup encryption) — 2 key terpisah, jangan reuse.

### Sentry compliance (cloud Phase 1) — MANDATORY, bukan optional
`beforeSend` SDK filter strip PII: email, NIK, NPWP, salary. **Exclude modul finance/tax dari capture.** Compliance checklist masuk deliverable. Trade-off eksplisit: cloud berkonflik dengan "self-hosted everything" → mitigasi PII-strip; Phase 1.5 eval self-host di VPS terpisah (€5–10/mo) kalau scaling layak.

---

## 6. Migration Cutover Plan (Success Criteria #1)

### Topology: Opsi 1 — File-provider bridge (zero-touch legacy)
Coolify Traefik tambah **`file` provider** (1 dynamic config) yang define router+service nunjuk ke container Sibyl/Interlab existing via Docker network — **tanpa sentuh container legacy**. Service Coolify-managed baru tetap via Docker label provider. Dua mekanisme routing sementara = isolation bagus Phase 1.

### SSL cert preservation
acme.json di-keyed by **resolver name**. Strategi: copy `/home/zaky/traefik/letsencrypt/acme.json` → Coolify acme.json (`/data/coolify/proxy/acme.json`), **rename top-level key `myresolver` → resolver Coolify**. 8 cert kebawa (cert entry resolver-agnostic; challenge type di static config, hanya relevan saat renewal). **Verify NotAfter** tiap cert (buffer sampai expiry kalau preservation imperfect — bukan immediate rate-limit risk). SSL migration = **1h time-box**; kalau Let's Encrypt rate-limit kena → defer per-domain.

### Domain migration order: Interlab-demo CANARY → Sibyl
Interlab demo dulu (low-stakes, mau diganti) → validasi cert preservation + Coolify Traefik benar serve → baru Sibyl (active users) setelah mekanisme terbukti. Target blackout <30 menit/domain (Sibyl), demo boleh lebih lama.

### Rollback <15 menit
Stop Coolify Traefik → start manual Traefik (image + bind mount `/home/zaky/traefik/` utuh, belum disentuh). Trivial karena legacy container zero-touch. (Decision tree per-phase di §11.)

### Sibyl strategy (Q2)
Phase 1 = **zero-touch route-only**. **Phase 2+ goal = consolidate ke global** (sibyl-postgres→postgres-global butuh **pgvector** [terpenuhi via image supabase/postgres], sibyl-minio→minio-global). Worker crash-loop = escalate ke Sibyl owner (resolve natural saat consolidation). Backup Sibyl terpisah (`sibyl-*.sh`), "owned by Sibyl" tapi Zaky execute.

### Interlab CRM demo fate (Q3)
Phase 1 = **arsip murni**. Demo tetap jalan (route via bridge, Medium priority). **Mandatory dump** (pg + minio mirror) sebelum decom apapun. Decom container demo setelah webapp baru live & cutover `app.interlab-portal.com` (di luar 24h). **Handover flag ke app-team** (post-schema-final): review dump → selective re-seed master data (employee, customer master, product catalog, divisi/role) via seed SQL/Prisma migration. Transactional data (orders/tasks/logs) tetap diarsip. On-demand restore → sandbox database postgres-global per request.

### postgres-global eksperimen drop (Q4)
Aman drop (kosong, 0 koneksi). Prosedur: **double-layer dump** (`pg_dumpall` cluster + `pg_dump --format=custom mydb_vps`), **verify `pg_restore --list` sebelum stop** → stop+rm (bebasin nama) → preserve whole folder `/opt/projects/postgre-global-vps` sebagai tarball → volume rename `pg_global_data` → `pg_global_data_old` (**delete setelah Phase 1 sign-off + 7 hari stable**) → lepas port :25432/Tailscale. Review `postgresql.conf` (carried, §4) + `01-bootstrap.sql.tpl` (pola role carried; confirm vanilla **tanpa** pgvector → wajib image supabase/postgres).

### Pre-cutover hygiene
stop+rm `admiring_mendeleev`; drop `whoami-storage`; one-time truncate Sibyl crash-loop log (`docker inspect <id> --format '{{.LogPath}}'` → `truncate -s 0`, idempotent no-restart).

---

## 7. Supabase Deployment (Q12/Q13) — CONDITIONAL, 3h time-box

### Method: Opsi b' — official trimmed compose via Coolify Docker-Compose resource
Ambil docker-compose self-host official → **drop `db` bawaan** (pakai postgres-global), point semua service ke postgres-global + minio-global, **disable** `analytics`(logflare)+`functions`(edge)+`vector`+`imgproxy`+**`realtime`** (Realtime excluded Phase 1; hemat ~300 MB; trigger Phase 2 = dashboard real-time/notification). Deploy sebagai Coolify "Docker Compose" resource (Kong di-route via Traefik). **Pre-verify:** spin Coolify, test compose resource dengan multi-service sederhana dari private GitHub repo; **fallback kalau flaky:** vanilla docker-compose di `/opt/projects/supabase-global/` + systemd autostart, Coolify cuma manage Traefik route ke Kong.

**Arsitektur kunci:** postgres-global = image `supabase/postgres` → init **otomatis bikin roles + schemas `auth`/`storage`/`realtime`**. Substrat DB sudah ada saat postgres-global hidup → service Supabase tinggal **connect**, bukan bootstrap. postgres-global = **critical path NON-time-boxed**; service Supabase = layer time-boxed di atasnya.

### JWT generation (pre-req SEBELUM deploy)
`openssl rand -base64 32` (signing secret) → anon key (signed `{"role":"anon"}`) + service_role key (signed `{"role":"service_role"}`) → `secrets/supabase.yaml` (SOPS). Same JWT secret across all services.

### Storage → MinIO wiring
- Model: **single physical bucket `supabase-storage`** + logical per-app-env buckets (`<app>-<env>-<purpose>`); isolasi via Supabase RLS + boundary app-tak-sentuh-MinIO. (Physical isolation per-app = defer Phase 2 trigger: multi-tenant SaaS / regulatory kontrak BUMN / >500 GB per app.)
- Env: `GLOBAL_S3_ENDPOINT=http://minio-global:9000` (http internal), `GLOBAL_S3_FORCE_PATH_STYLE=true` (gotcha#1), `STORAGE_S3_REGION=us-east-1` dummy (gotcha#2).
- **Dedicated service-account** (least-privilege JSON: Get/Put/Delete/List/GetBucketLocation di `supabase-storage` saja; NO ListAllMyBuckets/Create/Delete), BUKAN root.
- `scripts/init-minio-supabase.sh` **idempotent**: create bucket + anonymous none + SA+policy (pre-create sebelum storage-api start — gotcha#3; re-run safe Phase 1.5).
- **Shared Docker network** wajib explicit-connect minio-global + supabase (gotcha#4 Coolify isolation).
- CORS tightened (origin `app.`+`staging.`, no wildcard). File size: documents 50MB/avatars 5MB/attachments 25MB. Default **private** (public opt-in + justifikasi). Public objects via `supabase.<domain>/storage/v1/object/public/...` (proxy, bukan MinIO public).
- Rotasi: SA key T2 (180d), root MinIO T3 (90d).

### Studio access (Q14)
🔒 Tailscale-only + **basic-auth Kong** (`DASHBOARD_USERNAME`/`DASHBOARD_PASSWORD` → SOPS) defense-in-depth. "Bonus only, defer no blocker."

### Health criteria (defer-trigger @ hour-3, konkret)
- **Kong:** up + admin port respond + routes registered → **gagal = FULL DEFER** (no API gateway).
- **GoTrue:** up + `/health` 200 + smoke test signup berhasil.
- **PostgREST:** up + endpoint list + query test table.
- **Storage:** up + `/status` 200 + MinIO sehat + create test bucket. **MinIO defer → Storage auto-defer** (decoupled blame).
- **Studio:** bonus, defer no blocker.
- **Decision @3h:** Kong+GoTrue healthy = minimum viable, continue. Kong unhealthy = full defer. GoTrue unhealthy → auth fallback. PostgREST unhealthy → app postgres-direct via Supavisor. Storage unhealthy → MinIO direct (S3 SDK) atau defer file feature.

### Auth fallback (kalau GoTrue defer) — konkret
**NextAuth.js v5 + Postgres database adapter** → tabel `auth_*` di `interlab_prod` (schema `auth` Supabase tetap idle), **database session** (bukan JWT, easier revocation). App-team prep schema migration **parallel sebagai contingency, bukan default** (default = GoTrue; kalau GoTrue up, NextAuth schema tetap dibuat tapi idle). Phase 1.5 migration script `interlab_prod.auth_users → auth.users`. Anti-fallback: jangan custom-JWT, jangan in-memory session, jangan defer auth entirely.

---

## 8. Backup & DR (Success Criteria #7) + RTO/RPO

**Prinsip:** enkripsi sebelum keluar box, semua off-site, scriptable di repo, cross-OS restorable.

### Matrix
| Target | Metode | Frekuensi | Retensi | Destinasi |
|---|---|---|---|---|
| postgres-global (per-DB) | `pg_dump --format=custom --compress=6` per DB + `pg_dumpall --globals-only` | Daily | 7d lokal + 30d off-site | B2 (rclone-crypt) |
| postgres-global (PITR) | WAL archiving (`archive_mode=on`) | Continuous | 7–14d | B2 (rclone-crypt) |
| minio-global | `rclone sync` (prefix-filter bucket-UUID) — **tiered:** `invoices\|receipts\|efaktur\|tax\|finance\|documents`=**hourly**, `avatars\|attachments\|generic`=daily | Hourly/Daily | 30d | B2 (rclone-crypt) |
| Coolify | dump Coolify-DB + tar `/data/coolify` (**incl. acme.json**) | Daily | 30d | B2 (rclone-crypt) |
| Sibyl (opportunistic) | dump sibyl-postgres + rclone sibyl-minio | Daily | 14d | B2 (rclone-crypt) |

**RPO decision = Opsi B:** daily dump + WAL archiving sejak hari-1 (PITR-capable; restore manual via base+WAL replay, documented; pgBackRest automation defer 1.5). 24h RPO unacceptable untuk finance/tax. File RPO: hourly (finance bucket) / daily (rest).

**Encryption:** rclone crypt remote TUNGGAL untuk semua (single tool/config/key; key di `external-services.yaml`).

**Orchestration:** host cron + `scripts/backup/` repo (cross-OS portable). **Failure alert via healthchecks.io** (push ping/job).

**Script structure:** `scripts/backup/{lib.sh, postgres-dump.sh, postgres-globals.sh, postgres-wal-archive.sh, minio-sync.sh, coolify-backup.sh, sibyl-backup.sh}` + `cron/backup-crontab`.

**Verification in-script (fail-fast, no silent corruption):** `pg_restore --list`, `tar tzf`, `rclone check` → push fail ke healthchecks.

**WAL-lag monitoring (anti silent-death):** cron hourly `SELECT archived_count,last_archived_time,failed_count FROM pg_stat_archiver` → healthchecks; `archive_command` exit non-zero on fail (Postgres retry, keep WAL local); disk >80% alert catch WAL accumulation.

**Local staging:** dump → `/var/backups/{postgres,minio,coolify}/` (7d, `find -mtime +7 -delete`) → rclone upload (decouple dump dari network).

**Coolify state coverage:** verify via `docker inspect coolify` — SSH keys, DB location (SQLite internal vs Postgres external), resource configs, env vars, semua persistent mount.

**Host-level:** SSH host keys backup (cheap). Tailscale = re-auth via RECOVERY.md (skip backup). Crontab/systemd = repo-based (deploy via script saat reinstall, bukan backup file).

### RTO/RPO posture (Success Criteria #7)
| Skenario | RTO | Path |
|---|---|---|
| Container/service crash | menit | Coolify restart + Netdata alert |
| Logical corruption | ~1h | restore dump/PITR ke sandbox → swap |
| Server lost, OVH ok | ~1h | OVH snapshot restore (full-VM) |
| Total provider loss | ~4–6h | provision baru + RECOVERY.md dari B2 |

**SPOF Phase 1:** compute = SPOF diterima; data terlindungi off-site. Warm-standby trigger Phase 2: user >50 harian · workflow business-critical (payroll/payment/tax deadline) · downtime-cost exceed threshold · SLA external.

**OVH snapshot (Gate #3 — RESOLVED):** automated backup **di-skip Phase 1** (manual-only, disiplin Q18). Pakai **1 free OVH snapshot** untuk **pre-Phase-0 insurance** (sebelum start deployment); beyond itu manual snapshot before risky ops (pre-reinstall, pre-major-upgrade). B2 = primary recovery. Snapshot=OS/infra; B2=data/granular. Re-eval automated Phase 2+ kalau iteration picks up.

### RECOVERY.md (Phase 1 deliverable WAJIB)
Step-by-step + realistic timing: fresh OS → install Docker/Git/sops/age (15m) → retrieve age key Bitwarden → clone repo → decrypt (10m) → restore Coolify+DB (30m) → restore postgres (60–90m) → restore MinIO (30–60m) → restore acme.json → inject env → start (Postgres→MinIO→Supabase→Coolify-Traefik→apps) → verify E2E (30m) → DNS update (5m). **Total ~4.5–5.5h.** **DNS recovery automation:** CF API token (SOPS) → script auto-update A record. Sibyl recovery = section terpisah (ownership boundary). **DR drill cadence:** monthly sandbox (restore latest dump ke sandbox DB, verify table/row/schema + subset MinIO, log ke RECOVERY.md history) + **annual minimum + post-significant-arch-change**. Phase 1.5 reinstall = the big RTO drill (document actual vs target).

---

## 9. Monitoring & Logs

**Observability layers:** Uptime Kuma (endpoint) · Sentry cloud (app errors + PII-strip) · healthchecks.io (backup dead-man-switch) · **Netdata** (system + per-container metrics).

**Netdata (Q16):** single container Tailscale-only. Guardrails: retensi ring-buffer 1–3 hari (**no TSDB long-term**) · bind `100.117.214.25:19999` + DOCKER-USER drop external · **Netdata Cloud claim DECLINED** (verify `cloud.d/cloud.conf`=no + `stream.conf`=no) · **the only metrics tool** (Prometheus/Grafana/Loki = anti-goal). Coolify built-in monitor = komplemen (per-resource ops lens), bukan replacement.

**Alert channel:** Telegram private channel dedicated (bot token SOPS). Tier (prefix subject Phase 1, split channel 1.5): `[CRIT]` service down/disk>90%/OOM/WAL-fail>5min/backup-missed · `[WARN]` disk>80%/mem-pressure/IO-wait · `[INFO]` digest → status page/email (bukan Telegram). **Thresholds (override Netdata default):** CPU>80%/10min · RAM<2GB warn/<500MB crit (host) · disk>80%/>90% · IO-wait>20%/5min · per-container mem>85%/>95% · pkt-drop>100/s · `/var/lib/docker/containers/*`>5GB (log accumulation early signal). **Working rule:** setiap alert actionable; ignored alert worse than no alert; tune 1.5. Reject ntfy (extra self-host) + email (latency/miss) untuk critical Phase 1.

**Logs (Q17):** daemon.json rotation 30MB/container (§4) — uniform; debug override via `docker update --log-opts` temporary. journald 3-layer (§4). Aggregation (Loki/Vector) = **trigger Phase 1.5** kalau cross-container search jadi routine. **Architectural principle:** container stdout = ephemeral rotation-bound, **NEVER substitute audit**; audit trail = DB-backed via middleware (Q10), retained per regulatory 5–10thn. **Deploy rule:** new service WAJIB log stdout/stderr (no internal file appender, verify pre-deploy — all Phase 1 services compliant). **App-team log discipline:** `LOG_LEVEL=warn/info` prod; no raw payload/token/password/session; structured JSON; safe stack-trace (user ID/request ID, bukan raw input). Coolify viewer expectation: history ~30MB window.

---

## 10. Ordered Deployment Sequence (Success Criteria #4) — total ~14h kerja (<16h budget)

### Pre-flight checklist (~25 menit, SEBELUM Phase 0)
1. **OVH disk type verify** (panel → plan = NVMe SSD?) — ⏳ panel values belum di-paste; **NVMe = committed-default, NON-BLOCKING**. Kalau panel ungkap bukan NVMe → flip 3 knob (`random_page_cost`, `effective_io_concurrency`, Sentry tier) di execute-plan (1-line).
2. ✅ **Domain — LOCKED (Gate #1):** `interlab-portal.com` (satu-satunya domain dimiliki, no alternative).
3. OVH KVM console test + root password → Bitwarden.
4. Tailscale verify laptop + mobile.
5. Cloudflare API token generate (DNS-01 + DNS recovery automation).
6. GitHub repo access test (config-as-code git-deploy).
7. ✅ **OVH backup — RESOLVED (Gate #3):** skip automated (manual-only); 1 free OVH snapshot untuk pre-Phase-0 insurance.

### Sequence

| Fase | Isi | Est | Time-box |
|---|---|---|---|
| **0 · Prep & safety** | OVH snapshot → apt pre-check (document sources.list* → `apt update` → fail? repoint old-releases → test `apt install --reinstall ca-certificates` → **STOP kalau unrecoverable**) → break-glass → preservation dumps (exp-pg double-layer + verify, interlab-demo, Sibyl) → hygiene (rm stray/whoami, truncate Sibyl log) → system tuning + daemon.json + journald (docker restart) → init repo + SOPS + generate secrets | ~2h | |
| **1A · Foundation** | Install Coolify → shared network → **postgres-global** (supabase/pg, tuning, per-DB roles, Supavisor, WAL on) → **minio-global** (init script, bucket, SA) → verify | ~4h | critical |
| **1B · Traefik cutover** | firewall+SSH-Tailscale (break-glass verified) → cert preserve (rename resolver, verify NotAfter) → file-bridge → **stop manual → Coolify Traefik** → **Interlab-demo canary → verify → Sibyl** → verify routes | ~2h | SSL **1h** (defer per-domain kalau rate-limit) |
| **💤 SLEEP CHECKPOINT** | **MANDATORY pasca-1B (~8h kerja), non-negotiable.** "error rate Supabase × kelelahan = recipe for hour-3 failure." | 6h | |
| **1C · Supabase** | JWT secrets → trimmed compose (Realtime❌) → **health gate @3h** (Kong+GoTrue min, else graceful partial-defer) | ~3h | **3h box** |
| **1D · Tools & ops** | Uptime Kuma → Netdata (cloud-declined) → Telegram → Sentry cloud+PII-strip → backup cron+first-run (dump+WAL+rclone B2)+verify+WAL-lag monitor → commit config-as-code + RECOVERY.md | ~2h | |
| **1E · Verify & sign-off** | E2E (public/admin/DB/MinIO) → sandbox restore drill → **app-team handover package** → sign-off checklist → post-deploy OVH snapshot | ~1h | |

**💤 Sleep checkpoint (MANDATORY, non-negotiable — bukan opportunistic):**
- **Block 1** = Phase 0 + 1A + 1B (~8h kerja) → **tidur 6h**
- **Block 2** = Phase 1C + 1D + 1E (~6h kerja)
- Rasional: Supabase install (1C) butuh konsentrasi penuh untuk health-gate @3h; kelelahan × error-rate = recipe for hour-3 failure. Sleep dikunci di antara high-blast-radius cutover (1B) dan time-box-sensitive Supabase (1C).

**Deployment log file** (terpisah dari RECOVERY.md): realtime timestamp + action + result + anomaly → input untuk refine RECOVERY.md realistic post-Phase-1.

**App-team handover package (Phase 1E action item):** Supabase URL + anon/service_role keys, Postgres connection string per DB-env (via Supavisor), Coolify deployment guide, Sentry DSN, Telegram channel invite, (kalau Supabase defer) NextAuth fallback note + schema.

---

## 11. Rollback Decision Trees (per phase)

Format: **success criteria · failure trigger · rollback action · decision time-bound** (avoid sunk-cost "satu jam lagi mungkin jalan").

- **0 · Prep:** apt unrecoverable → STOP, escalate reinstall urgency (sinyal Phase 1.5 lebih mendesak). Preservation dump fail verify → JANGAN proceed drop. Decision: immediate.
- **1A · Foundation:** postgres-global/minio-global tak healthy dalam 60 min → recheck config/secrets; >90 min → STOP, OVH snapshot rollback. (Foundation = blocker; tak ada partial.)
- **1B · Cutover:** route/cert tak serve setelah cutover → **rollback <15 min**. SSL >1h box (rate-limit) → defer per-domain, lanjut domain lain. Sibyl blackout >30 min → rollback domain itu ke manual, retry setelah analisis. Decision: per-domain, time-bound 30 min.
  - **<15 min rollback outline (command-level):** (1) `docker stop <coolify-traefik>` (lepas :80/:443) → (2) `docker start traefik` (manual Traefik reclaim :80/:443; acme.json + Docker-label routes utuh) → (3) verify `curl -I https://sibyl.bisikan.app` + `https://app.interlab-portal.com` (200 + cert valid) → (4) kalau OK: cutover aborted, Coolify Traefik tetap mati, analisis offline.
  - **Prasyarat rollback:** manual Traefik container **hanya di-`stop`, TIDAK di-`rm`** saat cutover (baru `rm` setelah cutover stable 24h). acme.json original di `/home/zaky/traefik/letsencrypt/` **tidak disentuh** (Coolify pakai copy). Ini yang bikin rollback trivial.
- **1C · Supabase:** @3h health gate. Kong+GoTrue min healthy → continue. Else → graceful partial-defer (lihat §7), JANGAN extend box. Decision: hard stop @3h.
- **1D/1E:** tools fail → defer individual (non-blocker), lanjut sign-off dengan catatan.

---

## 12. Risk Register (Success Criteria #5)

| # | Risk | Likelihood | Impact | Mitigasi |
|---|---|---|---|---|
| R1 | **OS 25.04 EOL** (no security patch, public finance server) | High (sudah terjadi) | High | Tailscale-only admin + firewall + fail2ban + CVE audit USN (openssh/kernel/openssl/libc) → escalate kalau exploitable. **Fix: fresh reinstall 26.04.1 LTS ≤ 30 Sep 2026** (Phase 1.5, deadline eksplisit). |
| R2 | **Traefik cutover gagal** (Sibyl active users down) | Medium | High | File-bridge zero-touch + Interlab-canary-first + rollback <15 min (manual Traefik utuh, §11 command-outline) + per-domain time-bound 30 min. **Sub-risk — SSL rate-limit** LE (5 cert/domain/minggu): cert preservation (rename resolver, no re-request) + verify NotAfter + SSL 1h box → defer per-domain. |
| R3 | **Supabase install meleset 3h** | Medium-High | Medium | Decoupled (postgres-global critical-path tetap ada) + graceful partial-defer + NextAuth fallback contingency + hard-stop @3h. |
| R4 | **WAL accumulation silent-death** (archive fail → disk full → Postgres halt) | Medium | High | `pg_stat_archiver` hourly monitor → healthchecks + archive_command exit non-zero + disk>80% alert + Netdata. |
| R5 | **Disk type ternyata bukan NVMe** | Low | Medium | Pre-flight OVH panel verify + ternary fallback (1.5/100 SATA, 4/2 HDD + Sentry cloud + MinIO dedicated vol Phase 2) + fio post-deploy baseline. |
| R6 | **SPOF total server loss** | Low | High | B2 off-site (cross-OS) + OVH snapshot + RECOVERY.md tested (RTO 4–6h) + Phase 2 warm-standby trigger. |
| R7 | **Phase 1.5 reinstall / cross-OS-restore fail** (planned-event, hard deadline ≤30 Sep; risk sepanjang interim EOL window) | Medium | High | Backup didesain cross-OS sejak hari-1 (config-as-code repo + SOPS + portable volume + logical dump) + monthly DR drill + RECOVERY.md realistic timing + pre-reinstall OVH snapshot. Interim window dimitigasi (R1). |
| R8 | **Secret loss / lockout** | Low | High | SOPS/age (laptop+Bitwarden+offline DR) + break-glass OVH KVM + multi-recipient ready. |

### Watch-list — monitored-inline, promote-candidate (bukan top-register Phase 1)
Risk dengan **mitigasi struktural** (tak butuh ongoing tracking) atau **monitored-inline** (di-watch, promote ke top-register kalau signal muncul):

| Item | Posture | Promote-trigger → top-register |
|---|---|---|
| **Connection pool exhaust** (Supavisor) | Monitored-inline via Netdata + Supavisor metrics; threshold pool saturation >85% sustained → `[WARN]` Telegram | Phase 1.5 review tunjukkan saturation signal berulang |
| Coolify git-deploy flaky | Mitigated-inline (fallback laptop-deploy + Coolify-Traefik-only, §7) | — (structural) |
| Secret accidental-commit | Mitigated-inline (`.gitignore` + SOPS encrypt-at-rest, §16) | — (structural) |
| Sibyl worker log growth | Mitigated-inline (Netdata `/var/lib/docker/containers/*`>5GB alert, §9) | escalate kalau disk pressure |
| Transition-window unlimited containers + `overcommit=1` | Mitigated-inline (decom-target, footprint ~0.4 GB, §4) | — (hilang saat cutover) |

> **Risk register resolved (post-Pass-3):** SSL rate-limit di-demote → sub-risk di bawah **R2** (failure-mode cutover, bukan independent risk). Ditambah **R7 = Phase 1.5 reinstall/cross-OS-restore fail** (planned-event + hard deadline ≤30 Sep). Top-8 final: OS-EOL · Traefik(+SSL) · Supabase-timebox · WAL-silent-death · disk-not-NVMe · SPOF/provider-loss · reinstall-fail · secret/age-key.

---

## 13. Time-box Recovery / Defer Matrix (Success Criteria #8)

| Task | Time-box | Kalau lewat → defer | Dampak Phase 1 deliverable |
|---|---|---|---|
| Supabase services | 3h | Phase 1.5 (partial OK: keep yang healthy) | App pakai postgres-direct (Supavisor) + GoTrue-only/NextAuth fallback. PostgREST/Storage/Studio nyusul. Launch tetap jalan. |
| SSL cert migration | 1h | per-domain | Domain belum-migrasi tetap di manual Traefik sementara (mixed state terdokumentasi), retry domain itu nanti. |
| Foundation (1A) | 90 min hard | TIDAK boleh defer (blocker) | OVH snapshot rollback, re-attempt. Critical path. |
| OS upgrade LTS | — | Phase 1.5 (deadline 30 Sep) | EOL window dimitigasi (R1). |
| pgBackRest | — | Phase 1.5 | WAL archiving manual-restore tetap PITR-capable. |
| Sentry self-host | — | Phase 1.5 eval | Sentry cloud + PII-strip jalan. |

---

## 14. Phase Boundary (Success Criteria #10)

**IN Phase 1 (critical/high):** Coolify · postgres-global · minio-global · Traefik cutover + cert preservation + file-bridge · route migration Sibyl+Interlab demo · preservation dumps · Uptime Kuma · Netdata · Telegram alert · Sentry cloud+PII-strip · backup (dump+WAL+B2+healthchecks+WAL-lag monitor) · SOPS secrets · RECOVERY.md · config-as-code repo · firewall+SSH-Tailscale · system tuning · DNS (DNS-only, wildcard DNS-01).

**CONDITIONAL (time-boxed):** Supabase services 3h (Kong+GoTrue+PostgREST+Storage; Realtime❌, Studio bonus) → graceful partial-defer · SSL cert migration 1h.

**DEFER Phase 1.5:** 26.04 LTS reinstall (≤30 Sep) · pgBackRest hardening · Sentry self-host eval (VPS terpisah) · huge_pages pre-alloc · Supabase yang meleset · Tailscale ACL · OVH Network Firewall · drift-detection script · Cloudflare Access · CF proxy/WAF eval · ImgProxy · batch Tailscale-Serve · `tcp_tw_reuse` · OVH automated-backup re-eval.

**DEFER Phase 2:** Sibyl consolidation (→global, pgvector) · warm-standby/server kedua · scale-out per-service · regulatory archive 5–10thn · `worker.<domain>` · Loki/Vector aggregation · Wasabi switch (>1TB) · physical bucket isolation · split `api.<domain>` · NextAuth→GoTrue migration · alert channel split per-tier.

**Multi-env:** prod & staging **share postgres-global instance, database terpisah** (`interlab_prod`/`interlab_staging`), bukan instance terpisah. Trigger Phase 2 split: lock contention · vacuum incompatibility · compliance demand · schema migration risk.

---

## 15. Open Decisions / Info Needed (Success Criteria #9)

1. **OVH disk type** — ⏳ panel values belum di-paste; **NVMe committed-default (non-blocking)**; fallback ternary siap (flip 3 knob di execute-plan kalau ternyata bukan NVMe).
2. ✅ **Domain — RESOLVED (Gate #1):** `interlab-portal.com` locked (satu-satunya domain, no alternative).
3. ✅ **OVH automated backup — RESOLVED (Gate #3):** skip automated, manual-only + 1 free snapshot pre-Phase-0.
4. **OVH KVM console responsiveness** — pre-flight verify (break-glass dependency).
5. **Coolify git-deploy reliability** — pre-verify; fallback laptop-deploy + Coolify-Traefik-only.
6. **App architecture monolith vs split** — working assumption monolith; revisit triggers documented.

---

## 16. Config-as-Code Repo Structure (Q19)

```
interlab-infra/
├── coolify-resources/{postgres-global,minio-global,supabase,uptime-kuma,netdata}/   # compose + env-templates
├── system-config/{nftables.conf, docker-daemon.json, journald.conf, sysctl.d/, postgresql-tuning.conf}
├── scripts/{backup/,recovery/,deploy/}
├── secrets/   # SOPS-encrypted (5 file, §5)
├── cron/backup-crontab
├── RECOVERY.md
├── DEPLOYMENT-LOG.md
└── .sops.yaml
```
**Convention:** "Never change via Coolify UI. Always: edit repo → push → Coolify pull → deploy." Drift-detection defer 1.5 (Phase 1.5 reinstall = forcing function). **NOT in repo:** Coolify user accounts, notification settings, deployment history, Coolify-internal state. **Scale-UP** = default Phase 2; scale-OUT enabled murah via parameterized host (no hardcode IP/domain) + Tailscale inter-service + logical-dump vehicle. Phase 2 walkthrough (Postgres/MinIO split) di spec sebagai proof.

---

## Appendix — Validation evidence (read-only, 2026-05-25)
- Container inventory, memory limits, Sibyl crash-loop root cause, acme.json resolver+8 certs, Traefik provider/challenge, public listeners (:2223/:80/:443/:8080 insecure), empty nft ruleset, no daemon.json, swap 0, sysctl current, THP madvise, relatime, inotify, postgres-global-exp contents + experiment postgresql.conf/bootstrap — semua tervalidasi via inspeksi langsung di `vps-lafayette-01`.
