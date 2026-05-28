---
audience: operator
reading_time: 7 min
last_reviewed: 2026-04-27
---

# Deployment runbook

## Purpose

Deploy and update the Interlabs CRM demo stack on the VPS that fronts `app.interlab-portal.com` (Next.js) and `api.interlab-portal.com` (Node API + Socket.IO). The stack is two containers, `interlab-app` and `interlab-api`, built from the repo and routed by an existing Traefik instance over Let's Encrypt. Persistent state (Postgres, Redis, MinIO) is owned by separately managed containers on the same host and is not built or restarted by this runbook.

## Prerequisites

- Docker Engine and the `docker compose` plugin installed on the VPS.
- Two external Docker networks already created on the host:
  - `interlab-data-net` — backend joins this to reach Postgres/Redis/MinIO.
  - `traefik_default` — both services join this for ingress.
  - Verify with `docker network ls | grep -E 'interlab-data-net|traefik_default'`. Create with `docker network create <name>` if missing.
- Supporting service containers running and healthy on `interlab-data-net`:
  - `interlab-postgres` (resolved as `postgres:5432` from the API container).
  - `interlab-redis`.
  - `interlab-minio`.
  - Verify with `docker ps --format '{{.Names}}\t{{.Status}}' | grep interlab-`.
- A Traefik container running on `traefik_default` with:
  - `web` entrypoint on `:80` and `websecure` entrypoint on `:443`.
  - An ACME certresolver named exactly `myresolver` (the compose labels reference this name).
  - DNS records for `app.interlab-portal.com` and `api.interlab-portal.com` pointing at the VPS public IP, so ACME HTTP-01 can complete.
- Repo cloned to a stable path on the VPS (this runbook assumes `/opt/projects/interlabs-crm-demo`).
- Repo-root `.env` file present and populated. Use `backend/.env.example` and `frontend/.env.example` as the variable list; never commit real secrets back to git. See the [Reference](#reference) table below for what `backend/src/config/env.js` reads.

## Procedures

### Procedure: First-time deployment

1. SSH to the VPS and clone the repo.

   ```sh
   ssh <operator>@<vps-host>
   sudo mkdir -p /opt/projects && sudo chown $USER /opt/projects
   cd /opt/projects
   git clone <repo-url> interlabs-crm-demo
   cd interlabs-crm-demo
   ```

2. Confirm prerequisite networks and supporting containers.

   ```sh
   docker network ls | grep -E 'interlab-data-net|traefik_default'
   docker ps --format '{{.Names}}\t{{.Status}}' | grep -E 'interlab-postgres|interlab-redis|interlab-minio|traefik'
   ```

3. Populate the repo-root `.env`. The file is read by `backend/src/config/env.js` via an absolute path (`<repo>/.env`) — the same file is the source of truth regardless of which directory `docker compose` runs from. Use `backend/.env.example` as the template for variable names. Required values are listed in the [Reference](#reference) table; placeholder is `<set in repo-root .env>`.

   ```sh
   # Edit in place — DO NOT commit this file.
   $EDITOR /opt/projects/interlabs-crm-demo/.env
   chmod 600 /opt/projects/interlabs-crm-demo/.env
   ```

4. Build and start the stack. The compose file is `docker-compose.demo.yml` (not the default name).

   ```sh
   cd /opt/projects/interlabs-crm-demo
   docker compose -f docker-compose.demo.yml up -d --build
   ```

5. Watch the API container come up. The entrypoint runs `wait-for-postgres → migrate → seed → start` in sequence; first boot will print migration output for every file under `backend/migrations/`, then seed the role/permission rows.

   ```sh
   docker logs -f interlab-api
   # Expect: "[wait-for-postgres] ready" -> migrations -> seed -> "API listening on :4000"
   # Ctrl-C once you see the listen line. The container keeps running.
   ```

6. Smoke-test the public endpoints from outside the VPS.

   ```sh
   curl -sSI https://api.interlab-portal.com/api/health | head -1   # expect HTTP/2 200
   curl -sSI https://app.interlab-portal.com/                       # expect HTTP/2 200
   ```

### Procedure: Update deployment

Use this for any code change that has been merged to `main`. The backend entrypoint auto-runs `wait-for-postgres → migrate → seed` on every container start, so new migrations apply on container restart with no extra step.

```sh
cd /opt/projects/interlabs-crm-demo
git fetch --all --prune
git status                              # confirm working tree clean
git pull --ff-only origin main
docker compose -f docker-compose.demo.yml up -d --build
docker logs -f interlab-api             # watch migrations, then Ctrl-C
docker logs -f interlab-app             # confirm Next.js standalone server boots
```

Frontend builds bake `NEXT_PUBLIC_*` values at image-build time (see `frontend/Dockerfile`). If you change any `NEXT_PUBLIC_*` arg in `docker-compose.demo.yml`, you must rebuild with `--build` (above) — a plain `up -d` will not pick it up.

### Procedure: Rollback

Migrations are forward-only. If the new version added a migration that you need to undo, you must write reverse SQL by hand against `interlab-postgres` before redeploying the older image.

1. Identify the previous good commit.

   ```sh
   cd /opt/projects/interlabs-crm-demo
   git log --oneline -20
   ```

2. Check out the previous SHA and rebuild.

   ```sh
   git checkout <prev-sha>
   docker compose -f docker-compose.demo.yml up -d --build
   docker logs -f interlab-api
   ```

3. If the rolled-back code does not understand a column / table that the newer migrations added, the API will crash on first query. Either:
   - Connect to Postgres and apply hand-written reverse SQL to drop/restore the schema delta, then restart `interlab-api`; or
   - Roll forward to a fix commit on `main` instead of staying on the older SHA.

   ```sh
   docker exec -it interlab-postgres psql -U interlab_user -d interlab_db
   ```

4. Once stable, return the working tree to a branch tip:

   ```sh
   git checkout main
   ```

### Procedure: Tail logs

Both containers log to stdout in JSON-line format (one event per line). The API logs include request lines from `requestLogger.middleware.js` plus structured error envelopes.

```sh
docker logs -f --tail 200 interlab-api
docker logs -f --tail 200 interlab-app

# Combined view (requires `docker compose` plugin):
cd /opt/projects/interlabs-crm-demo
docker compose -f docker-compose.demo.yml logs -f --tail 200

# Persisted log location on the host:
ls /var/lib/docker/containers/<container-id>/<container-id>-json.log
```

## Failure modes

### Failure: Backend container restart-looping

Symptom: `docker ps` shows `interlab-api` in `Restarting (1)` repeatedly.

```sh
docker logs --tail 200 interlab-api
```

Common causes, in order of likelihood:

1. **Postgres unreachable.** `wait-for-postgres` exits non-zero after its retry budget. Check `interlab-postgres` is up and on `interlab-data-net`:

   ```sh
   docker ps --filter name=interlab-postgres
   docker network inspect interlab-data-net | grep -A2 interlab-postgres
   docker network inspect interlab-data-net | grep -A2 interlab-api
   ```

   If the API is not attached to `interlab-data-net`, recreate it: `docker compose -f docker-compose.demo.yml up -d --force-recreate interlab-api`.

2. **Migration syntax error.** A newly added file in `backend/migrations/` failed to apply; the script aborts before the API starts. The failing filename is in the log. Fix the SQL upstream and redeploy; do not edit the migration file in place once it has run on any environment.

3. **Missing required env var.** `env.js` throws `Missing required environment variable: <NAME>` on boot. Required keys: `DATABASE_URL`, `JWT_SECRET`, `JWT_REFRESH_SECRET` (or `REFRESH_TOKEN_SECRET`). Confirm the repo-root `.env` is populated and that `docker compose` is reading it (run from the repo root).

4. **Seed conflict.** The seed script is idempotent but a manually edited `roles` / `permissions` row can cause a unique-constraint violation. Inspect with `docker exec -it interlab-postgres psql -U interlab_user -d interlab_db -c '\dt'` and the relevant table.

### Failure: Traefik 502 / 504

Symptom: `https://app.interlab-portal.com` or `https://api.interlab-portal.com` returns `Bad Gateway` or `Gateway Timeout` from Traefik.

1. Confirm both containers are healthy:

   ```sh
   docker ps --format '{{.Names}}\t{{.Status}}\t{{.Ports}}' | grep interlab-
   ```

2. Confirm Traefik and the target are on the same network. The compose declares `traefik.docker.network=traefik_default`; Traefik must also be attached:

   ```sh
   docker network inspect traefik_default | grep -E 'Name|interlab-app|interlab-api|traefik'
   ```

   If Traefik is on a different network, attach it: `docker network connect traefik_default <traefik-container>`.

3. Check Traefik discovered the routers (replace `<traefik>` with the container name):

   ```sh
   docker logs --tail 200 <traefik> | grep -Ei 'interlab|router|certificate'
   ```

4. The API listens on `:4000` and the app on `:3000` (declared via `traefik.http.services.<svc>.loadbalancer.server.port`). If those ports are wrong in the compose, Traefik will connect-timeout — fix and redeploy.

### Failure: TLS cert renewal failed

The Let's Encrypt resolver is named `myresolver` and lives on the Traefik container, not on this stack. ACME storage (typically `/letsencrypt/acme.json`) is mounted into the Traefik container.

1. Check Traefik logs for the cert error:

   ```sh
   docker logs --tail 500 <traefik> | grep -Ei 'acme|certificate|myresolver'
   ```

2. Common causes:
   - DNS record for the host moved away from this VPS — ACME HTTP-01 challenge fails. Verify with `dig +short app.interlab-portal.com`.
   - Port `:80` blocked at the firewall — HTTP-01 needs inbound `:80`. Check with `ss -ltn | grep :80`.
   - `acme.json` permissions wrong (must be `600`). Inspect with `docker exec <traefik> ls -l /letsencrypt/acme.json`.

3. Force a renewal attempt by restarting Traefik: `docker restart <traefik>`. Do not delete `acme.json` casually — Let's Encrypt rate-limits 5 duplicate certs per week per registered domain.

### Failure: Frontend builds but pages 500 in browser

Symptom: `interlab-app` logs are clean, but loading the SPA in a browser shows blank pages or `fetch` errors against the wrong API host.

This is almost always a build-time arg mismatch. `frontend/Dockerfile` bakes `NEXT_PUBLIC_API_URL` and `NEXT_PUBLIC_WS_URL` into the JS bundle at build, so a wrong value sticks until you rebuild.

1. Check what the running bundle is calling:

   ```sh
   curl -sS https://app.interlab-portal.com/ | grep -oE 'https://[a-z.-]*interlab[a-z.-]*'
   ```

2. Compare to `docker-compose.demo.yml` `build.args`:

   ```sh
   grep -A4 'NEXT_PUBLIC_' /opt/projects/interlabs-crm-demo/docker-compose.demo.yml
   ```

   They must match the deployed API host. The defaults shipped in the compose are `https://api.interlab-portal.com` and `wss://api.interlab-portal.com/api/ws`.

3. Fix the args, then rebuild without cache:

   ```sh
   docker compose -f docker-compose.demo.yml build --no-cache interlab-app
   docker compose -f docker-compose.demo.yml up -d interlab-app
   ```

## Reference

### Backend env vars (read by `backend/src/config/env.js`)

All values live in the repo-root `.env`. `env.js` loads it with `dotenv` from an absolute path, so the file location is fixed regardless of `docker compose` working directory. For the precedence rules between aliases (e.g. `JWT_REFRESH_SECRET` vs `REFRESH_TOKEN_SECRET`), see [`../backend/architecture.md`](../backend/architecture.md).

| Variable | Required | Default | Notes |
|---|---|---|---|
| `NODE_ENV` | optional | `development` | Set to `production` in deployed `.env`. |
| `PORT` | optional | `4000` | Container exposes `4000`; Traefik routes to it. |
| `TZ` | optional | `Asia/Jakarta` | Also feeds `SCHEDULER_TIMEZONE` fallback. |
| `DATABASE_URL` | required | `<set in .env>` | `postgresql://user:pass@postgres:5432/db`. |
| `JWT_SECRET` | required | `<set in .env>` | Access-token signing key. |
| `JWT_EXPIRES_IN` | optional | `1h` | |
| `JWT_REFRESH_SECRET` | required (or `REFRESH_TOKEN_SECRET`) | `<set in .env>` | Refresh-token signing key. Either name accepted. |
| `JWT_REFRESH_EXPIRES_IN` | optional (or `REFRESH_TOKEN_EXPIRES_IN`) | `7d` | |
| `JWT_REMEMBER_ME_EXPIRES_IN` | optional (or `REMEMBER_ME_EXPIRES_IN`) | `30d` | Long-lived refresh when `remember_me=true`. |
| `BCRYPT_ROUNDS` | optional | `12` | Compose overrides to `10` for demo speed. |
| `RECAPTCHA_SECRET` | optional | `""` | Empty disables server-side reCAPTCHA check. |
| `RECAPTCHA_VERIFY_URL` | optional | Google siteverify | Override only for tests. |
| `RECAPTCHA_STRICT` | optional | `true` | When `false`, network errors soft-allow. |
| `LOGIN_RATE_LIMIT_WINDOW_MS` | optional | `900000` (15 min) | |
| `LOGIN_RATE_LIMIT_MAX` | optional | `5` | Compose overrides to `30` for demo. |
| `LOG_LEVEL` | optional | `info` | `silent` to suppress request logs. |
| `CORS_ORIGIN` | optional | `http://localhost:3000` | Set to `https://app.interlab-portal.com`. |
| `FRONTEND_URL` | optional | `http://localhost:3000` | Used in email links. |
| `MINIO_ENDPOINT` (or `MINIO_HOST`) | required for uploads | `<set in .env>` | Hostname or full URL. |
| `MINIO_PORT` | optional | `9000` | |
| `MINIO_USE_SSL` | optional | inferred from URL or `false` | |
| `MINIO_ACCESS_KEY` (or `S3_ACCESS_KEY` / `MINIO_ROOT_USER`) | required for uploads | `<set in .env>` | |
| `MINIO_SECRET_KEY` (or `S3_SECRET_KEY` / `MINIO_ROOT_PASSWORD`) | required for uploads | `<set in .env>` | |
| `MINIO_BUCKET_ATTACHMENTS` | optional | `MINIO_BUCKET` / `S3_BUCKET` / `attachments` | |
| `MINIO_BUCKET_AVATARS` | optional | `MINIO_BUCKET` / `S3_BUCKET` / `avatars` | |
| `MINIO_PUBLIC_URL` | optional | `""` | Browser-facing S3 API base; production uses `https://s3-storage.interlab-portal.com`. Required if presigned URLs must dial outside the Docker network. The MinIO Console UI is separate at `https://s3-minio.interlab-portal.com`. |
| `UPLOAD_MAX_FILE_SIZE_MB` | optional | `25` | Must match `MultiFileUpload` on frontend. |
| `UPLOAD_PRESIGN_DOWNLOAD_SECONDS` | optional | `900` | 15 min. |
| `SCHEDULER_ENABLED` | optional | `true` | Set `false` on all but one node in multi-node deploys. |
| `SCHEDULER_TIMEZONE` | optional | `TZ` then `Asia/Jakarta` | IANA zone for cron. |
| `DEMO_PASSWORD` | optional (compose only) | `<set in .env>` | Seeded demo-account password. |

### Frontend build args (baked at image build, see `frontend/.env.example` and `frontend/Dockerfile`)

| Variable | Default in compose | Notes |
|---|---|---|
| `NEXT_PUBLIC_API_URL` | `https://api.interlab-portal.com` | Baked into JS bundle. Rebuild after changing. |
| `NEXT_PUBLIC_WS_URL` | `wss://api.interlab-portal.com/api/ws` | Socket.IO endpoint. |
| `NEXT_PUBLIC_APP_NAME` | `Interlabs CRM` | Shown in browser title and AppShell. |
| `NEXT_PUBLIC_RECAPTCHA_SITE_KEY` | `""` | Empty hides the widget. |

### Useful one-liners

```sh
# Inspect the running API's effective env (redacts nothing — operator only).
docker exec interlab-api env | sort

# psql shell into the demo database.
docker exec -it interlab-postgres psql -U interlab_user -d interlab_db

# Redis ping. Requires REDIS_PASSWORD from the shared infra env.
docker exec -it interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'

# Force-recreate a single service without rebuilding the other.
docker compose -f docker-compose.demo.yml up -d --force-recreate interlab-api
```

<!--
drift-anchors:
- docker-compose.demo.yml
- backend/Dockerfile
- frontend/Dockerfile
- backend/src/config/env.js
- backend/.env.example
- frontend/.env.example
- backend/scripts/wait-for-postgres.js
- backend/scripts/migrate.js
- backend/scripts/seed.js
- CLAUDE.md
-->
