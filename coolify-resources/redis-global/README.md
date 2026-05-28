# redis-global (Phase 1.5)

Shared Redis for **FUTURE apps** on the `interlab-global` network (cache / session store /
rate limiting). Mechanism B (direct docker compose, deviation #8).

- **Image:** `redis:7.4-alpine` · internal-only (no host port published) · `appendonly yes` + `requirepass`.
- **Connect (from a container on interlab-global):** `redis-global:6379`, auth = `REDIS_PASSWORD`
  (from `.env` here / `/root/.coolify-secrets-backup.txt` key `redis_global_password` / Bitwarden).
- **Existing webapp does NOT use this** — it keeps `interlab-redis` on `interlab-data-net`
  (deviation #14, data-layer separation). redis-global is reserved for new apps.
- **Deploy:** `cd coolify-resources/redis-global && docker compose up -d` (auto-loads `./.env`).
- **Data:** `redis_global_data` volume (AOF + RDB). Recovery = mount volume / replay AOF.
