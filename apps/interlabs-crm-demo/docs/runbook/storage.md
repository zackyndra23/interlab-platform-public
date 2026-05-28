---
audience: operator
reading_time: 8 min
last_reviewed: 2026-04-27
---

# Storage runbook (MinIO)

How to bootstrap, inspect, and rotate the MinIO object store that backs `file_attachments`. The API never serves bytes directly — every download is a short-lived presigned `GET` URL signed against the browser-facing host. Uploads go through the Node API (multipart `POST /api/files`), not via presigned `PUT`.

## Purpose

Operator playbook for MinIO storage:

- Create the required buckets on a fresh VPS and lock them to private (no anonymous reads).
- Look up where a `file_attachments` row lives in the bucket and copy the bytes out for inspection.
- Mint a one-off presigned URL when debugging a "broken download" report.
- Rotate `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` without invalidating user sessions.

For storage internals (signing flow, why two clients exist, upload service contract) see [backend storage architecture](../backend/architecture.md).

## Prerequisites

- `interlab-minio` container running on the `interlab-data-net` Docker network. Compose for MinIO itself lives outside `docker-compose.demo.yml` (this repo's compose only ships `interlab-api` + `interlab-app`); the operator is expected to have provisioned `interlab-minio` alongside `interlab-postgres` / `interlab-redis` on the same VPS.
- `interlab-api` container (joined to `interlab-data-net`) so the API can reach MinIO at the in-cluster hostname.
- Public DNS is split by purpose:
  - `https://s3-minio.interlab-portal.com` routes to the MinIO Console UI on port `9001`.
  - `https://s3-storage.interlab-portal.com` routes to the S3 API on port `9000` and is the value used for presigned URLs.
  - Direct host ports `9000` / `9001` should stay bound to `127.0.0.1`; public access should flow through Traefik + HTTPS.
- Repo-root `.env` populated with the MinIO block. Variable names (no values):
  - `MINIO_ENDPOINT` — in-cluster hostname (e.g. `interlab-minio`). The backend also accepts `MINIO_HOST`.
  - `MINIO_PORT` — defaults to `9000`.
  - `MINIO_USE_SSL` — `true` / `false`. Defaults `false` for in-cluster traffic.
  - `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` — service credentials. Aliases accepted: `S3_ACCESS_KEY` / `S3_SECRET_KEY`, or `MINIO_ROOT_USER` / `MINIO_ROOT_PASSWORD` if the MinIO root credential is being reused.
  - `MINIO_BUCKET_ATTACHMENTS` — usually `attachments`. Falls back to `MINIO_BUCKET` / `S3_BUCKET` or literal `attachments`.
  - `MINIO_BUCKET_AVATARS` — usually `avatars`. Falls back to `MINIO_BUCKET` / `S3_BUCKET` or literal `avatars`.
  - `MINIO_PUBLIC_URL` — the browser-facing S3 API base URL (production: `https://s3-storage.interlab-portal.com`). Empty in local dev; **required** in production for presigned GET URLs to be dialable from outside the Docker network. Do not point this at the MinIO Console URL.
  - `UPLOAD_MAX_FILE_SIZE_MB` — server-side cap, default `25`.
  - `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` — presigned GET TTL, default `900` (15 min).
- The MinIO client `mc` installed locally (`brew install minio-mc` / `apt install mc`) **or** runnable as a one-off container (`docker run --rm --network interlab-data-net minio/mc ...`). All `mc` commands below assume an alias `interlab` configured against the in-cluster MinIO; create it once with:

  ```bash
  mc alias set interlab http://interlab-minio:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"
  ```

  When invoking `mc` from your laptop instead of from inside the network, point the alias at the public S3 API URL (`MINIO_PUBLIC_URL`, currently `https://s3-storage.interlab-portal.com`) and reuse the same keys.

### Public endpoint map

| Purpose | URL | Traefik target |
| --- | --- | --- |
| MinIO Console UI | `https://s3-minio.interlab-portal.com` | `interlab-minio:9001` |
| S3 API / presigned downloads | `https://s3-storage.interlab-portal.com` | `interlab-minio:9000` |
| Backend internal client | `http://minio:9000` or `http://interlab-minio:9000` | Docker network only |

Opening the S3 API root in a browser may return a MinIO XML `400 Bad Request`; that is normal. Use the Console URL for the UI, and use an S3-aware client (`mc`, AWS SDK, presigned URL) for the S3 API URL.

## Procedures

### Procedure: Bootstrap MinIO buckets on a fresh instance

Run this once after `interlab-minio` first comes up, before starting `interlab-api`. The backend does **not** auto-create buckets — uploads will fail with `NoSuchBucket` until both buckets exist.

```bash
# Configure mc alias against the running MinIO (one-off; persists in ~/.mc/config.json).
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  alias set interlab http://interlab-minio:9000 "$MINIO_ACCESS_KEY" "$MINIO_SECRET_KEY"

# Create both buckets. Names must match MINIO_BUCKET_ATTACHMENTS / MINIO_BUCKET_AVATARS.
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  mb --ignore-existing interlab/attachments interlab/avatars

# Lock to private. Default policy is already "none" (private) on a fresh bucket;
# this command makes it explicit and is idempotent.
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  anonymous set none interlab/attachments
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  anonymous set none interlab/avatars

# Verify: both should report "Access permission for ... is `none`".
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  anonymous get interlab/attachments
```

If the deployment uses a single shared bucket (operator set `MINIO_BUCKET=interlab` and left `MINIO_BUCKET_ATTACHMENTS` / `MINIO_BUCKET_AVATARS` unset), create only that one bucket — the backend will route both uploads into it. `storage_path` keys already namespace by module (`attachments/<module>/<entity>/...`, `avatars/users/<user_id>/...`), so a shared bucket does not collide.

### Procedure: Inspect a stored file

Find the row, then copy the object out. Every file in MinIO has exactly one corresponding non-deleted row in `file_attachments`.

```bash
# 1. Resolve the storage location from the metadata row.
docker exec -it interlab-postgres psql -U interlab_user -d interlab_db -c \
  "SELECT id, original_filename, storage_bucket, storage_path, size_bytes, deleted_at
     FROM file_attachments
    WHERE id = '<file-uuid>';"

# 2. Copy the object to a local file using the bucket+path from step 1.
docker run --rm --network interlab-data-net -v "$PWD:/out" -v ~/.mc:/root/.mc minio/mc \
  cp interlab/<storage_bucket>/<storage_path> /out/inspect.bin

# 3. (Optional) Inspect MIME / first bytes without downloading.
docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
  stat interlab/<storage_bucket>/<storage_path>
```

To list everything attached to one entity (e.g. all files for a sales PO row), filter by `(related_module, related_entity_id)` instead — that's the same composite index the API uses to hydrate attachment lists (`backend/src/utils/attachments.js`).

### Procedure: Generate a one-off presigned URL for ops debugging

When a user reports "the download link doesn't work", reproducing the URL the API would have minted is the fastest way to localise the problem. Run this from inside `interlab-api` so the env vars and signing host match production exactly.

```bash
docker exec interlab-api node -e "
  const { getPresignedUrl } = require('./src/services/file.service');
  getPresignedUrl(process.argv[1])
    .then(({ url, expires_in }) => {
      console.log('expires_in_seconds:', expires_in);
      console.log('url:', url);
    })
    .catch(err => { console.error(err.message); process.exit(1); });
" '<file-uuid>'
```

The URL is signed against `MINIO_PUBLIC_URL` if set, otherwise against `MINIO_ENDPOINT`. In production this must be the S3 API host (`https://s3-storage.interlab-portal.com`), not the Console host (`https://s3-minio.interlab-portal.com`). TTL is `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` (default 900 s / 15 min). Paste the URL into a browser or `curl -I` it; a `200` confirms the bucket+path+credentials are healthy and the problem is somewhere in the frontend or in how the URL was conveyed to the user.

### Procedure: Rotate MinIO credentials

The backend reads MinIO credentials from env at boot and constructs a lazy client on first use (`backend/src/config/minio.js`). There is no cached presigned URL pool, no app-level token store, and no DB-stored secret — rotating credentials is purely a redeploy.

```bash
# 1. On the MinIO server: create or update the service account / key pair.
#    (UI: MinIO console -> Access Keys -> Create. CLI: `mc admin user svcacct add ...`.)

# 2. Update the repo-root .env with the new values.
#    Variables to change: MINIO_ACCESS_KEY, MINIO_SECRET_KEY (and any aliases
#    you set: S3_ACCESS_KEY/S3_SECRET_KEY, MINIO_ROOT_USER/MINIO_ROOT_PASSWORD).
#    Do NOT commit this file.

# 3. Recreate the API container so it re-reads env. The frontend does not
#    talk to MinIO directly, so it does not need to restart.
docker compose -f docker-compose.demo.yml up -d --force-recreate interlab-api

# 4. Sanity check: a fresh upload should succeed and a fresh presigned URL
#    should resolve.
docker exec interlab-api node -e "
  const { getClient, bucketAttachments } = require('./src/config/minio');
  getClient().listObjects(bucketAttachments, '', false).on('data', o => {
    console.log('ok, sample object:', o.name); process.exit(0);
  }).on('error', e => { console.error(e.message); process.exit(1); });
"
```

User sessions, JWTs, and refresh tokens are unaffected — they are signed by `JWT_SECRET`, not by MinIO keys. **Do not invalidate existing presigned URLs proactively**: any URL minted under the old key remains valid against MinIO until either its 15-minute TTL expires or you explicitly delete the old MinIO key. If you need to cut existing links immediately (e.g. credential leak), delete the old key on MinIO **before** rotating the API env.

## Failure modes

### Failure: Presigned URL returns SignatureDoesNotMatch

**Detection.** Browser console / network panel shows `403 Forbidden` with body containing `<Code>SignatureDoesNotMatch</Code>` from MinIO. The download link looked plausible (correct bucket/path) but never resolves.

**Cause.** SigV4 signs the canonical request including the `Host` header. If the URL was signed against `MINIO_PUBLIC_URL=https://s3-storage.interlab-portal.com` but the browser actually resolves to a different host (Traefik routing changed, DNS pointed elsewhere, operator typo, http vs https mismatch, or accidentally using the Console host), MinIO recomputes the signature against the host **it** sees and rejects the mismatch.

**Recovery.**

1. Confirm what the API thinks the public URL is: `docker exec interlab-api env | grep MINIO_PUBLIC_URL`.
2. Confirm what the browser actually dials: open the failing URL in a new tab and inspect the address bar host.
3. If they differ, fix the env (`MINIO_PUBLIC_URL` must exactly match the scheme + host + port the browser uses) and recreate `interlab-api`. There is no need to re-mint old links — new requests will sign against the corrected host.
4. If they match, the keys diverged: re-check that `MINIO_ACCESS_KEY` / `MINIO_SECRET_KEY` in `interlab-api` env are the same pair MinIO has registered (`mc admin user info` on the MinIO host).

### Failure: 403 on download in browser

**Detection.** Click on an attachment, get a generic `403`. Distinct from `SignatureDoesNotMatch` (above) — the body usually says `<Code>AccessDenied</Code>` or the URL has a `X-Amz-Date` more than 15 minutes old.

**Causes and recovery.**

- **Presigned URL expired.** TTL is `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` (default 900 s). The frontend is expected to call `GET /api/files/:id/presigned-url` each time it renders a download button — if the user kept a tab open for 20 minutes, the URL the browser memo-ised is now stale. Recovery: refresh the page; the frontend will re-mint the URL. If users routinely hit this, raise `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` and recreate `interlab-api` — but keep it well under an hour to bound link-sharing risk.
- **Bucket flipped to anonymous-deny in a way that broke signed reads.** Run `mc anonymous get interlab/attachments` — should report `none`. If something set `download` or `public`, the bucket is now world-readable (a security incident, not a download fix); set it back to `none` immediately.
- **Bucket policy explicitly denies the access key.** Run `mc admin policy entities` (or check the MinIO console) to confirm the API's access key still has `s3:GetObject` on the bucket. Rotated credentials without granting policy to the new key cause this.

### Failure: Upload fails with 413

**Detection.** Frontend `MultiFileUpload` shows a per-file error or the API responds `413 Payload Too Large` / `400 File exceeds NMB limit`.

**Causes and recovery.**

- **Server cap.** The API rejects any upload larger than `UPLOAD_MAX_FILE_SIZE_MB` (default 25 MB) inside `file.service.uploadFile` (`backend/src/services/file.service.js:70-75`). To allow larger files, raise the env var and recreate `interlab-api`. Keep the frontend cap in sync — see next bullet.
- **Client cap.** `MultiFileUpload` enforces the same 25 MB ceiling client-side so the user gets feedback before bytes leave the browser. If the operator raises `UPLOAD_MAX_FILE_SIZE_MB` on the backend without updating the frontend constant, users will still be blocked at the client. Update both.
- **Reverse proxy cap.** If `413` is returned by Traefik (HTML page, not JSON), the request was rejected before reaching Node. Traefik's default request body limit is large (no enforced limit by default), but a custom middleware or buffering setting can clamp it. Check the Traefik dynamic config / middleware list for any `maxRequestBodyBytes`.

### Failure: file_attachments row exists but file missing in bucket

**Detection.** A presigned URL request succeeds (the row exists), but resolving the URL returns `404 NoSuchKey`. Or operator runs `mc stat` against `(storage_bucket, storage_path)` from the row and gets `Object does not exist`.

**Cause.** Orphan metadata. The upload service inserts the DB row only after `putObject` succeeds (`file.service.js:91-112`), so genuine orphans should be rare. The two real-world paths are:

1. The bucket was wiped or the object was deleted directly via `mc rm` without going through the API (`deleteFile` only soft-deletes the row, never removes bytes — `file.service.js:146-158`).
2. The MinIO target moved to a different volume / different MinIO instance, and the bucket/path on the new instance does not yet contain the historical objects.

**Recovery.**

1. Confirm the row is not soft-deleted (`SELECT deleted_at FROM file_attachments WHERE id = '<uuid>'`). If `deleted_at IS NOT NULL`, the API's UI should not have offered a download — investigate the frontend.
2. Confirm the object truly is missing on the live MinIO (`mc stat interlab/<bucket>/<path>`). A network/auth error is **not** "missing"; only `Object does not exist` qualifies.
3. To detect the full set of orphans, list the bucket and diff against the table:

   ```bash
   docker run --rm --network interlab-data-net -v ~/.mc:/root/.mc minio/mc \
     ls --recursive interlab/attachments | awk '{print $NF}' | sort > /tmp/bucket.txt
   docker exec interlab-postgres psql -U interlab_user -d interlab_db -At -c \
     "SELECT storage_path FROM file_attachments
       WHERE storage_bucket = 'attachments' AND deleted_at IS NULL
       ORDER BY 1;" > /tmp/db.txt
   comm -23 /tmp/db.txt /tmp/bucket.txt   # rows that have no object (orphan metadata)
   comm -13 /tmp/db.txt /tmp/bucket.txt   # objects with no row (orphan bytes)
   ```

4. Resolution depends on what the diff shows: if the bytes exist on a backup MinIO, restore them with `mc cp` to the same `storage_path`. If the bytes are gone for good, soft-delete the row with a note in `original_filename` (e.g. append ` [restored:not-found]`) so the entity's UI no longer offers the broken download.

## Reference

### Bucket layout

Per `interlabs-crm-demo/docs/CTX_architecture.txt` (MINIO BUCKET STRATEGY) and `file.service.buildStoragePath`:

```
avatars/
  defaults/{role}.png                    # seeded role avatars (Superadmin, CEO, Sales, ...)
  users/{user_id}/{filename}             # uploaded user profile images

attachments/
  {module}/{entity_id}/{file_id}_{original_filename}
    where module ∈ { sales, admin-log, finance, technical, hrga, tax, po-tracking }
    and entity_id is the parent record's UUID (or 'pending' before the row is created)
```

`file_id` is a fresh UUID generated at upload time — it disambiguates two users uploading the same `original_filename` into the same entity. The full storage key is uniquely indexed at the DB layer (`file_attachments_storage_path_unique` on `(storage_bucket, storage_path)`).

### Environment variables

| Variable | Required | Default | Notes |
|---|---|---|---|
| `MINIO_ENDPOINT` | yes (or `MINIO_HOST`) | — | In-cluster hostname; URL form (`http://...`) is parsed for host + scheme. |
| `MINIO_PORT` | no | `9000` | Container's MinIO port. |
| `MINIO_USE_SSL` | no | `false` (or inferred from URL scheme on `MINIO_ENDPOINT`) | `true` only if MinIO listens on TLS directly (rare in-cluster). |
| `MINIO_ACCESS_KEY` | yes (aliases `S3_ACCESS_KEY`, `MINIO_ROOT_USER`) | — | Service account key. |
| `MINIO_SECRET_KEY` | yes (aliases `S3_SECRET_KEY`, `MINIO_ROOT_PASSWORD`) | — | Service account secret. |
| `MINIO_BUCKET_ATTACHMENTS` | no | `MINIO_BUCKET` / `S3_BUCKET` / `attachments` | Per-detail uploads. |
| `MINIO_BUCKET_AVATARS` | no | `MINIO_BUCKET` / `S3_BUCKET` / `avatars` | User profile + role-default avatars. |
| `MINIO_PUBLIC_URL` | yes in production | empty | Browser-facing S3 API base URL; production uses `https://s3-storage.interlab-portal.com`. Leave empty in local dev. |
| `UPLOAD_MAX_FILE_SIZE_MB` | no | `25` | Server cap, mirrored client-side by `MultiFileUpload`. |
| `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` | no | `900` | Presigned GET TTL. Per architecture spec, keep at 15 min. |

### Presigned URL TTLs

- **Download (GET):** 15 minutes (`UPLOAD_PRESIGN_DOWNLOAD_SECONDS=900`). Issued by `GET /api/files/:id/presigned-url` and by `file.service.getPresignedUrl`.
- **Upload (PUT):** the architecture spec lists 5 minutes, but **the current backend does not issue presigned PUTs** — uploads come in as multipart `POST /api/files`, the API calls `putObject` server-side, and only the GET path uses presigning. If a future change moves uploads to direct-to-MinIO presigned PUT, target a 5-minute TTL to match the spec.
- **ACL:** all buckets must be private (`mc anonymous set none ...`). All access flows through presigned URLs.

### Container and network names

- API container: `interlab-api`. Joined to `interlab-data-net` and `traefik_default`.
- Postgres container: `interlab-postgres`. On `interlab-data-net`.
- MinIO container: `interlab-minio`. On `interlab-data-net`. Provisioned outside `docker-compose.demo.yml`.

### See also

- [Backend architecture and storage layer](../backend/architecture.md) — signing flow, why `getClient` vs `getPublicClient`, upload service contract.
- [Database runbook](./database.md) — direct psql access for `file_attachments` queries.
- [Deployment runbook](./deployment.md) — populating the repo-root `.env` and recreating containers.

<!--
drift-anchors:
- backend/src/config/minio.js
- backend/src/config/env.js
- backend/src/services/file.service.js
- backend/src/utils/attachments.js
- backend/src/routes/files.routes.js
- backend/migrations/012_file_attachments.sql
- backend/.env.example
- docker-compose.demo.yml
- interlabs-crm-demo/docs/CTX_architecture.txt
-->
