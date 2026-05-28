#!/usr/bin/env bash
# Idempotent: create the supabase-storage bucket + a scoped service-account (least-privilege).
# Runs inside a one-shot minio/mc container ON interlab-global. Re-run safe.
# Required env: MINIO_ROOT_USER, MINIO_ROOT_PASSWORD, STORAGE_SA_KEY, STORAGE_SA_SECRET
# Policy mounted at /policy/storage-policy.json
set -euo pipefail
: "${MINIO_ROOT_USER:?}"; : "${MINIO_ROOT_PASSWORD:?}"
: "${STORAGE_SA_KEY:?}"; : "${STORAGE_SA_SECRET:?}"

mc alias set mg "http://minio-global:9000" "$MINIO_ROOT_USER" "$MINIO_ROOT_PASSWORD" >/dev/null
mc mb --ignore-existing mg/supabase-storage
mc anonymous set none mg/supabase-storage
mc admin policy create mg supabase-storage-rw /policy/storage-policy.json 2>/dev/null || echo "policy exists (ok)"
mc admin user add mg "$STORAGE_SA_KEY" "$STORAGE_SA_SECRET" 2>/dev/null || echo "SA user exists (ok)"
mc admin policy attach mg supabase-storage-rw --user "$STORAGE_SA_KEY" 2>/dev/null || echo "policy already attached (ok)"
echo "init-minio-supabase: done"
