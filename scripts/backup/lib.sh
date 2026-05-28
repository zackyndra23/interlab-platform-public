#!/usr/bin/env bash
# ============================================================================
# Interlab backup — shared library. `source` this from every backup script.
#
# SECRETS MODEL (Phase 1):
#   - DB passwords are NOT stored on the host. Each script reuses the password
#     already inside the relevant container via `docker exec ... printenv`.
#   - rclone B2 + crypt creds live in root's ~/.config/rclone/rclone.conf (mode 600),
#     configured in Phase 1D.5 Step 2. The age master key stays on the LAPTOP only.
#   - Non-secret operational config (healthchecks URLs, db list) lives in
#     /etc/interlab-backup/backup.env (mode 600 root), populated in Phase 1D from
#     SOPS-decrypted values. NOT committed.
#   This keeps the age master key off-server while allowing automated cron backups.
# ============================================================================
set -euo pipefail

BK_ENV="${BK_ENV:-/etc/interlab-backup/backup.env}"
# shellcheck disable=SC1090
[ -f "$BK_ENV" ] && . "$BK_ENV"

STAGE_ROOT="${STAGE_ROOT:-/var/backups}"
# crypt remote 'b2crypt' wraps 'b2:interlab-backups', so paths are b2crypt:postgres/, b2crypt:wal/, etc.
RCLONE_REMOTE="${RCLONE_REMOTE:-b2crypt:}"
PG_CTR="${PG_CTR:-postgres-global}"
LOG_TAG="interlab-backup"

log()  { echo "$(date -u +%FT%TZ) [$LOG_TAG] $*" ; }
die()  { log "ERROR: $*" ; exit 1 ; }

# healthchecks.io dead-man-switch. Args: <full-check-url> [start|fail]   (empty = success)
hc_ping() {
  local url="${1:-}" state="${2:-}"
  [ -n "$url" ] || return 0
  curl -fsS -m 10 --retry 3 "${url}${state:+/$state}" -o /dev/null 2>/dev/null || log "WARN: healthchecks ping failed ($state)"
}

# Run a shell command INSIDE the postgres container with PGPASSWORD exported from its own env.
# stdout streams to the caller (so redirection to a host file works). Arg: <command string>
pg_run() { docker exec "$PG_CTR" sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; '"$1" ; }

# Verify a custom-format dump by parsing its TOC (uses the container's pg_restore). Arg: <host dump path>
pg_verify_dump() { docker exec -i "$PG_CTR" pg_restore --list - < "$1" >/dev/null ; }

# Upload a local path to a crypt-remote subdir. Args: <local-path> <remote-subdir>
upload() { rclone copy --transfers 4 "$1" "${RCLONE_REMOTE}$2/" ; }

# Delete local staged files older than N days (B2 holds the retention copy). Args: <dir> <days>
prune_local() { find "$1" -type f -mtime "+$2" -delete 2>/dev/null || true ; }

DATE_UTC="$(date -u +%F)"
