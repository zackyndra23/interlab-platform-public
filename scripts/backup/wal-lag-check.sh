#!/usr/bin/env bash
# Hourly. Watches the in-container WAL archiver (pg_stat_archiver). Alerts on archive
# failures or staleness -> healthchecks (-> Telegram [CRIT]). Mitigation for R4 (WAL
# accumulation silent-death). Disk-fill from a stuck wal-push is caught by Netdata's
# /var/backups disk alert + wal-push.sh's own ping.
. "$(dirname "$0")/lib.sh"

HC="${HC_WAL:-}"
STALE_LIMIT="${WAL_STALE_LIMIT:-300}"   # seconds

read -r failed stale < <(pg_run "psql -tAF' ' -U postgres -c \
  \"SELECT failed_count, EXTRACT(EPOCH FROM (now()-COALESCE(last_archived_time, now())))::int FROM pg_stat_archiver\"")
failed="${failed:-0}"; stale="${stale:-0}"
log "archiver: failed_count=$failed last_archived_stale=${stale}s"

if [ "$failed" -gt 0 ] || [ "$stale" -gt "$STALE_LIMIT" ]; then
  hc_ping "$HC" fail
  die "WAL archiver unhealthy (failed_count=$failed stale=${stale}s > ${STALE_LIMIT}s)"
fi
hc_ping "$HC"
log "wal-lag-check ok"
