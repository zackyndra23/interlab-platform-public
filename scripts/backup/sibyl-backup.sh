#!/usr/bin/env bash
# Opportunistic backup of the (zero-touch, owned-by-Sibyl) legacy stack. 14d retention.
# Phase 2: drop this script after Sibyl consolidates into postgres-global + minio-global.
# sibyl-minio sync is OPTIONAL — needs sibyl's network name + creds in backup.env
# (SIBYL_MINIO_* + SIBYL_NET); skipped if unset.
. "$(dirname "$0")/lib.sh"

DIR="$STAGE_ROOT/sibyl"; mkdir -p "$DIR"
HC="${HC_SIBYL:-}"
db_out="$DIR/sibyl-db-${DATE_UTC}.sql"

hc_ping "$HC" start
log "dumping sibyl-postgres"
docker exec sibyl-postgres sh -c 'export PGPASSWORD="$POSTGRES_PASSWORD"; pg_dumpall -U "${POSTGRES_USER:-postgres}"' \
  > "$db_out" || { hc_ping "$HC" fail; die "sibyl DB dump failed"; }
[ -s "$db_out" ] || { hc_ping "$HC" fail; die "empty sibyl DB dump"; }
upload "$db_out" "sibyl" || { hc_ping "$HC" fail; die "sibyl DB upload failed"; }

# Optional sibyl-minio sync (containerized rclone on sibyl's network)
if [ -n "${SIBYL_MINIO_KEY:-}" ] && [ -n "${SIBYL_NET:-}" ]; then
  log "syncing sibyl-minio"
  docker run --rm --network "$SIBYL_NET" \
    -v /root/.config/rclone:/config/rclone:ro -e RCLONE_CONFIG=/config/rclone/rclone.conf \
    -e RCLONE_CONFIG_SM_TYPE=s3 -e RCLONE_CONFIG_SM_PROVIDER=Minio \
    -e RCLONE_CONFIG_SM_ENDPOINT="${SIBYL_MINIO_ENDPOINT:-http://sibyl-minio:9000}" \
    -e RCLONE_CONFIG_SM_ACCESS_KEY_ID="$SIBYL_MINIO_KEY" \
    -e RCLONE_CONFIG_SM_SECRET_ACCESS_KEY="${SIBYL_MINIO_SECRET:?}" \
    rclone/rclone sync sm: "${RCLONE_REMOTE}sibyl-minio" --transfers 8 \
    || log "WARN: sibyl-minio sync failed (non-fatal, owned by Sibyl)"
else
  log "sibyl-minio sync skipped (SIBYL_MINIO_*/SIBYL_NET not set)"
fi
prune_local "$DIR" 14
hc_ping "$HC"
log "sibyl-backup complete"
