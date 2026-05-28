#!/usr/bin/env bash
# archive_command — runs INSIDE the postgres-global container (mounted at /wal-archive/).
# Args: %p (full source path) %f (filename). Stages WAL to /wal-stage, a HOST bind-mount
# (compose: /var/backups/wal-stage:/wal-stage). The host cron wal-push.sh ships it to B2.
# Returns non-zero on failure so Postgres RETRIES and keeps the WAL locally (anti silent-death).
# This script intentionally does NOT use rclone/lib.sh (not present in the DB container).
set -euo pipefail
SRC="${1:?missing %p}"; NAME="${2:?missing %f}"
DEST="/wal-stage"
[ -d "$DEST" ] || { echo "wal-archive: $DEST missing (bind-mount not configured)" >&2; exit 1; }
# atomic publish: copy to temp then rename so wal-push never sees a partial file
cp "$SRC" "$DEST/.$NAME.partial"
mv "$DEST/.$NAME.partial" "$DEST/$NAME"
