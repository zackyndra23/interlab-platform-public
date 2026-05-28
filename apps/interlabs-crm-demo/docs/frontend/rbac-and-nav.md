---
audience: dev
reading_time: 7 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- frontend/lib/rbac.ts
- frontend/components/layout/navConfig.ts
- frontend/components/layout/Sidebar.tsx
- frontend/components/layout/AuthGuard.tsx
- frontend/hooks/usePermission.ts
- frontend/hooks/useAuth.ts
- frontend/stores/auth.store.ts
- backend/src/services/auth.service.js
- backend/migrations/002_rbac.sql
- CLAUDE.md
-->

# RBAC and Navigation (Frontend)

How the Next.js client decides what to render for the signed-in user — whether a sidebar entry appears, whether a button is enabled, and how an unauthenticated request is bounced back to `/login`. This is the **frontend half** of the RBAC story; the authoritative half lives in [../backend/auth-and-rbac.md](../backend/auth-and-rbac.md).

## Mental model

Frontend gating is **layer 1 of 3**. Per [CLAUDE.md](../../CLAUDE.md) "Non-negotiable architectural invariants", every permission decision must also be enforced by (2) backend route middleware (`rbacGuard`) and (3) database query scope. The UI layer is for *experience*, not *security* — its job is to keep menus from listing pages the user cannot reach and to disable buttons whose actions would 403.

**Source of truth for menu structure: `navConfig.ts`.** Each `NavItem` carries the route, the icon, and (for the Superadmin master list) a `feature` capability code that mirrors a `feature_definitions.feature_key` row in the backend RBAC tables. The Sidebar reads the user's role off the auth store and renders the appropriate slab — module items are role-scoped slabs; `SHARED_TOP` (Dashboard) and `SHARED_GLOBAL` (Notifications, Chat, PO Tracking) are common to everyone; `SETUP_ITEMS` is shown to all roles but the Roles page does its own per-role scoping.

**Component-level gating: `usePermission(feature, capability)`.** Hooks into the auth store and runs `hasFeatureAccess()` against an in-memory ownership map (`frontend/lib/rbac.ts:84`). Returns `boolean`. Use it to hide an action button or disable a form submit. **Superadmin** and **CEO** short-circuit to `true` for every feature (`rbac.ts:45`).

**Auth state lives in Zustand: `useAuthStore`.** Token persistence is *not* in the store — tokens are kept in storage by `lib/auth.ts`, and the store only reflects the decoded `/api/auth/me` profile (`UserProfile` type at `frontend/lib/rbac.ts:31`) plus a 4-state `status` machine (`idle → loading → authenticated | unauthenticated`). This split lets `AuthGuard` distinguish "not yet bootstrapped" from "definitely logged out" and avoid a `/login` flash on first paint.

**The 8 roles in [Superadmin], [CEO], [Sales], [Admin & Log], [Finance], [Technical], [HRGA], [Tax & Insurance]** are fixed by migration 002 and mirrored in the `RoleKey` union — the frontend never invents a role string.

## Wiring

### AuthGuard: bootstrapping the session

`AuthGuard` (`frontend/components/layout/AuthGuard.tsx:24`) wraps every authenticated page in the App Router tree. On mount it does the following:

```ts
// AuthGuard.tsx — bootstrap order (paraphrased)
const token = getAccessToken();              // from lib/auth.ts (storage)
if (!token) { clear(); router.replace('/login'); return; }
if (status === 'idle' || status === 'unauthenticated') {
    setStatus('loading');
    const profile = await apiGet('/api/auth/me');
    setUser(profile);                         // status -> 'authenticated'
    websocket.connect();                      // open Socket.IO
}
```

While `status !== 'authenticated'` it renders a "Loading..." placeholder (`AuthGuard.tsx:69`) so children never see `user === null`. It also subscribes to the `auth:logout` window event that `lib/api.ts` dispatches when the refresh interceptor fails — a revoked or expired refresh token tears the session down without a manual logout click (`AuthGuard.tsx:50`).

### Sidebar: rendering the role's menu

`Sidebar` (`frontend/components/layout/Sidebar.tsx:25`) reads `useAuthStore(s => s.user)` and bails to `null` if no user (the AuthGuard wrapper guarantees this is brief). It then composes three menu sections:

```tsx
// Sidebar.tsx — section composition
const moduleItems = navForRole(user.role);  // navConfig.ts:121
// 1. SHARED_TOP   -> Dashboard
// 2. moduleItems  -> per-role slab from MODULE_NAV
// 3. SHARED_GLOBAL-> Notifications, Chat, PO Tracking
// 4. SETUP_ITEMS  -> collapsible bottom section
```

`navForRole(role)` returns `MODULE_NAV[role]` and contains a special case: `'ceo'` re-uses `MODULE_NAV.superadmin` so the CEO sees the full cross-division catalogue (`navConfig.ts:121`). Active-state highlight is a prefix match on the current pathname (`Sidebar.tsx:126`). The `feature` capability codes attached to the Superadmin slab are the contract surface — if you wire `usePermission` into a future per-item filter, those codes are what it will check.

### usePermission: button-level gating

```ts
// usePermission.ts — UI-only feature gate
export function usePermission(feature: string, capability = 'view_own') {
    const user = useAuthStore((s) => s.user);
    if (!user) return false;
    return hasFeatureAccess(user.role, feature, capability);
}
```

`hasFeatureAccess` (`frontend/lib/rbac.ts:63`) short-circuits **[Superadmin]** and **[CEO]** to `true`, then consults the hardcoded `roleOwnsFeature` map. This map is a *rendering hint only* — when the backend `/api/permissions/features` endpoint lands, swap the lookup over without touching call sites.

### Same-role management

`canManageRole(actor, targetRole)` (`frontend/lib/rbac.ts:50`) gates the user-management UI. **[Superadmin]**/**[CEO]** can manage anyone; everyone else needs `actor.can_manage_same_role === true` and `actor.managed_role_scope === targetRole`. The frontend uses this to hide the "Add user" button — the backend re-checks identical logic in the service layer per CLAUDE.md, so the constraint is never trust-based.

## Key files

| File | Responsibility |
|---|---|
| `frontend/lib/rbac.ts` | `RoleKey`, `UserProfile`, `isGlobalRole`, `canManageRole`, `hasFeatureAccess`, `roleOwnsFeature` ownership map |
| `frontend/components/layout/navConfig.ts` | `NavItem` type; `SHARED_TOP`, `MODULE_NAV` (per-role slabs), `SHARED_GLOBAL`, `SETUP_ITEMS`; `navForRole(role)` resolver |
| `frontend/components/layout/Sidebar.tsx` | Reads `useAuthStore`, calls `navForRole`, renders the rail; collapsed/expanded state from `useSidebarStore` |
| `frontend/components/layout/AuthGuard.tsx` | Mount-time `/api/auth/me` bootstrap; `auth:logout` event listener; loading placeholder |
| `frontend/hooks/usePermission.ts` | `usePermission(feature, capability) → boolean` for button/section gating |
| `frontend/hooks/useAuth.ts` | Read-only convenience hook returning `{ user, status }` |
| `frontend/stores/auth.store.ts` | Zustand store: `user`, `status`, `setUser`, `clear`, `setStatus` |
| `frontend/lib/auth.ts` | Token storage helpers (`getAccessToken`, `clearTokens`) — owns persistence; the store does not |

## Invariants

- **Frontend gating is UX, not security.** A `usePermission` miss hides UI; it does not stop a determined caller. The backend `rbacGuard` middleware and database scope filters are the only authoritative checks. See [../backend/auth-and-rbac.md](../backend/auth-and-rbac.md) for the three-layer rule and CLAUDE.md "Non-negotiable architectural invariants".

- **Every nav item lists the exact capability code from `capability_definitions`.** The `feature` field on items in the Superadmin slab of `MODULE_NAV` (`navConfig.ts:38`) must match a `feature_definitions.feature_key` row seeded by `backend/migrations/002_rbac.sql`. New nav items without a matching DB row will pass the in-memory ownership map but fail the backend RBAC join — the user will see a menu link that 403s on click.

- **Same-role management constraint is rendered server-side too.** The frontend hides the "Add user" / "Edit user" button for callers without `can_manage_same_role`, but the backend re-checks `managed_role_scope` inside the user-management service. Hiding the button is a courtesy, not a control.

- **Tokens never live in the auth store.** `useAuthStore` holds the decoded user profile; `lib/auth.ts` owns storage. Mixing the two breaks the AuthGuard `idle → loading → authenticated` state machine and re-introduces the `/login` flash on cold boot.

- **`UserProfile.role` is the canonical role key.** Never derive role from URL prefix, page path, or component prop. The Sidebar, every `usePermission` call, and `canManageRole` all read it from `useAuthStore(s => s.user)`.

- **Superadmin / CEO short-circuit applies in two places.** `isGlobalRole` (`rbac.ts:45`) for `hasFeatureAccess` and `canManageRole`, and the `'ceo'` branch of `navForRole` (`navConfig.ts:122`) which aliases to the Superadmin slab. New RBAC helpers must honor the same rule or the **[CEO]** view will silently lose features.

- **No in-memory session state is durable.** Per CLAUDE.md, sessions live in Redis on the backend. The frontend store is a per-tab cache; a hard refresh repeats the `/api/auth/me` bootstrap and the `roleOwnsFeature` map is recomputed from the user's role on every render.

## Extension points

### Adding a new nav item

1. Add the entry to the appropriate role slab in `MODULE_NAV` (`frontend/components/layout/navConfig.ts:37`) and to the **Superadmin** master slab. Pick a `key` (used for active-state matching), an `href`, an icon from `lucide-react`, and the `feature` capability code.
2. Confirm the `feature` value matches a `feature_definitions.feature_key` row seeded in `backend/migrations/002_rbac.sql` — if the row does not exist, add it via a new migration first (see "New capability" below) or the click will 403.
3. Build the page route under the `(protected)` App Router segment so it inherits `AuthGuard`. No code change in `Sidebar.tsx` is required — it iterates `MODULE_NAV[role]` automatically.

### New capability (feature key)

1. Backend migration first: add a row to `feature_definitions` and the corresponding `role_permissions` joins for every role that should own it. This is the *real* contract — see [../backend/auth-and-rbac.md](../backend/auth-and-rbac.md) for the migration pattern.
2. Expose the capability via `GET /api/auth/me` (it is already part of the joined `loadProfile` query — no code change once the migration runs).
3. Mirror the new key into `frontend/lib/rbac.ts` `roleOwnsFeature` until the dynamic `/api/permissions/features` endpoint replaces the hardcoded map. Adding to the map without the backend rows in place will create a UI link the user cannot actually use.
4. Use the new capability via `usePermission('your_feature', 'create')` in components, or attach it as `feature` on a new `NavItem`.

### New role

1. Backend migration: insert into `roles` and seed `role_permissions`. The same migration must add the role's display label and any default `user_role_scope` defaults.
2. Frontend: extend the `RoleKey` union and the `ROLE_LABEL` map in `frontend/lib/rbac.ts`, then add a slab to `MODULE_NAV` in `navConfig.ts`. If the role should bypass the matrix (like **[Superadmin]**/**[CEO]**), update `isGlobalRole` and `navForRole`.
3. Add the role's avatar to `pictures/interlab_role_avatar_generation/` and the MinIO `avatars/defaults/` path per [../backend/architecture.md](../backend/architecture.md).

### Replacing the in-memory ownership map

The `roleOwnsFeature` table in `frontend/lib/rbac.ts:84` is a temporary mirror of the DB matrix. When the dynamic endpoint ships, swap `hasFeatureAccess` to consult `user.permissions` (already part of `UserProfile`) instead of the hardcoded map. No call site change is required because every gate goes through `usePermission` or `hasFeatureAccess`.
