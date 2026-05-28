#!/usr/bin/env bash
# HOST cron (frequent, e.g. */5 min). Ships staged WAL (from postgres-wal-archive.sh)
# to the encrypted off-site remote, then removes the local copies. Keeps file-RPO low.
# NOTE: a wal-push failure does NOT show in pg_stat_archiver (that only tracks the in-container
# stage step) — hence its own healthchecks ping + rely on Netdata disk alert on /var/backups.
. "$(dirname "$0")/lib.sh"

STAGE="/var/backups/wal-stage"; mkdir -p "$STAGE"
HC="${HC_WAL_PUSH:-}"

hc_ping "$HC" start
# move = upload then delete source; --min-age guards against any not-yet-renamed temp files
if find "$STAGE" -maxdepth 1 -type f ! -name '.*' | read -r _; then
  rclone move "$STAGE" "${RCLONE_REMOTE}wal/" --transfers 8 --min-age 10s --exclude '.*' \
    || { hc_ping "$HC" fail; die "wal push to ${RCLONE_REMOTE}wal/ failed"; }
fi
hc_ping "$HC"
log "wal-push complete"
