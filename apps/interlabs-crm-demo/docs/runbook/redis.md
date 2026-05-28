---
audience: operator
reading_time: 5 min
last_reviewed: 2026-05-02
---

# Redis runbook

Operator playbook for checking Redis, connecting RedisInsight from an operator
workstation, and keeping Redis private on the VPS.

## Purpose

Redis backs short-lived application state such as sessions and refresh-token
metadata. It is shared infrastructure, not owned by `docker-compose.demo.yml`.
The application reaches it over the private Docker network; operators reach it
through an SSH tunnel.

## Prerequisites

- `interlab-redis` is running on the `interlab-data-net` Docker network.
- Redis requires a password via `--requirepass`; the password lives in the
  repo-root `.env` as `REDIS_PASSWORD`.
- The VPS publishes Redis only on loopback:
  `127.0.0.1:6379 -> interlab-redis:6379`. Do not expose Redis on
  `0.0.0.0`; use SSH tunneling for workstation tools.
- SSH to the VPS uses port `2223`.

Confirm runtime state:

```bash
docker ps --filter name=interlab-redis --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'
```

Expected:

```text
interlab-redis    Up ... (healthy)    127.0.0.1:6379->6379/tcp
PONG
```

## Procedures

### Procedure: Connect with RedisInsight

Preferred workflow: create a manual SSH tunnel first, then point RedisInsight
at the local forwarded port. This avoids RedisInsight-specific SSH key parsing
issues.

From the operator workstation:

```bash
ssh -p 2223 -L 6380:127.0.0.1:6379 zaky@51.79.146.14
```

Keep that terminal open. In RedisInsight, add a database:

```text
Database Alias: Interlab Redis
Host: 127.0.0.1
Port: 6380
Username: <blank>
Password: <REDIS_PASSWORD from repo-root .env>
TLS: off
```

Leave `Username` blank. The deployed Redis uses `requirepass`, not named ACL
users.

If using RedisInsight's built-in SSH tunnel instead:

```text
Redis Host: 127.0.0.1
Redis Port: 6379
Redis Username: <blank>
Redis Password: <REDIS_PASSWORD from repo-root .env>
TLS: off

SSH Host: 51.79.146.14
SSH Port: 2223
SSH User: zaky
Private Key: <operator private key, not the .pub file>
Passphrase: <key passphrase, if the key is encrypted>
```

Some RedisInsight builds cannot parse newer encrypted OpenSSH private keys. If
the UI reports `cannot parse private key`, use the manual tunnel above or
create a dedicated RSA PEM key for RedisInsight and add its `.pub` file to
`/home/zaky/.ssh/authorized_keys`.

### Procedure: Inspect Redis from the VPS

Run commands inside the Redis container so no host-level Redis tools are
required:

```bash
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" info server'
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" dbsize'
```

Use read-only commands for routine monitoring. Avoid `FLUSHDB`, `FLUSHALL`,
`KEYS *` on a busy instance, or writes unless you are intentionally performing
maintenance.

### Procedure: Restart Redis after config changes

Redis is managed by the shared infra compose, not this repo's demo compose:

```bash
docker compose -f /home/zaky/data-stack/docker-compose.yml up -d redis
```

Verify:

```bash
docker ps --filter name=interlab-redis --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'
```

## Failure modes

### Failure: RedisInsight cannot authenticate

Check that `Username` is blank and `Password` is `REDIS_PASSWORD`. The current
deployment uses the default Redis user protected by `requirepass`; there is no
`interlab_redis` ACL user.

### Failure: RedisInsight cannot open SSH tunnel

1. Confirm SSH works outside RedisInsight:

   ```bash
   ssh -p 2223 zaky@51.79.146.14
   ```

2. If the private key is encrypted, provide the passphrase.
3. If RedisInsight cannot parse the private key, use a manual tunnel:

   ```bash
   ssh -p 2223 -L 6380:127.0.0.1:6379 zaky@51.79.146.14
   ```

   Then connect RedisInsight to `127.0.0.1:6380` without SSH settings.

### Failure: Redis is not reachable from the tunnel

On the VPS:

```bash
docker ps --filter name=interlab-redis --format '{{.Names}}\t{{.Status}}\t{{.Ports}}'
docker exec interlab-redis sh -lc 'redis-cli -a "$REDIS_PASSWORD" ping'
```

If the port output does not include `127.0.0.1:6379->6379/tcp`, recreate the
shared infra Redis service after checking `/home/zaky/data-stack/docker-compose.yml`.

## Reference

| Item | Value |
| --- | --- |
| Container | `interlab-redis` |
| Internal URL | `redis://:<password>@redis:6379` |
| VPS loopback | `127.0.0.1:6379` |
| Recommended local tunnel | `127.0.0.1:6380 -> VPS 127.0.0.1:6379` |
| SSH endpoint | `51.79.146.14:2223` |
