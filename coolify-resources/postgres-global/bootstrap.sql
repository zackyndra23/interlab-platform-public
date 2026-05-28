-- postgres-global app-db bootstrap (Task 1A.5) — least-privilege per spec §4.
-- Passwords INJECTED at runtime (Pilihan B), never stored here:
--   docker exec -i postgres-global psql -U postgres \
--     -v prod_owner_pw=.. -v prod_app_pw=.. -v stg_owner_pw=.. -v stg_app_pw=.. \
--     < coolify-resources/postgres-global/bootstrap.sql
-- NOTE: `postgres` is NOT a superuser in supabase/postgres; it must be GRANTed each owner role
--       before it can CREATE DATABASE ... OWNER that role. CREATE EXTENSION vector runs as
--       postgres (supabase grants it that right); schema hardening runs SET ROLE <owner>.
\set ON_ERROR_STOP on
-- NOTE (deviation #10): the supabase service roles (supabase_auth_admin / authenticator /
-- supabase_storage_admin) also need their passwords set to the cluster superuser password,
-- but they are RESERVED roles requiring SUPERUSER — run `service-role-passwords.sql` as
-- supabase_admin AFTER this (postgres can't alter reserved roles).

-- ===== interlab_prod =====
CREATE ROLE interlab_prod_owner LOGIN PASSWORD :'prod_owner_pw' NOSUPERUSER CREATEDB;
CREATE ROLE interlab_prod_app   LOGIN PASSWORD :'prod_app_pw'   NOSUPERUSER;
GRANT interlab_prod_owner TO postgres;
CREATE DATABASE interlab_prod OWNER interlab_prod_owner;
REVOKE CONNECT ON DATABASE interlab_prod FROM PUBLIC;
GRANT  CONNECT ON DATABASE interlab_prod TO interlab_prod_owner, interlab_prod_app;

-- ===== interlab_staging =====
CREATE ROLE interlab_staging_owner LOGIN PASSWORD :'stg_owner_pw' NOSUPERUSER CREATEDB;
CREATE ROLE interlab_staging_app   LOGIN PASSWORD :'stg_app_pw'   NOSUPERUSER;
GRANT interlab_staging_owner TO postgres;
CREATE DATABASE interlab_staging OWNER interlab_staging_owner;
REVOKE CONNECT ON DATABASE interlab_staging FROM PUBLIC;
GRANT  CONNECT ON DATABASE interlab_staging TO interlab_staging_owner, interlab_staging_app;

-- ===== per-db: pgvector (as postgres) + public-schema hardening (as owner) =====
\connect interlab_prod
CREATE EXTENSION IF NOT EXISTS vector;
SET ROLE interlab_prod_owner;
REVOKE ALL   ON SCHEMA public FROM PUBLIC;
GRANT  USAGE ON SCHEMA public TO interlab_prod_app;
RESET ROLE;

\connect interlab_staging
CREATE EXTENSION IF NOT EXISTS vector;
SET ROLE interlab_staging_owner;
REVOKE ALL   ON SCHEMA public FROM PUBLIC;
GRANT  USAGE ON SCHEMA public TO interlab_staging_app;
RESET ROLE;
