#!/usr/bin/env bash
# Cluster-wide roles/permissions (needed to restore role grants alongside per-db dumps).
. "$(dirname "$0")/lib.sh"

DIR="$STAGE_ROOT/postgres"; mkdir -p "$DIR"
HC="${HC_POSTGRES_GLOBALS:-}"
out="$DIR/globals-${DATE_UTC}.sql"

hc_ping "$HC" start
log "pg_dumpall --globals-only -> $out"
pg_run "pg_dumpall --globals-only -U postgres" > "$out" || { hc_ping "$HC" fail; die "pg_dumpall globals failed"; }
[ -s "$out" ] || { hc_ping "$HC" fail; die "empty globals dump"; }
upload "$out" "postgres" || { hc_ping "$HC" fail; die "upload failed"; }
prune_local "$DIR" 7
hc_ping "$HC"
log "postgres-globals complete"
