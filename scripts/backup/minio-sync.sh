#!/usr/bin/env bash
# Sync minio-global objects to encrypted off-site. minio-global S3 is INTERNAL-ONLY
# (no host port, spec §7/Q10), so rclone runs in a container ON the interlab-global network.
# Tiered cadence (spec §8): MODE=hourly -> finance prefixes only; MODE=daily -> everything (+ check).
# Scoped service-account creds (STORAGE_SA_KEY/SECRET) come from backup.env; crypt remote from host rclone.conf.
. "$(dirname "$0")/lib.sh"

MODE="${1:-daily}"
HC="${HC_MINIO_SYNC:-}"
: "${STORAGE_SA_KEY:?STORAGE_SA_KEY missing in backup.env}"
: "${STORAGE_SA_SECRET:?STORAGE_SA_SECRET missing in backup.env}"

SRC="miniog:supabase-storage"
DST="${RCLONE_REMOTE}minio/supabase-storage"
FIN_INCLUDES=( --include "*invoices*/**" --include "*receipts*/**" --include "*efaktur*/**" \
               --include "*tax*/**" --include "*finance*/**" --include "*documents*/**" )

# rclone container: host rclone.conf (b2crypt) mounted RO; minio S3 source via env-defined remote 'miniog'
run_rclone() {
  docker run --rm --network interlab-global \
    -v /root/.config/rclone:/config/rclone:ro \
    -e RCLONE_CONFIG=/config/rclone/rclone.conf \
    -e RCLONE_CONFIG_MINIOG_TYPE=s3 \
    -e RCLONE_CONFIG_MINIOG_PROVIDER=Minio \
    -e RCLONE_CONFIG_MINIOG_ENDPOINT=http://minio-global:9000 \
    -e RCLONE_CONFIG_MINIOG_ACCESS_KEY_ID="$STORAGE_SA_KEY" \
    -e RCLONE_CONFIG_MINIOG_SECRET_ACCESS_KEY="$STORAGE_SA_SECRET" \
    rclone/rclone "$@"
}

hc_ping "$HC" start
if [ "$MODE" = hourly ]; then
  run_rclone sync "$SRC" "$DST" "${FIN_INCLUDES[@]}" --transfers 8 \
    || { hc_ping "$HC" fail; die "minio hourly (finance) sync failed"; }
else
  run_rclone sync "$SRC" "$DST" --transfers 8 \
    || { hc_ping "$HC" fail; die "minio daily sync failed"; }
  run_rclone check "$SRC" "$DST" --one-way || log "WARN: minio check found differences"
fi
hc_ping "$HC"
log "minio-sync ($MODE) complete"
