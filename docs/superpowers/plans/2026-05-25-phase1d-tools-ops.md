# Phase 1D — Tools & Ops Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: superpowers:subagent-driven-development or superpowers:executing-plans. Checkbox steps.
>
> **⚠️ INFRA-ADAPTED.** PRODUCTION `vps-lafayette-01`. pre-check → action → verify → rollback → commit. **Lower stakes** (monitoring/backup; non-blocking, retry-able). DEPENDENCIES: Phase 1A–1B complete (foundation + cutover). 1C may be full or partial-deferred.
>
> **[SERVER]** · **[LAPTOP]** (SOPS inject, Telegram/B2 tokens) · **[MANUAL]** (Telegram bot create, B2 bucket create).

**Goal:** Stand up observability (Uptime Kuma + Netdata, Tailscale-only, Telegram alerts), wire Sentry cloud + mandatory PII-strip, activate the encrypted off-site backup (daily dump + WAL push to B2 + verify + lag-monitor), re-scope fail2ban, and fill RECOVERY.md.

**Architecture:** Uptime Kuma + Netdata as Coolify resources bound Tailscale-only (DOCKER-USER drops public access, set in 1B.3). Netdata cloud-claim explicitly declined. Single Telegram channel for `[CRIT]/[WARN]/[INFO]`. Backups orchestrated by host cron running `scripts/backup/*` → rclone-crypt remote on Backblaze B2; healthchecks.io dead-man-switch; `pg_stat_archiver` lag monitor.

**Tech Stack:** Uptime Kuma · Netdata · Telegram Bot API · Sentry cloud · rclone (crypt) · Backblaze B2 · healthchecks.io · cron · fail2ban.

**Spec reference:** §8 (backup/DR), §9 (monitoring/logs), §7 (Sentry PII), §10 (1D), §12 (R4 WAL).

---

### Task 1D.1: Uptime Kuma (Tailscale-only) [SERVER/LAPTOP]

**Files:** `coolify-resources/uptime-kuma/compose.yaml`; commit.

- [ ] **Step 1: Author + deploy compose**

Create `coolify-resources/uptime-kuma/compose.yaml` (`louislam/uptime-kuma:1.23.17` — pinned/verified, volume for data, `mem_limit: 256m`, port bound `127.0.0.1`/Tailscale only). Deploy via Coolify.
Expected: container Up.

- [ ] **Step 2: Verify Tailscale-only reachability**

Run (Tailscale): `curl -sI -o /dev/null -w '%{http_code}\n' http://100.117.214.25:<kuma-port>`; off-Tailscale → blocked (DOCKER-USER 1B.3).
Expected: reachable via Tailscale only.

- [ ] **Step 3: [MANUAL] Add monitors**

Add HTTP monitors: `app.interlab-portal.com`, `supabase.interlab-portal.com` (if 1C up), `sibyl.bisikan.app`, postgres-global (TCP 6543 via Supavisor), minio-global health. Plus a **push monitor** for backup jobs (used in 1D.5).
Expected: monitors green.

- [ ] **Step 4: Commit** uptime-kuma compose.

---

### Task 1D.2: Netdata (Tailscale-only, cloud-declined) [SERVER]

**Files:** `coolify-resources/netdata/compose.yaml` + `system-config/netdata/health.d/interlab.conf`; commit.

- [ ] **Step 1: Deploy Netdata with cloud DISABLED**

Create compose (`netdata/netdata:v2.10.3` — pinned/verified, host mounts for metrics, `mem_limit: 256m`, bind `100.117.214.25:19999`). Set env/config to **decline cloud claim** + disable streaming.
Deploy, then verify:
```bash
docker exec <netdata> cat /etc/netdata/cloud.d/cloud.conf 2>/dev/null | grep -i enabled   # -> no
docker exec <netdata> sh -c 'cat /etc/netdata/stream.conf 2>/dev/null | grep -i "^[[:space:]]*enabled"'  # -> no
```
Expected: cloud `enabled = no`; stream `enabled = no` (spec §9).

- [ ] **Step 2: Bind Tailscale-only**

Run: `ss -tlnp | grep 19999`; off-Tailscale curl → blocked (DOCKER-USER drops :19999, 1B.3).
Expected: 19999 reachable via Tailscale only.

- [ ] **Step 3: Custom alert thresholds (spec §9)**

Create `system-config/netdata/health.d/interlab.conf` with alarms: CPU>80%/10m warn; RAM avail<2G warn / <500M crit; disk>80% warn / >90% crit; IO-wait>20%/5m warn; container mem>85% limit warn / >95% crit; `/var/lib/docker/containers/*`>5GB warn. Mount into the container; reload Netdata.
Expected: `docker exec <netdata> netdatacli reload-health` → alarms loaded.

- [ ] **Step 4: Commit** netdata compose + health config.

---

### Task 1D.3: Telegram alert channel [SERVER/LAPTOP/MANUAL]

**Files:** none (token → SOPS).

- [ ] **Step 1: [MANUAL] Create bot + private channel**

Create a Telegram bot (BotFather) + a dedicated **private channel** (not personal DM). Add bot as admin. Get bot token + chat_id. Store token in `secrets/external-services.yaml` (SOPS).

- [ ] **Step 2: Wire Uptime Kuma → Telegram**

Uptime Kuma → Settings → Notifications → Telegram (token + chat_id). Test notification.
Expected: test message arrives in channel.

- [ ] **Step 3: Wire Netdata → Telegram**

Configure `health_alarm_notify.conf` (Telegram: `SEND_TELEGRAM=YES`, bot token, chat_id). Trigger a test alarm.
Expected: alarm arrives. Tier via subject prefix `[CRIT]/[WARN]/[INFO]` (spec §9).

- [ ] **Step 4: Record** channel wired in DEPLOYMENT-LOG.

---

### Task 1D.4: Sentry cloud + mandatory PII-strip [LAPTOP / app-team handoff]

**Files:** none in infra (DSN → SOPS; `beforeSend` is app-side). Documented for handoff.

- [ ] **Step 1: [MANUAL] Create Sentry cloud project + DSN**

Create free-tier Sentry project; store DSN in `secrets/external-services.yaml` (SOPS).

- [ ] **Step 2: Document MANDATORY PII-strip for app-team (spec §7, NOT optional)**

Record in handoff package (1E): app SDK `beforeSend` MUST strip `email`, `NIK`, `NPWP`, `salary`; **exclude finance/tax module** from capture. Compliance checklist item — blocking for app go-live, not infra. Trade-off (cloud vs self-host sovereignty) noted; Phase 1.5 eval self-host on separate VPS.

---

### Task 1D.5: rclone-crypt remote (B2) + backup scripts + cron [SERVER/LAPTOP]

**Files:** `scripts/backup/{lib.sh,postgres-dump.sh,postgres-globals.sh,minio-sync.sh,coolify-backup.sh,sibyl-backup.sh}`, `cron/backup-crontab`; commit. (postgres-wal-archive.sh already in repo from 1A.3.)

- [ ] **Step 1: [MANUAL] Create B2 bucket + app key**

Backblaze B2 → create bucket `interlab-backups` + application key (restricted to that bucket). Store key in `secrets/external-services.yaml`.

- [ ] **Step 2: Configure rclone-crypt remote**

Configure rclone: a `b2` remote (B2 key) + a `b2crypt:` crypt remote (encrypts filenames + content) wrapping `b2:interlab-backups`. Crypt password → `secrets/external-services.yaml` (independent of age key, spec §8). Verify: `rclone lsd b2crypt:`.
Expected: crypt remote works (empty listing OK).

- [ ] **Step 3: Review pre-written backup scripts (MF-1D-3 — bodies already in repo)**

The script bodies are **authored + committed pre-execute** in `scripts/backup/` (no authoring during execute). Verify present + syntactically valid + executable:
```bash
ls -la scripts/backup/
chmod +x scripts/backup/*.sh
bash -n scripts/backup/*.sh && echo "syntax OK"
```
Expected: `lib.sh`, `postgres-dump.sh`, `postgres-globals.sh`, `postgres-basebackup.sh`, `minio-sync.sh`, `coolify-backup.sh`, `sibyl-backup.sh`, `wal-lag-check.sh`, `postgres-wal-archive.sh` present; all pass `bash -n`. (Responsibilities — `lib.sh`: env load + log + healthchecks ping + rclone wrapper; `postgres-dump.sh`: per-DB `pg_dump --format=custom --compress=6` → verify `pg_restore --list` → upload `b2crypt:postgres/` → ping (logical, granular/portable restore); **`postgres-basebackup.sh`: `pg_basebackup` physical base → tar.gz → `b2crypt:basebackup/` (REQUIRED for PITR — WAL replays onto this, not onto logical dumps; MF-1E-1)**; `postgres-globals.sh`: `pg_dumpall --globals-only`; `minio-sync.sh`: tier by bucket-name regex → `rclone sync` + `check`; `coolify-backup.sh`: Coolify DB dump + `tar /data/coolify` incl acme.json → `tar tzf` → upload; `sibyl-backup.sh`: opportunistic 14d.)

- [ ] **Step 4: Write crontab + install**

Create `cron/backup-crontab`: **daily postgres-basebackup (physical, ~01:30 UTC, 7d B2 retention → PITR window)**, daily postgres-dump+globals+coolify (~02:00 UTC), hourly minio-sync for finance buckets + daily for rest, hourly WAL-lag monitor (1D.6), daily sibyl. Install: `sudo cp cron/backup-crontab /etc/cron.d/interlab-backup`.
Expected: cron installed.

- [ ] **Step 5: First run + verify (all targets)**

Run each script once manually; confirm: dumps created + verified locally, uploaded to `b2crypt:`, healthchecks pinged. `rclone ls b2crypt:postgres/` shows the dump.
Expected: all backups present off-site (encrypted), verifications pass. **ROLLBACK:** scripts are idempotent + non-destructive; fix + re-run.

- [ ] **Step 6: Commit** backup scripts + crontab.

---

### Task 1D.6: Activate WAL off-site push + lag monitor [SERVER]

**Files:** Modify `scripts/backup/postgres-wal-archive.sh` (uncomment rclone push); create `scripts/backup/wal-lag-check.sh`.

- [ ] **Step 1: Activate rclone push in WAL archive script**

Uncomment the `rclone copy "$STAGE/$NAME" "$DEST/" && rm -f "$STAGE/$NAME"` line in `scripts/backup/postgres-wal-archive.sh` (staged since 1A.6). Ensure exit non-zero on rclone failure (Postgres retries, keeps WAL local — anti silent-death, §8).

- [ ] **Step 2: Verify WAL reaching B2**

Run: `docker exec postgres-global psql -U postgres -c "SELECT pg_switch_wal();"` then `rclone ls b2crypt:wal/ | tail`
Expected: new WAL file appears in `b2crypt:wal/`.

- [ ] **Step 3: WAL-lag monitor (R4 mitigation)**

Create `scripts/backup/wal-lag-check.sh`: query `pg_stat_archiver` (failed_count, last_archived_time); if `failed_count` rising OR `last_archived_time` stale >5min → push FAIL to healthchecks ( → Telegram `[CRIT]`). Add to crontab hourly (1D.5 Step 4).
Run once: `bash scripts/backup/wal-lag-check.sh && echo ok`
Expected: `ok` (archiver healthy).

- [ ] **Step 4: Commit** updated WAL script + lag-check.

---

### Task 1D.7: fail2ban re-scope [SERVER]

**Files:** `/etc/fail2ban/jail.d/interlab.conf`; commit copy to repo `system-config/fail2ban/`.

- [ ] **Step 1: Re-target jails (SSH now Tailscale-only = sshd jail no-op)**

Create jail config: disable/leave-idle `sshd`; add filters for Coolify Traefik access log (4xx/auth floods) + Coolify auth log. Reload fail2ban.
Run: `sudo fail2ban-client status`
Expected: new jails active; sshd idle.

- [ ] **Step 2: Commit** fail2ban config.

---

### Task 1D.8: Fill RECOVERY.md [LAPTOP]

**Files:** `RECOVERY.md` (skeleton from Phase 0.13).

- [ ] **Step 1: Fill concrete steps + actual artifact names**

Populate RECOVERY.md (spec §8 sequence) with the real resource names, B2 paths (`b2crypt:postgres|minio|wal|coolify`), volume names, acme.json path, and the start-order (Postgres→MinIO→Supabase→Coolify-Traefik→apps). Leave realistic-timing fields to be filled by 1E sign-off / first DR drill.

- [ ] **Step 2: Commit** RECOVERY.md.

---

## Self-Review (writing-plans)

**Spec coverage:** §9 Uptime Kuma (1D.1) + Netdata cloud-declined + thresholds (1D.2) + Telegram tiers (1D.3) ✓. §7 Sentry cloud + PII-strip mandatory (1D.4) ✓. §8 backup matrix + rclone-crypt B2 + scripts + cron + verify + local-stage (1D.5) + WAL push + lag-monitor R4 (1D.6) ✓. §5 fail2ban re-scope (1D.7) ✓. RECOVERY.md (1D.8) ✓. §10 1D ✓.

**Placeholder scan:** `<kuma-port>`/`<netdata>` = discover-at-execute; tokens/keys = SOPS/MANUAL. Backup scripts: **bodies pre-written + committed to `scripts/backup/`** (MF-1D-3); execute only reviews via `bash -n` + deploys. Images pinned (uptime-kuma `1.23.17`, netdata `v2.10.3`). No hand-waved logic.

**Consistency:** `b2crypt:` paths, healthchecks ping, Telegram tiers, thresholds, minio bucket classification regex — consistent with spec §8/§9 + 1A WAL script.

**Deferred:** Loki/Vector aggregation (Phase 1.5) · Sentry self-host (Phase 1.5) · automated rotation (Phase 2).

---

## Execution Handoff
**Plan saved.** Non-blocking, retry-able. Per Path B, post-demo. **Next:** 1E (verify/sign-off/handover).
