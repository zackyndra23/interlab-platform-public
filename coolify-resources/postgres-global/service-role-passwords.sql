-- service-role-passwords.sql — Deviation #10 mitigation (Phase 1C, 2026-05-25).
--
-- WHY: Mechanism B deploys postgres-global standalone, WITHOUT the supabase self-host
-- bundled `db` service's init script `roles.sql`. That script normally sets the supabase
-- service roles' passwords to the cluster password. Without it, supabase_auth_admin /
-- authenticator / supabase_storage_admin have no usable password and the Supabase services
-- (auth/rest/storage) fail SCRAM auth over the network (SQLSTATE 28P01).
--
-- These are RESERVED roles → only a SUPERUSER can ALTER them. `postgres` (used by
-- bootstrap.sql) is NOT a superuser here, so this MUST run as `supabase_admin`:
--   docker run --rm -i --network interlab-global -e PGPASSWORD=<superuser_pw> \
--     --entrypoint psql supabase/postgres:15.8.1.085 \
--     -h postgres-global -U supabase_admin -d postgres -v pwd=<superuser_pw> \
--     < coolify-resources/postgres-global/service-role-passwords.sql
--
-- :'pwd' = the cluster superuser password (= POSTGRES_PASSWORD). log_statement is forced
-- off first so the password never lands in the postgres log.
-- Applied once on 2026-05-25 during Phase 1C deploy; re-run on any fresh rebuild.
SET log_statement = 'none';
SET log_min_duration_statement = -1;
ALTER ROLE supabase_auth_admin    WITH PASSWORD :'pwd';
ALTER ROLE authenticator          WITH PASSWORD :'pwd';
ALTER ROLE supabase_storage_admin WITH PASSWORD :'pwd';
