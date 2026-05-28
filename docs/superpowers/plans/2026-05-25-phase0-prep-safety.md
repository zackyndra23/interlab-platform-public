# Phase 0 — Prep & Safety Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
>
> **⚠️ INFRA-ADAPTED PLAN (not TDD code).** Target = PRODUCTION server `vps-lafayette-01` with active workload (Sibyl + Interlab demo). There is no unit-test harness. Each task follows: **pre-check → action → verify (expected output) → rollback note → commit config-as-code**. The "test" is the verification command. NEVER run an action whose pre-check fails.
>
> **⚠️ EXECUTION GATE:** Do NOT begin Task 0.2+ (anything that mutates the server) until the user has explicitly confirmed **execute-tonight vs defer-post-demo**. Tasks 0.0–0.1 (gates + snapshot) are safe prep; the rest mutate the server.
>
> **[SERVER]** = runs on `vps-lafayette-01`. **[LAPTOP]** = runs on Zaky's laptop (age key + SOPS never touch the server). **[MANUAL]** = human action (OVH panel, Bitwarden, phone).

**Goal:** Bring the production server to a safe, tuned, recoverable baseline — snapshots + dumps + break-glass + system tuning + secret scaffolding — before any foundational service is deployed.

**Architecture:** Read-validated current state (see spec §1) → take reversible safety nets (OVH snapshot, preservation dumps, break-glass) → apply non-disruptive system tuning (swap, sysctl, THP, noatime, docker log rotation, journald) via reload-not-restart to avoid blipping Sibyl → scaffold the config-as-code repo + SOPS secrets on the laptop. Legacy containers stay **zero-touch** except documented hygiene (stray container removal, log truncation).

**Tech Stack:** Ubuntu 25.04 · Docker 29.2 (iptables-nft) · Tailscale · sops + age · OVH (KVM console + snapshot) · git.

**Spec reference:** `docs/superpowers/specs/2026-05-25-interlab-global-infra-design.md` §1 (state), §4 (tuning), §5 (secrets), §6 (hygiene + dumps), §10 (sequence), §11 (rollback).

---

### Task 0.0: Pre-flight gates verification [MANUAL / SERVER]

**Files:** none (verification only). Records into `DEPLOYMENT-LOG.md`.

- [ ] **Step 1: Confirm resolved gates**

Domain = `interlab-portal.com` (LOCKED, Gate #1). OVH automated backup = skip / manual-only (Gate #3). No action; just confirm in DEPLOYMENT-LOG.

- [ ] **Step 2: [MANUAL] Disk type — paste OVH panel values (NON-BLOCKING)**

Read OVH Manager → VPS plan → Storage field. Record Plan + Storage in DEPLOYMENT-LOG.
Decision: NVMe → keep committed profile (no change). SATA SSD → flip `random_page_cost=1.5`, `effective_io_concurrency=100` in Phase 1A. HDD → full HDD tuning + Sentry stays cloud.
**This does NOT block Phase 0.** Committed default = NVMe.

- [ ] **Step 3: [MANUAL] Verify admin access prerequisites**

Confirm: Bitwarden accessible · laptop on Tailscale · phone on Tailscale (for break-glass Task 0.3). Record.

- [ ] **Step 4: Create DEPLOYMENT-LOG.md**

Run (on laptop repo): create `DEPLOYMENT-LOG.md` with header `# Phase 1 Deployment Log` and a timestamped line per gate result.
Expected: file exists, gate results recorded.

---

### Task 0.1: OVH pre-deploy full-VM snapshot [MANUAL — OVH panel]

**Files:** none. Records snapshot ID into `DEPLOYMENT-LOG.md`.

- [ ] **Step 1: Pre-check — confirm 1 free snapshot slot available**

OVH Manager → VPS → Backups/Snapshot. Confirm the free snapshot is unused (Gate #3 reserved it for this).

- [ ] **Step 2: Take snapshot**

OVH Manager → "Take a snapshot" of `vps-lafayette-01`. Wait until status = completed.
Expected: snapshot listed with timestamp, status "active/completed".

- [ ] **Step 3: Record + verify**

Record snapshot ID + timestamp in DEPLOYMENT-LOG.md.
**This is the catastrophic-rollback insurance for all of Phase 0–1B.** Do not proceed to Task 0.2 until snapshot confirmed complete.

---

> **🚦 EXECUTION GATE — STOP HERE until user confirms execute-tonight vs defer. Tasks below mutate the server.**

---

### Task 0.2: apt health pre-check (EOL repo) [SERVER]

**Files:** none. May modify `/etc/apt/sources.list*` (backup first).

- [ ] **Step 1: Document current apt sources**

Run: `cp -a /etc/apt/sources.list /etc/apt/sources.list.bak 2>/dev/null; ls /etc/apt/sources.list.d/; cat /etc/apt/sources.list.d/ubuntu.sources 2>/dev/null || cat /etc/apt/sources.list`
Expected: capture current state (25.04 "plucky" entries) to DEPLOYMENT-LOG.

- [ ] **Step 2: Try apt update**

Run: `sudo apt-get update 2>&1 | tee /tmp/apt-update.log; echo "EXIT=${PIPESTATUS[0]}"`
Expected: either success, OR 404s on `archive.ubuntu.com` (EOL → repos moved).

- [ ] **Step 3: If failed — repoint to old-releases**

Only if Step 2 shows 404/failures: replace `archive.ubuntu.com` and `security.ubuntu.com` with `old-releases.ubuntu.com` in the sources file, then `sudo apt-get update` again.
Run: `sudo sed -i 's|//archive.ubuntu.com|//old-releases.ubuntu.com|g; s|//security.ubuntu.com|//old-releases.ubuntu.com|g' /etc/apt/sources.list.d/ubuntu.sources && sudo apt-get update 2>&1 | tail -5`
Expected: update succeeds.

- [ ] **Step 4: Verify apt functional**

Run: `sudo apt-get install --reinstall -y ca-certificates 2>&1 | tail -3; echo "EXIT=$?"`
Expected: EXIT=0 (apt can install).
**ROLLBACK/STOP:** if apt still unrecoverable → STOP entire Phase 0; this is a strong signal Phase 1.5 reinstall is more urgent (escalate to user). Record decision.

- [ ] **Step 5: Commit (laptop repo)**

Record final sources.list state + outcome in DEPLOYMENT-LOG.md. (apt config itself is not committed; it's host state — RECOVERY.md notes the repoint procedure.)

---

### Task 0.3: Break-glass establishment [MANUAL + SERVER]

**Files:** none (secrets → Bitwarden). Note: sshd ListenAddress lockdown + firewall happen in Phase 1B; this task only *establishes and verifies* the break-glass path.

- [ ] **Step 1: [MANUAL] Test OVH KVM console**

OVH Manager → VPS → KVM/Console. Open console, confirm it reaches a login prompt.
Expected: console responsive, login prompt visible.

- [ ] **Step 2: [SERVER] Verify root password set**

Run: `sudo passwd -S root`
Expected: second field = `P` (password set). If `L`/`NP` → set one: `sudo passwd root`.

- [ ] **Step 3: [MANUAL] Store root password in Bitwarden**

Save root password to Bitwarden vault (entry: "vps-lafayette-01 root — break-glass"). This is the KVM-console fallback if Tailscale/SSH fails after Phase 1B firewall.

- [ ] **Step 4: [MANUAL] Verify SSH via Tailscale from laptop AND phone**

From laptop: `ssh -p 2223 zaky@100.117.214.25` → success. From phone (Tailscale + SSH app): connect to `100.117.214.25:2223` → success.
Expected: both reach a shell. **This is the prerequisite for the Phase 1B SSH-Tailscale-only lockdown** — do not lock SSH in 1B unless both pass here.

- [ ] **Step 5: Record**

DEPLOYMENT-LOG: KVM ✓, root pw in Bitwarden ✓, Tailscale SSH laptop ✓ + phone ✓.

---

### Task 0.4: Preservation dumps [SERVER]

**Files:** Create dumps under `/var/backups/preservation/` (local, transient — also copy off-box manually before risky ops). Scripts go to repo later (Phase 1D backup task); here run ad-hoc.

- [ ] **Step 1: Pre-check — staging dir + disk space**

Run: `sudo mkdir -p /var/backups/preservation && df -h / | tail -1`
Expected: dir created; ample free (≫ a few GB; dumps are small).

- [ ] **Step 2: Dump experimental postgres-global (double-layer)**

Run:
```bash
# Locate superuser password robustly (NTH-1: file may not exist; could be in .env/compose)
PWFILE=/opt/projects/postgre-global-vps/secrets/postgres_superuser_password.txt
if [ -f "$PWFILE" ]; then PW=$(sudo cat "$PWFILE")
else PW=$(sudo grep -rhoE 'POSTGRES_PASSWORD[=:][^"'"'"' ]*' /opt/projects/postgre-global-vps/ 2>/dev/null | head -1 | sed -E 's/.*[=:]//'); fi
[ -n "$PW" ] || { echo "PW NOT found — inspect /opt/projects/postgre-global-vps (.env, docker-compose.yml, secrets/) manually before proceeding"; exit 1; }
sudo bash -c "docker exec -e PGPASSWORD='$PW' postgres-global pg_dumpall -U postgres > /var/backups/preservation/exppg-dumpall-$(date +%F).sql"
sudo bash -c "docker exec -e PGPASSWORD='$PW' postgres-global pg_dump -U postgres --format=custom mydb_vps > /var/backups/preservation/exppg-mydb_vps-$(date +%F).dump"
```
Expected: two files created, non-zero size.

- [ ] **Step 3: Verify the custom dump (parse headers)**

Run: `pg_restore --list /var/backups/preservation/exppg-mydb_vps-*.dump | head` (or via a postgres container if pg_restore not on host)
Expected: lists archive entries (no parse error). **If verify fails → DO NOT drop the experiment in Phase 1A.**

- [ ] **Step 4: Tarball the whole experiment folder**

Run: `sudo tar -czf /var/backups/preservation/postgre-global-vps-folder-$(date +%F).tar.gz -C /opt/projects postgre-global-vps && tar tzf /var/backups/preservation/postgre-global-vps-folder-*.tar.gz >/dev/null && echo OK`
Expected: `OK` (tarball valid).

- [ ] **Step 5: Dump Interlab demo DB + mirror MinIO**

Run:
```bash
sudo bash -c "docker exec interlab-postgres pg_dumpall -U postgres > /var/backups/preservation/interlab-demo-dumpall-$(date +%F).sql"
# MinIO mirror: use mc against interlab-minio (creds from its compose/env) into a local dir
sudo mkdir -p /var/backups/preservation/interlab-minio
```
Then mirror buckets with `mc` (alias the interlab-minio endpoint with its root creds → `mc mirror`). Verify dump non-zero + bucket file count > 0.
Expected: demo DB dump + MinIO objects mirrored locally. (Arsip murni — no ETL, per spec §6.)

- [ ] **Step 6: Dump Sibyl DB + mirror MinIO (opportunistic, active users)**

Run: `sudo bash -c "docker exec sibyl-postgres pg_dumpall -U postgres > /var/backups/preservation/sibyl-dumpall-$(date +%F).sql"` + `mc mirror` sibyl-minio buckets into `/var/backups/preservation/sibyl-minio/`.
Expected: Sibyl DB dump + objects mirrored. (Owned by Sibyl; preserved before any infra change near it.)

- [ ] **Step 7: Record**

DEPLOYMENT-LOG: list all preservation artifacts + sizes + verify status.

---

### Task 0.4.5: Drop experimental postgres-global (post-dump-verify) [SERVER]

**Files:** none (container removal + volume "rename"). **Frees the `postgres-global` name + `pg_global_data` volume for the fresh deploy in Phase 1A.**

- [ ] **Step 1: GATE — confirm dump verified**

Confirm Task 0.4 Step 3 (`pg_restore --list`) PASSED and Step 4 tarball valid. 
**If NOT verified → STOP. Do not drop.** (Spec §6: drop only after dump verified.)

- [ ] **Step 2: Stop + remove the experiment container**

Run: `docker stop postgres-global && docker rm postgres-global`
Expected: container gone. (This is the `postgres:17-alpine` experiment, NOT the new one — which doesn't exist yet.)

- [ ] **Step 3: "Rename" the data volume (Docker has NO `volume rename` — emulate via copy)**

Run:
```bash
docker volume create pg_global_data_old
docker run --rm -v pg_global_data:/from:ro -v pg_global_data_old:/to alpine sh -c "cp -a /from/. /to/ && echo copied"
docker volume rm pg_global_data
```
Expected: `copied`; `pg_global_data` removed (name freed); `pg_global_data_old` retains the experiment data.
**Note:** `docker volume rename` does not exist — this copy+rm achieves the safety-rename. `pg_global_data_old` scheduled for deletion **after Phase 1 sign-off + 7 days stable** (spec §6).

- [ ] **Step 4: Verify name + volume freed**

Run: `docker ps -a --format '{{.Names}}' | grep -x postgres-global || echo "name free (good)"; docker volume ls | grep pg_global`
Expected: "name free (good)"; only `pg_global_data_old` listed (NOT `pg_global_data`).

- [ ] **Step 5: Record** drop + volume-copy + deletion-schedule in DEPLOYMENT-LOG.

---

### Task 0.5: Pre-cutover hygiene [SERVER]

**Files:** none (container removal + log truncation).

- [ ] **Step 1: Confirm the stray container identity**

Run: `docker inspect admiring_mendeleev --format '{{.Config.Cmd}} | {{.State.StartedAt}}'`
Expected: the Redis-ping node one-liner from the worktree (matches spec §1). Confirms safe to remove.

- [ ] **Step 2: Remove stray + test containers**

Run: `docker rm -f admiring_mendeleev whoami-storage`
Expected: both removed. (Neither is a tracked service.)

- [ ] **Step 3: Verify Sibyl/Interlab untouched**

Run: `docker ps --format '{{.Names}}' | grep -E '^sibyl-|^interlab-' | sort`
Expected: all 7 Sibyl + 5 Interlab demo containers still present (zero-touch preserved).

- [ ] **Step 4: Truncate Sibyl crash-loop logs (idempotent, no restart)**

Run:
```bash
for c in sibyl-worker-ai sibyl-worker-default; do
  LP=$(docker inspect "$c" --format '{{.LogPath}}'); sudo truncate -s 0 "$LP" && echo "truncated $c"
done
```
Expected: both log files zeroed; containers NOT restarted. (Root-cause crash-loop = escalate to Sibyl owner; out of scope.)

- [ ] **Step 5: Record** stray removal + log truncation in DEPLOYMENT-LOG.

---

### Task 0.6: System tuning — swap [SERVER]

**Files:** Create `/swapfile`; modify `/etc/fstab`. Mirror intent into repo `system-config/`.

- [ ] **Step 1: Pre-check — confirm no swap**

Run: `swapon --show; free -h | grep -i swap`
Expected: empty / `Swap: 0B` (matches spec §1).

- [ ] **Step 2: Create 4 GB swapfile**

Run: `sudo fallocate -l 4G /swapfile && sudo chmod 600 /swapfile && sudo mkswap /swapfile && sudo swapon /swapfile`
Expected: `swapon --show` lists `/swapfile 4G`.

- [ ] **Step 3: Persist in fstab**

Run: `grep -q '/swapfile' /etc/fstab || echo '/swapfile none swap sw 0 0' | sudo tee -a /etc/fstab`
Expected: fstab contains the swapfile line.

- [ ] **Step 4: Verify**

Run: `free -h | grep -i swap`
Expected: `Swap: 4.0Gi`.

- [ ] **Step 5: Commit (laptop repo)** — add `system-config/README-host-tuning.md` documenting swap step + fstab line.

---

### Task 0.7: System tuning — sysctl [SERVER]

**Files:** Create `/etc/sysctl.d/99-interlab.conf`; commit copy to repo `system-config/sysctl.d/99-interlab.conf`.

- [ ] **Step 1: Write sysctl drop-in**

Create `/etc/sysctl.d/99-interlab.conf`:
```
vm.swappiness = 10
vm.dirty_background_ratio = 5
vm.dirty_ratio = 10
vm.overcommit_memory = 1
fs.inotify.max_user_watches = 524288
fs.inotify.max_user_instances = 512
```

- [ ] **Step 2: Apply**

Run: `sudo sysctl --system 2>&1 | grep 99-interlab`
Expected: drop-in loaded.

- [ ] **Step 3: Verify values active**

Run: `sysctl vm.swappiness vm.overcommit_memory fs.inotify.max_user_instances`
Expected: `vm.swappiness = 10`, `vm.overcommit_memory = 1`, `fs.inotify.max_user_instances = 512`.

- [ ] **Step 4: Commit** `system-config/sysctl.d/99-interlab.conf` to repo.

---

### Task 0.8: System tuning — persist THP=madvise [SERVER]

**Files:** Create `/etc/systemd/system/disable-thp.service`; commit copy to repo.

- [ ] **Step 1: Pre-check current THP**

Run: `cat /sys/kernel/mm/transparent_hugepage/enabled`
Expected: `always [madvise] never` (already madvise — we persist it).

- [ ] **Step 2: Create systemd unit**

Create `/etc/systemd/system/disable-thp.service`:
```ini
[Unit]
Description=Set THP to madvise (Postgres latency)
After=local-fs.target
[Service]
Type=oneshot
ExecStart=/bin/sh -c 'echo madvise > /sys/kernel/mm/transparent_hugepage/enabled'
[Install]
WantedBy=multi-user.target
```

- [ ] **Step 3: Enable + start**

Run: `sudo systemctl daemon-reload && sudo systemctl enable --now disable-thp.service && systemctl is-active disable-thp.service`
Expected: `active` (oneshot exited 0); `cat .../enabled` still shows `[madvise]`.

- [ ] **Step 4: Commit** `system-config/disable-thp.service` to repo.

---

### Task 0.9: System tuning — noatime root [SERVER]

**Files:** Modify `/etc/fstab` (root line); live remount.

- [ ] **Step 1: Pre-check current mount opts**

Run: `findmnt -no OPTIONS / `
Expected: includes `relatime` (marginal gain to noatime; zero-risk, per spec §4).

- [ ] **Step 2: Add noatime to fstab root line**

Edit `/etc/fstab`: on the `LABEL=cloudimg-rootfs / ext4` line, change options to `discard,commit=30,errors=remount-ro,noatime`. Back up fstab first: `sudo cp /etc/fstab /etc/fstab.bak`.

- [ ] **Step 3: Live remount**

Run: `sudo mount -o remount,noatime / && findmnt -no OPTIONS /`
Expected: options now include `noatime`.
**ROLLBACK:** if remount errors → `sudo cp /etc/fstab.bak /etc/fstab` and leave relatime (non-critical).

- [ ] **Step 4: Commit** note to `system-config/README-host-tuning.md`.

---

### Task 0.10: Docker daemon log rotation + live-restore [SERVER]

**Files:** Create `/etc/docker/daemon.json`; commit copy to repo `system-config/docker-daemon.json`.

- [ ] **Step 1: Pre-check — confirm no existing daemon.json**

Run: `cat /etc/docker/daemon.json 2>&1`
Expected: "No such file" (matches spec §1). If it exists, merge instead of overwrite.

- [ ] **Step 2: Write daemon.json**

Create `/etc/docker/daemon.json`:
```json
{ "log-driver": "json-file", "log-opts": { "max-size": "10m", "max-file": "3" }, "live-restore": true }
```

- [ ] **Step 3: Reload docker (NON-disruptive — not restart)**

Run: `sudo systemctl reload docker && docker info --format '{{.LoggingDriver}} live-restore={{.LiveRestoreEnabled}}'`
Expected: `json-file live-restore=true`. Reload (SIGHUP) applies config without stopping running containers.
**ROLLBACK:** if reload fails / docker unhealthy → `sudo rm /etc/docker/daemon.json && sudo systemctl reload docker`. Do NOT `restart` docker during Phase 0 (would blip Sibyl until live-restore proven).

- [ ] **Step 4: Verify Sibyl/Interlab still running**

Run: `docker ps --format '{{.Names}} {{.Status}}' | grep -E 'sibyl-|interlab-' | head`
Expected: containers still Up. (New log rotation applies to future/recreated containers; existing keep old config — Sibyl unbounded until Phase 2, noted.)

- [ ] **Step 5: Commit** `system-config/docker-daemon.json` to repo.

---

### Task 0.11: journald caps [SERVER]

**Files:** Modify `/etc/systemd/journald.conf`; commit copy to repo.

- [ ] **Step 1: Set caps**

Edit `/etc/systemd/journald.conf` `[Journal]` section → set `SystemMaxUse=1G`, `SystemMaxFileSize=100M`, `SystemKeepFree=2G`.

- [ ] **Step 2: Restart journald (safe)**

Run: `sudo systemctl restart systemd-journald && journalctl --disk-usage`
Expected: journald restarts; disk-usage reported (will trend ≤1G).

- [ ] **Step 3: Commit** `system-config/journald.conf` to repo.

---

### Task 0.12: SOPS/age init + generate fresh secrets [LAPTOP]

**Files:** Laptop `~/.config/sops/age/keys.txt` (NEVER committed); repo `.sops.yaml` (recipient); `secrets/*.yaml` (SOPS-encrypted, committed).

- [ ] **Step 1: Generate age keypair (laptop)**

Run: `age-keygen -o ~/.config/sops/age/keys.txt && grep 'public key' ~/.config/sops/age/keys.txt`
Expected: prints `# public key: age1...`. **Back up private key to Bitwarden + offline hard-copy now** (per spec §5 anti-pattern: never on server).

- [ ] **Step 2: Populate .sops.yaml recipient**

Edit repo `.sops.yaml` → replace `REPLACE_WITH_AGE_PUBLIC_KEY` with the `age1...` public key from Step 1.

- [ ] **Step 3: Generate fresh secrets into plaintext temp, then encrypt**

Generate (laptop): Postgres superuser pw, per-app role pws (interlab_prod/staging app roles), MinIO root + storage service-account keys, Coolify APP_KEY, Supabase JWT signing secret + anon + service_role (signed), dashboard pw, Cloudflare API token (from Gate), B2 + rclone-crypt keys.
```bash
openssl rand -base64 32   # repeat per secret; JWT-derived keys signed with the JWT secret
```
Write into `secrets/{infrastructure,supabase,external-services,bootstrap}.yaml` + `secrets/apps/{interlab-prod,interlab-staging,sibyl}.yaml`, then:
```bash
for f in secrets/*.yaml secrets/apps/*.yaml; do sops --encrypt --in-place "$f"; done
```
Expected: each file shows `sops:` metadata + encrypted values.

- [ ] **Step 4: Verify round-trip decrypt**

Run: `sops --decrypt secrets/infrastructure.yaml | head`
Expected: plaintext values readable (proves the laptop key + .sops.yaml work). **This is the recovery-critical test** (RECOVERY.md depends on it).

- [ ] **Step 5: Commit** encrypted `secrets/**` + `.sops.yaml` to repo. Confirm `git status` shows NO plaintext / NO `keys.txt` (gitignored).

---

### Task 0.13: Repo structure scaffold [LAPTOP]

**Files:** Create empty dirs + `RECOVERY.md` skeleton; commit.

- [ ] **Step 1: Scaffold directories**

Run (repo root):
```bash
mkdir -p coolify-resources/{postgres-global,minio-global,supabase,uptime-kuma,netdata} \
         system-config/sysctl.d scripts/{backup,recovery,deploy} cron secrets/apps
touch coolify-resources/.gitkeep scripts/backup/.gitkeep cron/.gitkeep
```
Expected: tree matches spec §16.

- [ ] **Step 2: Create RECOVERY.md skeleton**

Create `RECOVERY.md` with the §8 step sequence as headed sections (fresh OS → install tools → retrieve age key → clone → decrypt → restore Coolify/volumes/acme.json → inject env → start order → verify), each with a "TODO: fill realistic timing post-Phase-1" note that the DEPLOYMENT-LOG will feed.

- [ ] **Step 3: Commit** scaffold + RECOVERY.md skeleton.

---

## Self-Review (writing-plans)

**Spec coverage (§ vs task):** §10 Phase-0 row → Tasks 0.0–0.13 ✓ (snapshot 0.1, apt 0.2, break-glass 0.3, dumps 0.4, hygiene 0.5, tuning 0.6–0.11, SOPS/secrets 0.12, repo 0.13). §4 tuning → 0.6–0.11 ✓. §5 secrets → 0.12 ✓. §6 dumps+hygiene → 0.4–0.5 ✓. §11 rollback → encoded in 0.2/0.9/0.10 + execution gate. Gate: disk verify non-blocking 0.0 ✓.

**Deferred to later plans:** Coolify/postgres/minio (1A) · firewall + sshd ListenAddress lockdown + Traefik cutover (1B) · backup automation scripts (1D) — Phase 0 only scaffolds `scripts/backup/`.

**Placeholder scan:** RECOVERY.md skeleton intentionally has TODO-timing (filled post-execution); all action steps have concrete commands. No "add error handling" hand-waves.

**Consistency:** secret file names match spec §5 / .sops.yaml. `/var/backups/preservation/` staging consistent with §8 `/var/backups/`. daemon.json identical to §4.

---

## Execution Handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-25-phase0-prep-safety.md`.**

> ⚠️ Before choosing execution mode, the **execute-tonight vs defer-post-demo** decision (see chat) must be made — this plan mutates a production server from Task 0.2 onward.

Two execution options (when ready):
1. **Subagent-Driven (recommended)** — fresh subagent per task, review between tasks. *Caveat for infra:* subagents run real server commands; review gates between tasks are mandatory here, not optional.
2. **Inline Execution** — execute in this session with checkpoints.

**Next:** after you review this Phase 0 plan, I write **Phase 1A (foundation)**, then **1B (cutover)** — iteratively per your timeline.
