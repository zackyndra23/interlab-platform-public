#!/usr/bin/env bash
# Physical base backup for PITR. WAL (postgres-wal-archive.sh -> wal-push.sh) replays
# ONTO this base — logical dumps CANNOT do PITR. Daily; 7d off-site = PITR window.
#
# PREREQS (verify in Phase 1A/1D):
#   - wal_level >= replica (PG15 default 'replica'; archive_mode=on already requires it)
#   - max_wal_senders > 0 (PG15 default 10)
#   - role 'postgres' has REPLICATION (supabase/postgres superuser does)
#   - pg_hba allows a local 'replication' connection for postgres. If pg_basebackup errors
#     "no pg_hba.conf entry for replication connection", add a replication line + reload.
. "$(dirname "$0")/lib.sh"

DIR="$STAGE_ROOT/postgres-base"; mkdir -p "$DIR"
HC="${HC_POSTGRES_BASE:-}"
out="$DIR/base-${DATE_UTC}.tar.gz"

hc_ping "$HC" start
log "pg_basebackup (physical) -> $out"
# Take a tar-format base with streamed WAL, inside the container, then stream the dir to a host tar.
pg_run "rm -rf /tmp/basebackup && pg_basebackup -U postgres -D /tmp/basebackup -Ft -z -Xs -P" \
  || { hc_ping "$HC" fail; die "pg_basebackup failed (check pg_hba replication + wal_level)"; }
docker exec "$PG_CTR" tar -czf - -C /tmp/basebackup . > "$out" || { hc_ping "$HC" fail; die "tar stream failed"; }
docker exec "$PG_CTR" rm -rf /tmp/basebackup || true
[ -s "$out" ] || { hc_ping "$HC" fail; die "empty base backup"; }
tar tzf "$out" >/dev/null || { hc_ping "$HC" fail; die "base tar verify failed"; }
upload "$out" "basebackup" || { hc_ping "$HC" fail; die "upload failed"; }
prune_local "$DIR" 2   # keep last ~2 locally; B2 retains 7d
hc_ping "$HC"
log "postgres-basebackup complete"
