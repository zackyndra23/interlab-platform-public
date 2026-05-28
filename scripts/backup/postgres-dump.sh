#!/usr/bin/env bash
# Per-database logical dump (granular, portable, cross-version). NOT a PITR base
# (see postgres-basebackup.sh for PITR). Daily; 7d local, 30d off-site (B2 lifecycle).
. "$(dirname "$0")/lib.sh"

DBS="${BACKUP_DBS:-interlab_prod interlab_staging}"
DIR="$STAGE_ROOT/postgres"; mkdir -p "$DIR"
HC="${HC_POSTGRES_DUMP:-}"

hc_ping "$HC" start
for db in $DBS; do
  out="$DIR/${db}-${DATE_UTC}.dump"
  log "pg_dump $db -> $out"
  pg_run "pg_dump -Fc -Z6 -U postgres -d $db" > "$out" || { hc_ping "$HC" fail; die "pg_dump failed: $db"; }
  [ -s "$out" ] || { hc_ping "$HC" fail; die "empty dump: $db"; }
  pg_verify_dump "$out" || { hc_ping "$HC" fail; die "verify (pg_restore --list) failed: $db"; }
  upload "$out" "postgres" || { hc_ping "$HC" fail; die "upload failed: $db"; }
  log "ok $db"
done
prune_local "$DIR" 7
hc_ping "$HC"
log "postgres-dump complete"
