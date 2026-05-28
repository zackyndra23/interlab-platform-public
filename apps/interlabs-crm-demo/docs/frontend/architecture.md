---
audience: dev
reading_time: 6 min
last_reviewed: 2026-04-27
---

# Frontend architecture

## Mental model

The frontend is a single Next.js 14 App Router application that compiles to a self-contained Node bundle for Docker deployment. `output: 'standalone'` in `frontend/next.config.mjs:8` makes `pnpm build` emit `.next/standalone/server.js`, which the production image runs directly without shipping `node_modules`. TypeScript is mandatory (`frontend/tsconfig.json:7` — `strict: true`), and the `@/*` path alias (`tsconfig.json:18-20`) is the only import shape used in app code; relative `../..` traversals are reserved for sibling files inside the same feature.

The route tree is split into two top-level concerns by App Router route groups:

- `app/login/` — the **only** unauthenticated route. It renders standalone (no AppShell, no sidebar, no auth probe) and ends in a hard `router.replace('/dashboard')` after `setTokens()` (`frontend/app/login/page.tsx:89-102`).
- `app/(app)/` — every authenticated route lives here. The `(app)` segment is a route group: parentheses mean the segment does not appear in the URL, but the layout it owns (`app/(app)/layout.tsx`) wraps every descendant. That layout mounts `<AppShell>`, which is the single point where `AuthGuard`, `Sidebar`, and `TopBar` attach.

`app/page.tsx:11` is a server-side `redirect('/dashboard')` — the root URL never renders content; it always bounces into the authenticated tree, where `AuthGuard` does the client-side token check and re-routes anonymous sessions to `/login`. Token storage is client-only (`localStorage` / `sessionStorage` via `lib/auth.ts`), so SSR cannot pre-decide the redirect target.

Module pages follow a fixed shape under `app/(app)/<module>/<resource>/`: `page.tsx` (list), `new/page.tsx` (create form), `[id]/page.tsx` (detail), `[id]/edit/page.tsx` (edit form). E.g. `app/(app)/sales/purchase-orders/{page.tsx, new/page.tsx, [id]/...}`. This shape is mirrored across all eight module folders (`sales`, `admin-log`, `finance`, `technical`, `hrga`, `tax`, plus the global `chat`, `dashboard`, `notifications`, `po-tracking`, `settings`, `setup`, `activity-logs`).

Styling is Tailwind with shadcn-style HSL CSS variables (`frontend/tailwind.config.ts:9-58`). Dark mode is class-based on the `<html data-theme="dark">` attribute (`tailwind.config.ts:10`), set by the `useThemeStore` Zustand store (`frontend/stores/theme.store.ts`) and applied on mount by a tiny client component (`ThemeBootstrap`) in the root layout. State that crosses components lives in Zustand stores under `frontend/stores/`: `auth.store.ts` (current user + status), `theme.store.ts` (light/dark), `sidebar.store.ts` (collapsed + Setup-open), `notification.store.ts` (unread badge feed). No global Redux, no React Context for app state.

## Wiring

Route tree (URL paths shown — the `(app)` group does not appear in the URL):

```
/                        app/page.tsx              → redirect('/dashboard')
/login                   app/login/page.tsx        (PUBLIC; no AppShell)

/dashboard               app/(app)/dashboard/...
/sales/purchase-orders   app/(app)/sales/purchase-orders/{page,new,[id]}/...
/admin-log/awb           app/(app)/admin-log/awb/...
/finance/po-customers    app/(app)/finance/po-customers/...
/technical/bast          app/(app)/technical/bast/...
/hrga/legalitas          app/(app)/hrga/legalitas/...
/tax/...                 app/(app)/tax/...
/po-tracking             app/(app)/po-tracking/...   (cross-division read-only)
/chat                    app/(app)/chat/...
/notifications           app/(app)/notifications/...
/activity-logs           app/(app)/activity-logs/... (audit trail)
/settings                app/(app)/settings/...
/setup                   app/(app)/setup/...         (Superadmin/CEO config)
```

Render flow for any authenticated page (e.g. `/sales/purchase-orders/abc-123`):

```
browser request
  │  (full page nav or client transition)
  ▼
app/layout.tsx                                       layout.tsx:31-41
  │  <html data-theme=?>
  │  <body>
  │    <ThemeBootstrap/>     (sets data-theme from store)
  │    {children}            (props.children = matched (app) layout)
  │    <Toaster/>            (sonner — global toast portal)
  │
  ▼
app/(app)/layout.tsx                                 (app)/layout.tsx:10-12
  │  return <AppShell>{children}</AppShell>
  │
  ▼
components/layout/AppShell.tsx                       AppShell.tsx:15-29
  │  <AuthGuard>                                     AuthGuard.tsx:24-77
  │    │ 1. read access token from lib/auth.ts
  │    │ 2. if missing  → router.replace('/login')
  │    │ 3. if present + store idle → GET /api/auth/me, hydrate store
  │    │ 4. listen for window 'auth:logout' → force re-login
  │    │ 5. render <Loading…/> until status === 'authenticated'
  │    ▼
  │    <div flex h-screen w-screen>
  │      <Sidebar/>          ← UserCard + role-filtered NavLinks
  │      <div flex-1>
  │        <TopBar/>         ← theme toggle + Settings + ToDoPanel + NotificationDropdown
  │        <main>            ← page content scrolls here
  │          {page.tsx output}
```

Two side-channels open as a side effect of authentication:

- **WebSocket** — `websocket.connect()` is called in two spots: on successful login (`login/page.tsx:95`) and after `/api/auth/me` succeeds inside the guard (`AuthGuard.tsx:41`). It is closed on logout from `UserCard.handleLogout` (`UserCard.tsx:43`).
- **Notifications feed** — `useNotifications` (consumed by `NotificationDropdown`, `NotificationDropdown.tsx:17`) subscribes to the store fed by the WebSocket layer; the bell badge updates in real time without page reload.

`TopBar` derives its title from the URL (`TopBar.tsx:50-59`), so navigation is the single source of truth for breadcrumb-ish state — no separate page-title prop drilling.

## Key files

| File | Purpose | Principal export |
|---|---|---|
| `frontend/app/layout.tsx` | Root HTML/body, font variables, sonner Toaster, `ThemeBootstrap` mount | `RootLayout` (`layout.tsx:31`) |
| `frontend/app/(app)/layout.tsx` | Wraps every authenticated route in `<AppShell>` | `AuthenticatedLayout` (`(app)/layout.tsx:10`) |
| `frontend/app/page.tsx` | `redirect('/dashboard')` — never renders content | `Home` (`page.tsx:10`) |
| `frontend/app/login/page.tsx` | Public login form; calls `/api/auth/login`, persists tokens, opens WS | `LoginPage` (`login/page.tsx:45`) |
| `frontend/components/layout/AppShell.tsx` | Composes `AuthGuard` + `Sidebar` + `TopBar` + `<main>` scroll region | `AppShell` (`AppShell.tsx:15`) |
| `frontend/components/layout/AuthGuard.tsx` | Client-side token check, `/api/auth/me` hydration, force-logout listener | `AuthGuard` (`AuthGuard.tsx:24`) |
| `frontend/components/layout/Sidebar.tsx` | Collapsible nav rail; renders `UserCard`, role-filtered `NavLink`s, Setup group | `Sidebar` (`Sidebar.tsx:25`) |
| `frontend/components/layout/TopBar.tsx` | Page title, theme toggle, Settings link, To-Do, Notifications | `TopBar` (`TopBar.tsx:15`) |
| `frontend/components/layout/ThemeBootstrap.tsx` | Mounts in root layout; flips `<html data-theme>` from the Zustand store | `ThemeBootstrap` (`ThemeBootstrap.tsx:12`) |
| `frontend/components/layout/UserCard.tsx` | Avatar + identity slab in sidebar; owns the Sign Out action | `UserCard` (`UserCard.tsx:22`) |
| `frontend/components/layout/NotificationDropdown.tsx` | Bell badge + popover of latest unread; reads `useNotifications` | `NotificationDropdown` (`NotificationDropdown.tsx:14`) |
| `frontend/components/layout/ToDoPanel.tsx` | Right-side slide-over driven by `GET /api/todos`; optimistic toggle | `ToDoPanel` (`ToDoPanel.tsx:26`) |
| `frontend/components/layout/navConfig.ts` | `SHARED_TOP`, `MODULE_NAV[role]`, `SHARED_GLOBAL`, `SETUP_ITEMS`, `navForRole(role)` | see `./rbac-and-nav.md` |
| `frontend/lib/env.ts` | `NEXT_PUBLIC_*`-only client env, throws at module load if missing | `env` (`env.ts:13`) |
| `frontend/next.config.mjs` | `output: 'standalone'`, image remote patterns, build-checker toggles | `nextConfig` (`next.config.mjs:1-25`) |
| `frontend/tailwind.config.ts` | shadcn-style HSL token map, `data-theme="dark"` selector | default export (`tailwind.config.ts:62`) |
| `frontend/tsconfig.json` | `strict: true`, `@/*` alias, App Router types plugin | (whole file) |

## Invariants

These bind every page and component. Do not weaken them.

### 1. Module pages never render outside AppShell

The only file path that reaches a browser outside `<AppShell>` is `app/login/page.tsx`. Any new authenticated route **must** live under `app/(app)/...`; placing it at `app/<route>/` skips the `(app)` layout entirely and bypasses `AuthGuard`. This is structural, not policy — Next.js layout inheritance follows the file tree.

```tsx
// excerpt — frontend/app/(app)/layout.tsx
export default function AuthenticatedLayout({ children }: { children: React.ReactNode }) {
    return <AppShell>{children}</AppShell>;
}
```

`AuthGuard.tsx:69-75` returns a `Loading…` placeholder until `status === 'authenticated'`, so children of `AppShell` never see a half-authenticated state. Never short-circuit this guard with a per-page client check; the guard is the single source of auth truth on the client.

### 2. No client-side secrets — only `NEXT_PUBLIC_*` reaches the bundle

Next.js inlines `process.env.NEXT_PUBLIC_*` at build time and refuses to expose anything else to the browser bundle. The codebase enforces this at one chokepoint:

```ts
// excerpt — frontend/lib/env.ts
export const env = {
    appName: process.env.NEXT_PUBLIC_APP_NAME || 'Interlabs CRM',
    apiUrl: required('NEXT_PUBLIC_API_URL', process.env.NEXT_PUBLIC_API_URL),
    wsUrl: required('NEXT_PUBLIC_WS_URL', process.env.NEXT_PUBLIC_WS_URL),
    recaptchaSiteKey: process.env.NEXT_PUBLIC_RECAPTCHA_SITE_KEY || '',
} as const;
```

Components import from `@/lib/env`, never from `process.env` directly. Do not add an unprefixed env var here — it will be `undefined` in the browser and `required()` will throw at module load. The `next.config.mjs` build accepts unauthenticated bundles (no server-only env passthrough), so any leaked secret would ship to every authenticated browser — there is no second perimeter.

### 3. Server-side gating is layer 2 of 3 (the authoritative one)

Frontend gating is **UX**, not security. The Sidebar filters menu items via `navForRole(user.role)` (`Sidebar.tsx:32`) and per-component `feature` capability checks; this is purely so users do not see dead links. The authoritative checks are the backend `rbacGuard` middleware and the database query scope (see [../backend/auth-and-rbac.md](../backend/auth-and-rbac.md)). A user who hand-crafts a fetch to `/api/sales/customers` without a Sales grant gets 403 from the backend regardless of what the frontend rendered. Never gate a sensitive action with frontend-only logic; always trust the API response.

### 4. Single Zustand store per concern; no cross-store imports inside components

`auth.store.ts`, `theme.store.ts`, `sidebar.store.ts`, `notification.store.ts` are independent. Components subscribe via fine-grained selectors (`useAuthStore((s) => s.user)`, not `useAuthStore()`) so re-renders are minimal. Server-derived state (lists, details) belongs in component-local state or React Query — not in a global store.

### 5. WebSocket lifecycle is owned by auth transitions, not pages

`websocket.connect()` fires on login (`login/page.tsx:95`) and on guard-driven hydration (`AuthGuard.tsx:41`); `websocket.disconnect()` fires on logout (`UserCard.tsx:43`) and on forced-logout (`AuthGuard.tsx:53`). Pages must never call `connect`/`disconnect` directly — they read via `useNotifications` or peer hooks layered over the singleton.

### 6. App Router conventions, no Pages Router

Files named `page.tsx` are routes; `layout.tsx` wraps a subtree; `loading.tsx`, `error.tsx`, `not-found.tsx` are reserved. Do not create `pages/` directories or `_app.tsx`/`_document.tsx`. Server Components are the default; opt into client interactivity with `'use client'` at the top of the file (every `components/layout/*.tsx` does this because they touch hooks/stores).

## Extension points

### Add a new module section

1. Create the directory under the `(app)` group: `app/(app)/<module>/<resource>/{page.tsx, new/page.tsx, [id]/page.tsx, [id]/edit/page.tsx}`. Mirror an existing module — `app/(app)/sales/purchase-orders/` is the canonical reference.
2. Add `lib/<module>-api.ts`, `lib/<module>-types.ts`, `lib/<module>-ui.ts` next to the existing module triplets.
3. Register the menu entries in `components/layout/navConfig.ts` under the right `MODULE_NAV[role]` array (every role that should see the link), with the correct `feature` key. The `feature` string must match a `feature_definitions.feature_key` row in the database, otherwise `roleOwnsFeature` will hide it. See [./rbac-and-nav.md](./rbac-and-nav.md) for the capability gating contract.
4. The backend route + RBAC grants must already exist — without DB grants, the Sidebar will hide the entry and the API will 403 (`../backend/auth-and-rbac.md`).

### Add a new global page (cross-division)

Place it directly under `app/(app)/<name>/page.tsx` and add an entry to `SHARED_GLOBAL` in `navConfig.ts`. Existing examples: `chat`, `notifications`, `po-tracking`, `activity-logs`.

### Add a public (unauthenticated) route

Create `app/<name>/page.tsx` **outside** the `(app)` group. It will not inherit `AppShell`, so it must render its own chrome. This is rare — login is currently the only public route. If you add one (e.g. a public reset-password form), follow `app/login/page.tsx` for the `useThemeStore` toggle and `<Toaster/>`-friendly structure.

### Add a global UI element to every authenticated page

Add the component inside `AppShell.tsx` (sibling of `<TopBar/>`) — it will mount on every `(app)` route. If it must overlay every page including login, mount it in `app/layout.tsx` next to `ThemeBootstrap` and `<Toaster/>`.

### Add a new Zustand store

Create `frontend/stores/<concern>.store.ts` exporting a `useXStore` hook. Persist via `localStorage` only when SSR-safe (gate with `typeof window !== 'undefined'` — see `theme.store.ts:18-23`). Never persist tokens or PII to a store; tokens belong in `lib/auth.ts` storage helpers.

### Adjust the theme palette

Edit the HSL CSS variables in `frontend/app/globals.css` (under `:root` and `[data-theme="dark"]`). Tailwind tokens in `tailwind.config.ts:17-51` reference these variables, so a palette change requires no Tailwind rebuild beyond a normal `next dev`/`next build`.

<!--
drift-anchors:
- frontend/app/layout.tsx
- frontend/app/(app)/layout.tsx
- frontend/app/page.tsx
- frontend/app/login/page.tsx
- frontend/components/layout/AppShell.tsx
- frontend/components/layout/AuthGuard.tsx
- frontend/components/layout/Sidebar.tsx
- frontend/components/layout/TopBar.tsx
- frontend/components/layout/ThemeBootstrap.tsx
- frontend/components/layout/UserCard.tsx
- frontend/components/layout/NotificationDropdown.tsx
- frontend/components/layout/ToDoPanel.tsx
- frontend/components/layout/navConfig.ts
- frontend/lib/env.ts
- frontend/stores/theme.store.ts
- frontend/stores/auth.store.ts
- frontend/next.config.mjs
- frontend/tailwind.config.ts
- frontend/tsconfig.json
- CLAUDE.md
-->
