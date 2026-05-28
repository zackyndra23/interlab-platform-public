#!/usr/bin/env bash
# Coolify state: its own DB (all resource/env config) + /data/coolify (proxy config,
# acme.json, ssh keys). Enables cross-OS rebuild (Q19) without restoring Coolify-from-scratch.
# COOLIFY_DB_CTR: verify the actual container name at execute (docker ps | grep -i coolify.*db).
. "$(dirname "$0")/lib.sh"

DIR="$STAGE_ROOT/coolify"; mkdir -p "$DIR"
HC="${HC_COOLIFY:-}"
COOLIFY_DB_CTR="${COOLIFY_DB_CTR:-coolify-db}"
db_out="$DIR/coolify-db-${DATE_UTC}.sql"
data_out="$DIR/coolify-data-${DATE_UTC}.tar.gz"

hc_ping "$HC" start
log "dumping Coolify DB ($COOLIFY_DB_CTR)"
docker exec "$COOLIFY_DB_CTR" sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; pg_dumpall -U "${POSTGRES_USER:-postgres}"' \
  > "$db_out" || { hc_ping "$HC" fail; die "coolify DB dump failed (check COOLIFY_DB_CTR name)"; }
[ -s "$db_out" ] || { hc_ping "$HC" fail; die "empty coolify DB dump"; }

log "tarring /data/coolify (incl acme.json + proxy config)"
tar -czf "$data_out" -C /data coolify || { hc_ping "$HC" fail; die "coolify /data tar failed"; }
tar tzf "$data_out" >/dev/null || { hc_ping "$HC" fail; die "coolify tar verify failed"; }

upload "$db_out" "coolify"  || { hc_ping "$HC" fail; die "upload (db) failed"; }
upload "$data_out" "coolify" || { hc_ping "$HC" fail; die "upload (data) failed"; }
prune_local "$DIR" 7
hc_ping "$HC"
log "coolify-backup complete"
