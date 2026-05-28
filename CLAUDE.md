# Interlab Infrastructure

## Purpose
Self-hosted shared infrastructure untuk multiple internal webapps Interlab 
Sentra Solusi Indonesia. Setup foundational, reusable across apps.

## Repo Scope
Infrastructure + app integration (EXPANDED Phase 1.6, 2026-05-25; was "HANYA infrastructure").
- Infra: `coolify-resources/`, `system-config/`, `scripts/`, runbook, secret templates.
- Apps consolidated under `apps/<name>/` (Phase 1.6). First: `apps/interlabs-crm-demo/`
  (Next.js frontend + Node/Express api). Per-app `.env` (gitignored) + `.env.example` (committed).
- Deploy an app: `cd apps/<name> && docker compose up -d --build` (Mechanism B / A2-Direct;
  Coolify-managed routing pending the 1B cutover + coolify-proxy — deviation #12).
- Reference-only IaC (NOT deployed-from): `apps/<name>/<component>-reference/`
  (e.g. `data-stack-reference/` — the demo data stack actually runs from `/home/zaky/data-stack/`,
  deviations #14/#16). Webapp source-of-truth/rollback: original repo `/opt/projects/interlabs-crm-demo`.
- Secrets = **Pilihan B** (no SOPS): `.env` (gitignored) + `/root/.coolify-secrets-backup.txt` + Bitwarden.
- **Current state + all deviations (#1–#19): see `DEPLOYMENT-LOG.md`.**

## Stack (LOCKED)
- Host: 1× OVH server [tier TBD]
- Orchestration: Coolify
- DB: PostgreSQL via Supabase self-hosted
- Storage: MinIO (backend untuk Supabase Storage API)
- Auth: Supabase GoTrue
- Error tracking: Sentry self-hosted
- Uptime: Uptime Kuma
- DNS: Cloudflare wildcard
- Reverse proxy: Coolify built-in (Traefik)

## Anti-Patterns to Reject
- Kubernetes / Docker Swarm / service mesh
- Microservices split
- Cloud-managed alternatives (Supabase Cloud, RDS, S3)
- Premature complexity (Grafana stack, Prometheus, Loki)
- Clerk / Auth0 (use GoTrue)

## Philosophy
- Self-hosted everything for data sovereignty
- Phase 1 disciplined, defer complexity
- Monolith-first
- Avoid over-engineering
- Master spec as single source of truth

## Working Style
- Sequential, methodical
- Bullet points dengan context per point
- Bahasa Indonesia + English technical terms
- Validate per section before moving on

## Files of Note
- DEPLOYMENT-LOG.md         — authoritative current state + all deviations (#1–#19)
- docs/access-guide.md      — operator access reference (public/admin/internal/SSH-tunnels/ops)
- RECOVERY.md               — disaster recovery + rollback runbook
- docs/server-info.md       — output dari server dump script
- docs/decisions-input.md   — input untuk brainstorming
- docs/brainstorm-output.md — hasil /superpowers:brainstorm