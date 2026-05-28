---
audience: dev
reading_time: 8 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- backend/src/services/auth.service.js
- backend/src/middleware/auth.middleware.js
- backend/src/middleware/rbac.middleware.js
- backend/src/routes/auth.routes.js
- backend/src/validators/auth.validators.js
- backend/src/utils/response.js
- backend/migrations/001_users_and_sessions.sql
- backend/migrations/002_rbac.sql
- backend/scripts/seed.js
- CLAUDE.md
-->

# Auth and RBAC

How the API authenticates a request and how it decides whether the caller is allowed to do the thing they asked for. Foundation doc — every module route and service layer hangs off this contract.

## Mental model

Authentication and authorization are two separate layers. Authentication answers *who is this caller?* and runs first. Authorization (RBAC) answers *is this caller allowed to do X?* and runs second.

**Authentication — JWT + opaque refresh.** The login handler verifies email + bcrypt password, optionally checks a reCAPTCHA v2 token, and issues two artifacts. The access token is a self-contained HS256 JWT with a 1h TTL — the API hot path verifies the signature locally without a DB round-trip beyond the user-load step in `authMiddleware`. The refresh token is an opaque 48-byte random string; only its SHA-256 hash is persisted in `user_sessions.token_hash`, so a database leak cannot replay sessions. Default refresh TTL is 7d; 30d when `remember_me=true`. Refresh tokens are **not** rotated on use — the existing token stays valid until `expires_at` or explicit logout. bcrypt rounds come from the env (`bcryptjs.hash(pw, 10)` in seed; production uses the configured cost).

**RBAC — three layers, never one alone.** Per [CLAUDE.md](../../CLAUDE.md) "Non-negotiable architectural invariants", every permission decision is enforced at three layers:

1. **Frontend.** Sidebar entries and page gates render or hide based on the `user.permissions` and `user.role_scope` returned by `GET /api/auth/me`. This is a UX layer only — anything it gates is also gated server-side.
2. **Backend route middleware.** `rbacGuard(featureKey, capabilityKey)` runs after `authMiddleware` on every protected route and queries `role_permissions` joined to `roles`, `feature_definitions`, `capability_definitions`. A miss is a 403.
3. **Database query scope.** Service layers consult `req.roleScope` (attached by `rbacGuard`) and add `WHERE` clauses such as `created_by_user_id = $userId` for `view_own`, or filter by division/managed-role-scope for cross-division reads.

**The permission matrix lives in the DB, not in code.** Five tables form the matrix: `roles`, `feature_definitions`, `capability_definitions`, `role_permissions` (the join), and `user_role_scope` (per-user scope overrides). Adding a permission is a migration + seed change, never a code change inside the middleware. The 8 system roles — **[Superadmin](../business/system-overview.md#glossary-superadmin)**, **[CEO](../business/system-overview.md#glossary-ceo)**, **[Sales](../business/system-overview.md#glossary-sales)**, **[Admin & Log](../business/system-overview.md#glossary-admin-log)**, **[Finance](../business/system-overview.md#glossary-finance)**, **[Technical](../business/system-overview.md#glossary-technical)**, **[HRGA](../business/system-overview.md#glossary-hrga)**, **[Tax & Insurance](../business/system-overview.md#glossary-tax-insurance)** — are seeded with `is_system_role=true`. Custom non-system roles can be created at runtime by Superadmin/CEO; their `role_permissions` rows are written through the same RBAC tables.

**Same-role management constraint.** Per CLAUDE.md, a non-Superadmin/CEO role manager (e.g. a Sales lead) may only create or edit users whose role matches their own. This is enforced server-side via two columns on `user_role_scope`: `can_manage_same_role` (boolean gate) and `managed_role_scope` (the role key the caller is allowed to manage). Frontend hides the user-management form for users without the gate; the backend re-checks it inside the service layer. Never trust the frontend.

**Superadmin and CEO bypass the matrix lookup.** `rbacGuard` short-circuits both roles to `next()` after attaching `req.roleScope` (see `backend/src/middleware/rbac.middleware.js:32`). They still get scope attached so downstream services can read it, but the role-permission join is skipped.

## Wiring

### Login: `POST /api/auth/login`

Public route. `validate({ body: loginRequest })` runs first so the rate limiter sees a sanitized email; then `loginRateLimiter` (5 / 15min per IP+email); then the service.

1. `authService.login({ email, password, recaptchaToken, rememberMe, clientIp })` — `backend/src/services/auth.service.js:223`.
2. `verifyRecaptcha(recaptchaToken, clientIp)` — no-op when `RECAPTCHA_SECRET` is unset (dev/test). Strict mode hard-fails on Google network errors.
3. Lookup user by lower(email). On unknown email, bcrypt-compare against a constant dummy hash so timing matches the wrong-password path (no enumeration oracle).
4. Reject if `deleted_at IS NOT NULL` or `account_status != 'active'`.
5. `loadProfile(user.id)` joins `users` + `user_role_scope` and returns the `/me` shape (`auth.service.js:202`).
6. `db.withTransaction(c => createSession(c, ...))` inserts a `user_sessions` row with the SHA-256 hash of a fresh opaque refresh token (`auth.service.js:143`).
7. `signAccessToken(user)` — HS256 JWT with claims `{ sub, email, role, display_name }` and `expiresIn: '1h'` (`auth.service.js:51`).
8. Fire-and-forget `activityLog.record({ action: 'login', ... })`.
9. Response shape via `utils/response.js:3` — `success({ access_token, refresh_token, token_type: 'Bearer', expires_in, refresh_expires_at, user })`.

### Protected request: any route under `authMiddleware + rbacGuard(...)`

```js
// excerpt — backend/src/routes/sales.routes.js (typical pattern)
router.get('/sales/po', authMiddleware, rbacGuard('sales_po', 'view_own'), handler);
```

1. `authMiddleware` reads `Authorization: Bearer <jwt>` (`auth.middleware.js:14`).
2. `jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] })` — algorithm pinned to prevent alg-confusion attacks (`auth.middleware.js:25`).
3. Load user by `payload.sub`; reject if soft-deleted or non-active. Attach `req.user = { id, email, role, displayName }` (`auth.middleware.js:48`).
4. `rbacGuard(featureKey, capabilityKey)` runs (`rbac.middleware.js:13`).
5. Always loads `user_role_scope` and attaches `req.roleScope = { managed_role_scope, can_manage_same_role, feature_permission_scope }` (`rbac.middleware.js:20`). Defaults applied if no row exists.
6. If role is `superadmin` or `ceo` → `next()` (`rbac.middleware.js:32`).
7. Otherwise, joined lookup against `role_permissions` for `(role_key, feature_key, capability_key OR 'full_access')` (`rbac.middleware.js:36`). Zero rows → `ForbiddenError` 403.
8. Handler runs. The service consults `req.user` (caller identity) and `req.roleScope` (scope filters) to assemble `WHERE` clauses.

### Refresh: `POST /api/auth/refresh`

Public — the refresh token authenticates the call. `findActiveSession(hashToken(refresh_token))` (`auth.service.js:173`); reload the user through the same path used by `authMiddleware` so a since-disabled account cannot mint new access tokens; on disabled-user, defensively delete the session row before throwing. No refresh-token rotation — the existing one stays valid until its `expires_at`. Response: `{ access_token, token_type, expires_in }`.

### Logout: `POST /api/auth/logout`

Authenticated. Two modes (`auth.service.js:330`): with `refresh_token` in body → revoke that single session (per-device sign-out); empty body → revoke every session for `req.user.id` (the default Sign-Out button). Returns 204.

### Me: `GET /api/auth/me`

Authenticated. Returns the full profile including `managed_role_scope`, `can_manage_same_role`, `feature_permission_scope` so the frontend builds menus and same-role-management gates without a second round-trip.

## Key files

| File | Principal export | Why it matters |
|---|---|---|
| `backend/src/services/auth.service.js:375` | `login`, `refresh`, `logout`, `me`, `loadProfile`, `purgeExpiredSessions` | All credential and session logic — bcrypt verify, token mint, session row write, profile load. |
| `backend/src/middleware/auth.middleware.js:60` | `authMiddleware` | Bearer JWT decode + user load; attaches `req.user`. Algorithm pinned to HS256. |
| `backend/src/middleware/rbac.middleware.js:60` | `rbacGuard(featureKey, capabilityKey)` | DB-driven permission check; attaches `req.roleScope`; Superadmin/CEO short-circuit. |
| `backend/src/routes/auth.routes.js:38` | `/login`, `/refresh`, `/logout`, `/me` Express router | The four public + private auth endpoints; only place that calls `authService` directly. |
| `backend/src/validators/auth.validators.js:11` | `loginRequest`, `refreshRequest`, `logoutRequest` Joi schemas | Request shape contract — runs before the rate limiter so the limiter sees a sanitized email. |
| `backend/src/middleware/rateLimit.middleware.js` | `loginRateLimiter` | 5 attempts per 15 min per IP+email; demo cap raised in commit 093441b. |
| `backend/src/utils/response.js:3` | `success(data, meta)`, `error(msg, code)` | Canonical JSON envelope every route returns. |
| `backend/migrations/001_users_and_sessions.sql:16` | `users`, `user_sessions`, `user_preferences` | Identity + refresh-handle tables. `user_sessions.token_hash` is SHA-256, never the raw token. |
| `backend/migrations/002_rbac.sql:16` | `feature_definitions`, `capability_definitions`, `roles`, `role_permissions`, `role_menu_visibility`, `user_role_scope` | The five-table permission matrix. `users.role` FK to `roles.role_key` is added at the end of this migration. |
| `backend/scripts/seed.js:26` | `FEATURES`, `CAPABILITIES`, `ROLES`, `DIVISION_FEATURES`, `USERS` | Canonical seed lists — read this for the authoritative role keys, capability keys, and which features each division owns. |

## Invariants

Each invariant cites the table or function that enforces it. None of these may be relaxed at the application layer; they're written into schema and middleware on purpose.

- **Never rely on frontend gating alone.** Every protected route is composed `authMiddleware → rbacGuard(feature, capability) → handler` (`backend/src/middleware/rbac.middleware.js:13`). Removing `rbacGuard` from a route is a security regression — frontend hides do not stop a `curl`.
- **Permission matrix lives in DB — do not hardcode in application code.** The middleware queries `role_permissions` joined to `roles`, `feature_definitions`, `capability_definitions` (`rbac.middleware.js:36`). No `if (role === 'sales' && action === 'create_po')` branches in handlers. New permission ⇒ new migration row, never new code branch.
- **Same-role management constraint: enforce server-side via `managed_role_scope` and `can_manage_same_role`.** `rbacGuard` always attaches `req.roleScope` (`rbac.middleware.js:20`); the user-management service must check `req.roleScope.can_manage_same_role === true && req.roleScope.managed_role_scope === targetUser.role` before writing. Schema source: `backend/migrations/002_rbac.sql:98` (`user_role_scope` table).
- **Refresh tokens are opaque + hashed at rest.** `user_sessions.token_hash` stores SHA-256 of the opaque base64url token; the raw token is never persisted (`auth.service.js:66`, `:70`, `:151`). A DB dump alone cannot mint sessions.
- **JWT algorithm pinned to HS256.** `jwt.verify(..., { algorithms: ['HS256'] })` (`auth.middleware.js:25`). Prevents algorithm-confusion attacks if the env ever gains an RS256 path.
- **Soft delete + `account_status` re-checked on every request.** `authMiddleware` rejects deleted/non-active users (`auth.middleware.js:44`). `refresh` re-checks the same conditions and revokes the session if the user is disabled (`auth.service.js:308`). A logged-in but disabled user cannot keep using their access token past the next request.
- **Constant-time login on unknown email.** Login bcrypt-compares against a fixed dummy hash when no user is found (`auth.service.js:241`). Eliminates the user-enumeration timing oracle.
- **Superadmin and CEO bypass capability lookup but still get `req.roleScope`.** Service-layer `WHERE` clauses can rely on scope being present for every authenticated request (`rbac.middleware.js:32`).
- **`users.role` is FK-constrained to `roles.role_key`.** Schema-enforced; an unknown role string cannot be inserted (`002_rbac.sql:55`).
- **No in-memory session state.** Sessions live in `user_sessions` (Postgres), which makes the API horizontally scalable per CLAUDE.md.

## Extension points

- **To add a new permission (capability on an existing feature)** — write a migration that inserts the `(role_id, feature_id, capability_id)` row into `role_permissions`. Look up the IDs via the `role_key` / `feature_key` / `capability_key` lookups (see the `grant()` helper at `backend/scripts/seed.js:158` for the exact pattern). No application code change. The route already calling `rbacGuard('feature_x', 'capability_y')` will start permitting the role on the next request.

- **To add a new capability key (rare — `view_own`, `create`, `edit`, `delete`, `write`, `export`, `approve`, `view_global`, `full_access` cover most cases)** — insert into `capability_definitions` (`backend/scripts/seed.js:62`), then grant it to the relevant roles via `role_permissions`. Update the appropriate `rbacGuard(...)` calls on routes that should require it.

- **To add a new feature/module** — insert into `feature_definitions` with the right `module_group` (see seed `FEATURES` at `backend/scripts/seed.js:26`). Then grant `full_access` + `view_global` to `superadmin` and `ceo`, and the appropriate division-scoped capabilities to the owning role(s) — the seed script's loop at `backend/scripts/seed.js:172` is the canonical pattern. Mount the new routes with `rbacGuard('your_feature_key', 'capability')`.

- **To add a new role** — insert into `roles` (`is_system_role=false` for tenant-defined roles), then seed `role_permissions` rows for every feature × capability the role should have. The role will not see *any* sidebar items on the frontend until you also add `feature_definitions` rows (if introducing new features) and `role_menu_visibility` rows for the menus that role should see. Without `role_menu_visibility`, the frontend sidebar will hide everything for that role even if backend permissions are granted.

- **To extend per-user scope** — add a column to `user_role_scope` (`backend/migrations/002_rbac.sql:98`) in a new migration; expose it through `loadProfile` in `auth.service.js:202` so it lands on `/me`; consume it from `req.roleScope` (already attached by `rbacGuard`) inside the relevant service layer.

- **To rotate refresh tokens on use** (currently the system does not rotate) — modify `auth.service.js` `refresh()` at `auth.service.js:290` to delete the old session row and call `createSession` for a new one; return the new `refresh_token` in the response. Update `validators/auth.validators.js` and the OpenAPI `RefreshTokenResponseData` to reflect the new shape. Frontend must store the new token after every refresh.

- **To enforce reCAPTCHA in production** — set `RECAPTCHA_SECRET` in the deployment env. `verifyRecaptcha` (`auth.service.js:94`) activates automatically; `RECAPTCHA_STRICT=true` (default in prod) causes hard-fail on Google network errors.
