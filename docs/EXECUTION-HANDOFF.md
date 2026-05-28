# Execution Handoff — Interlab Global Infra Phase 1

**For a fresh Claude session resuming execution.** Read this first, then the spec + the relevant phase plan.

## Where we are (2026-05-25)
- Brainstorm → design spec → all 6 phase plans → backup scripts: **DONE, committed, pushed** (GitLab, commit `ed7c2e8`).
- **Path B locked:** execute **Phase 0 + Phase 1A tonight** (~5–6h then mandatory 6h sleep); **defer 1B–1E to post-demo**. Demo 2026-05-26 ~19:00 (deadline ~16:00) showcases the design + the existing functional system — NOT a full cutover.
- This is a **production** server (`vps-lafayette-01`) with active users (Sibyl) + finance/tax data.

## Before touching the server — pre-flight gates (user-owned, ~70 min)
The user completes these and says **"gates resolved"**:
1. OVH panel: record disk Plan/Storage (NVMe expected — non-blocking).
2. OVH full-VM **snapshot** (catastrophic rollback insurance) — MANDATORY before any server mutation.
3. Break-glass: KVM console works + root pw in Bitwarden + Tailscale SSH from laptop **and** phone.
4. Laptop: `age-keygen` + populate `.sops.yaml` + generate all secrets + SOPS-encrypt + commit; back up age key (Bitwarden + offline). **age key never on server.**
5. Cloudflare API token → SOPS.
(Domain = `interlab-portal.com` ✓ locked. OVH automated backup ✓ skip, manual-only.)

## How to resume (after "gates resolved")
1. Invoke **`superpowers:executing-plans`** (Mode A = **inline collaborative**: I run [SERVER] steps + verify; user does [LAPTOP]/[MANUAL]; review gate between every task).
2. Start at **`docs/superpowers/plans/2026-05-25-phase0-prep-safety.md` Task 0.2** (Tasks 0.0/0.1 = the pre-flight gates above).
3. Then `…-phase1a-foundation.md`. After 1A → **sleep 6h**. (1B–1E = post-demo.)

## Execution order + time-boxes
`Phase 0 (~2h) → 1A (~4h) → 💤 sleep 6h → [post-demo: 1B cutover → 1C Supabase (3h box) → 1D ops → 1E verify]`

## Working rules (NON-NEGOTIABLE — see memory)
- **Per task:** expected vs actual → user confirms before next task. Surprise → STOP, don't auto-proceed.
- **Rollback:** task fails >2 retries → STOP, defer to post-demo (don't force).
- **Commit protocol:** propose 2-sentence milestone + "OK commit?" → wait for "iya" → commit local; **user pushes manually**. Never auto-commit/push.
- **Sleep mandatory** post-1A (or earlier if fatigue).
- **Don't hardcode defaults** — pin versions, verify runtime-specific values (Coolify resolver/paths) at execute.

## Decisions to keep in mind (full rationale in spec)
- postgres-global = **`supabase/postgres:15.8.1.085` (PG15)**, not PG17 (matches official self-host; pgvector bundled).
- Disk = **NVMe committed-default, panel-unconfirmed** → flip 3 knobs (`random_page_cost`/`effective_io_concurrency`/Sentry tier) only if panel shows non-NVMe.
- Coolify proxy **held down** through 1A (manual Traefik owns 80/443 until 1B cutover).
- Sentry = **cloud** + mandatory PII-strip; OS reinstall to 26.04 LTS = Phase 1.5 (≤ 2026-09-30).

## Key files
- Spec: `docs/superpowers/specs/2026-05-25-interlab-global-infra-design.md`
- Plans: `docs/superpowers/plans/2026-05-25-phase{0,1a,1b,1c,1d,1e}-*.md`
- Backup scripts: `scripts/backup/`
- Live log during execution: `DEPLOYMENT-LOG.md` (record per-task actual timing → refines `RECOVERY.md`)
