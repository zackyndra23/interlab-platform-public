---
audience: dev
reading_time: 6 min
last_reviewed: 2026-04-27
---

<!--
drift-anchors:
- frontend/lib/api.ts
- frontend/lib/auth.ts
- frontend/lib/env.ts
- frontend/lib/utils.ts
- frontend/lib/websocket.ts
- frontend/lib/sales-api.ts
- frontend/lib/sales-types.ts
- frontend/lib/sales-ui.ts
- frontend/lib/admin-log-api.ts
- frontend/lib/finance-api.ts
- frontend/lib/technical-api.ts
- frontend/lib/hrga-api.ts
- frontend/lib/tax-api.ts
- frontend/lib/global-api.ts
- backend/src/services/auth.service.js
- CLAUDE.md
-->

# Frontend API layer

How a React component talks to the backend: one shared axios instance, a
per-module trio of typed wrappers around it, and a separate WebSocket
singleton for realtime events. The backend wraps every response in a
`{ success, data }` envelope; this layer hides the unwrap so call sites work
with plain typed values.

## Mental model

The API layer is one shared axios instance plus a fixed pattern repeated
once per module. Everything bottoms out at `frontend/lib/api.ts`, which owns
the base URL, the auth interceptor, the refresh-on-401 flow, and the four
envelope-unwrapping helpers (`apiGet`, `apiPost`, `apiPut`, `apiDelete`,
plus `apiList` for paginated calls). No other file constructs an axios
instance; no other file calls `axios.create`.

Each module ships a **trio** of files under `frontend/lib/`:

- `<module>-api.ts` — typed function wrappers around the HTTP endpoints.
  Each entity gets a `list / get / create / update / remove` quintet plus
  any stage-transition verbs (`submit`, `process`, `transition`,
  `acknowledge`, etc.). The shape is rigid on purpose, so a Sales
  developer landing in Tax & Insurance code reads it the same way.
- `<module>-types.ts` — TypeScript types that **mirror backend response
  shapes column-for-column**. Field names match the SQL columns
  (`customer_record_number`, `workflow_status`) so form payloads can be
  POSTed without an adapter layer (`frontend/lib/sales-types.ts:1-9`).
- `<module>-ui.ts` — pure helpers that map module-specific enums to
  `StatusBadge` variants, label maps, and module-local formatters
  (`frontend/lib/sales-ui.ts:14-66`). No HTTP, no React imports.

Cross-module shared files sit alongside the trios:

- `lib/api.ts` — the axios instance and unwrappers.
- `lib/auth.ts` — token persistence (localStorage if remember-me,
  sessionStorage otherwise) and the `setTokens / clearTokens / getAccessToken`
  surface the interceptor reads on every request
  (`frontend/lib/auth.ts:21-33`).
- `lib/env.ts` — the only place `process.env.NEXT_PUBLIC_*` is read; throws
  on boot if `NEXT_PUBLIC_API_URL` or `NEXT_PUBLIC_WS_URL` is missing
  (`frontend/lib/env.ts:8-18`).
- `lib/utils.ts` — `cn`, `formatDate`, `formatCurrency`, `addWorkingDays`
  — formatters used by every module's UI layer.
- `lib/websocket.ts` — separate singleton; **does not go through axios**
  and does not share the refresh interceptor. Auth rides in the connect
  URL's query string per the backend handshake
  (`frontend/lib/websocket.ts:46-49`).

Module trios consume the shared files; the shared files never import a
module trio. This keeps `lib/api.ts` cycle-free and lets new modules drop
in without touching shared code.

## Wiring

A typical authenticated request from a React component to the database:

```
// Sales PO list page → server response
SalesPoListPage            (app/(app)/sales/purchase-orders/page.tsx)
  │  const { rows } = await salesPoApi.list({ status: 'overdue' })
  ▼
salesPoApi.list            (lib/sales-api.ts:94-95)
  │  apiList<SalesPurchaseOrder>('/api/sales/purchase-orders', params)
  ▼
apiList                    (lib/api.ts:156-163)
  │  api.get<ApiEnvelope<T[]>>(url, { params })
  ▼
axios request interceptor  (lib/api.ts:45-52)
  │  Authorization: Bearer <getAccessToken()>
  ▼
HTTP → api.interlab-portal.com/api/sales/purchase-orders
  ▼
axios response interceptor (lib/api.ts:87-121)
  │  pass-through on 2xx
  │  on 401: single-flight performRefresh() then retry once
  ▼
{ success, data: [...], meta: { page, limit, total, totalPages } }
  │  unwrapped by apiList → returns { rows, meta } to the call site
  ▼
SalesPoListPage renders the table
```

The 401-refresh path is **single-flight**: `refreshInFlight` is a
module-level promise so concurrent 401s share one POST to
`/api/auth/refresh` instead of stampeding (`lib/api.ts:62-110`). A retried
request carries a `_retried` sentinel on its config so a second 401 cannot
loop. Auth-endpoint URLs (`/api/auth/*`) are excluded from refresh so a bad
login does not recursively try to refresh
(`lib/api.ts:96-101`).

When refresh fails (no refresh token, or backend rejects it), the
interceptor calls `clearTokens()` and dispatches a `auth:logout`
`CustomEvent` on `window` (`lib/api.ts:82-85, 111-114`). `AuthGuard` and
the auth store listen for it and route to `/login`. The interceptor stays
loose-coupled — it never imports the store or the router.

For the backend half of this flow (route handlers, response envelope
shape, refresh token verification), see
[../backend/architecture.md#wiring](../backend/architecture.md#wiring) and
[../backend/auth-and-rbac.md](../backend/auth-and-rbac.md).

WebSocket wiring is a separate connection, not a layered axios call.
`websocket.connect()` reads the same access token from `lib/auth.ts` and
opens one WS per browser tab; reconnect is exponential backoff up to 5
attempts (`lib/websocket.ts:140-149`). On logout, `disconnect()` closes
the socket so the next user does not inherit the JWT-bound stream
(`lib/websocket.ts:75-86`). See [`../backend/websocket.md`](../backend/websocket.md) for the
full event catalogue.

## Key files

| File | Role |
|---|---|
| `frontend/lib/api.ts` | Axios instance, request/response interceptors, envelope unwrappers (`apiGet`, `apiPost`, `apiPut`, `apiDelete`, `apiList`). |
| `frontend/lib/auth.ts` | Token storage (`setTokens`, `clearTokens`, `getAccessToken`, `getRefreshToken`, `setAccessToken`); chooses localStorage vs sessionStorage by remember-me. |
| `frontend/lib/env.ts` | The only place `process.env.NEXT_PUBLIC_*` is read; fails fast on missing `NEXT_PUBLIC_API_URL` / `NEXT_PUBLIC_WS_URL`. |
| `frontend/lib/utils.ts` | `cn`, `formatDate`, `formatCurrency`, `relativeTime`, `addWorkingDays`, `maskEmail` — shared by every module's `<module>-ui.ts`. |
| `frontend/lib/websocket.ts` | Singleton WebSocket client; subscribe/dispatch by event name; not routed through axios. |
| `frontend/lib/sales-api.ts` | Sales endpoints — customers, forecasts, quotations, HPP, sales POs, PRs (`/api/sales/*`). |
| `frontend/lib/admin-log-api.ts` | Admin & Log endpoints — AWB, DO, operational, ready-to-deliver (`/api/admin-log/*`). |
| `frontend/lib/finance-api.ts` | Finance endpoints — PO Customer, Purchase Requisition, Invoice Manufacture, Invoice Customer (`/api/finance/*`). |
| `frontend/lib/technical-api.ts` | Technical endpoints — inspection, BAST, installation, etc. (`/api/technical/*`). |
| `frontend/lib/hrga-api.ts` | HRGA & Legal endpoints — legalitas, BPJS, KEMNAKER, domisili (`/api/hrga/*`). |
| `frontend/lib/tax-api.ts` | Tax & Insurance endpoints (`/api/tax/*`). |
| `frontend/lib/global-api.ts` | Cross-module endpoints — notifications, chat, PO tracking, users, roles, email templates, settings. |
| `frontend/lib/<module>-types.ts` | TypeScript mirrors of backend response shapes — column-for-column. |
| `frontend/lib/<module>-ui.ts` | Status-to-badge variant maps, label maps, formatters. Pure functions, no HTTP. |

## Invariants

- **Never call `axios` directly — always go through `lib/api.ts`.** The
  one exception is the refresh POST inside `performRefresh`, which uses a
  bare `axios.post` to avoid recursing through its own interceptor
  (`frontend/lib/api.ts:64-80`). New code that wants to "just hit an
  endpoint" must add a method on the relevant `<module>-api.ts` and route
  through `apiGet` / `apiPost` / `apiPut` / `apiDelete` / `apiList` — that
  is the only way the auth interceptor and envelope unwrap are guaranteed.
- **Types in `<module>-types.ts` mirror backend response shapes.** Field
  names are SQL column names verbatim (`customer_record_number`,
  `workflow_status`, `created_at`). When the backend changes a column,
  update the type **first**, then let TypeScript surface every call site
  that needs to change. Do not invent client-side aliases — they hide
  drift.
- **Auth refresh-on-401 is implemented in the response interceptor — but
  refresh tokens do NOT rotate.** `performRefresh` POSTs the existing
  refresh token to `/api/auth/refresh`; the backend returns a new
  `access_token` only and reuses the same refresh-token row (verified
  against `backend/src/services/auth.service.js:290`). Frontend code must
  never assume a new refresh token comes back from refresh — only
  `setAccessToken` is called after a successful refresh
  (`frontend/lib/api.ts:73-75`). A new refresh token is only issued by
  `/api/auth/login`.
- **The 401 retry is single-flight and one-shot per request.** Concurrent
  401s share one `refreshInFlight` promise (`lib/api.ts:62, 105-110`) and
  each request carries a `_retried` sentinel so a second 401 after the
  retry rejects instead of looping (`lib/api.ts:60, 100-104`). Do not
  bypass either guard from a module wrapper.
- **Auth endpoints are exempt from refresh.** Any URL containing
  `/api/auth/` is skipped by the refresh path (`lib/api.ts:96-101`) so a
  bad login surfaces as a clean 401 instead of a refresh attempt.
- **Token storage is browser-only.** `lib/auth.ts` is SSR-safe —
  every accessor checks `typeof window !== 'undefined'` and returns
  `null` on the server (`lib/auth.ts:17-19`). The interceptor handles
  the null token by simply not attaching `Authorization`, so SSR-rendered
  routes never accidentally leak a stale token.
- **Envelope unwrappers throw on `success: false`.** `apiGet` and
  friends throw `new Error(envelope.error || 'Request failed')` if the
  envelope reports failure (`lib/api.ts:131-153`). Module wrappers should
  let the throw propagate to React Query / form submit handlers; do not
  swallow it.
- **WebSocket auth is separate from HTTP auth.** The browser WebSocket
  API cannot set custom headers, so the access token rides in the
  connect URL's query string (`lib/websocket.ts:47`). There is no
  refresh-on-disconnect for WebSocket — on logout, call
  `websocket.disconnect()` so the next session does not inherit the
  socket.
- **`lib/env.ts` fails fast.** Missing `NEXT_PUBLIC_API_URL` or
  `NEXT_PUBLIC_WS_URL` throws at module import (`lib/env.ts:8-16`),
  which in Next.js surfaces as a build/start error rather than a silent
  wrong-URL fetch in production.

## Extension points

- **Add a new endpoint to an existing module.** Open the module's
  `<module>-api.ts`, add a method on the relevant entity object using
  one of the `apiGet / apiPost / apiPut / apiDelete / apiList` helpers,
  and add or extend the matching type in `<module>-types.ts`. Pattern to
  copy: `customersApi.list` (`frontend/lib/sales-api.ts:29-39`). If the
  endpoint is a stage transition, add a verb method beside the CRUD
  quintet — see `salesPoApi.process` and `salesPoApi.overdueReason`
  (`sales-api.ts:104-109`).

- **Add a new module.** Create the trio under `frontend/lib/`:
  `<module>-api.ts`, `<module>-types.ts`, `<module>-ui.ts`. Use
  `BASE = '/api/<module>'` and import only `apiGet`, `apiPost`, `apiPut`,
  `apiDelete`, `apiList` from `./api`. The module trio must not import
  another module's trio — cross-module concerns belong in `global-api.ts`
  / `global-types.ts` (`lib/global-api.ts:1-22`). After the trio is in
  place, wire pages under `app/(app)/<module>/` using the standard
  list/new/[id]/edit shape described in
  [./architecture.md](./architecture.md).

- **Add a new request method (e.g. `PATCH`).** Add the helper in
  `lib/api.ts` next to the existing four — same shape: `api.patch`,
  envelope check, return `res.data.data`. Module trios then use it the
  same way they use `apiPut`.

- **Add a new WebSocket event.** Subscribe with
  `websocket.on('event:name', handler)` from any component or store; the
  returned function unsubscribes (`lib/websocket.ts:88-96`). The payload
  type belongs in `<module>-types.ts` if it is module-scoped, or
  `global-types.ts` if it is cross-module. To send (e.g.
  `chat:send_message`), use `websocket.send(name, data)`
  (`lib/websocket.ts:106-114`).

- **Add a cross-cutting concern (logging, tracing, retries).** Attach it
  as another axios interceptor inside `lib/api.ts`. Do **not** wrap the
  axios instance in module code — interceptors are the only sanctioned
  extension point because they apply uniformly across every module
  trio.

- **Glossary refs:** new endpoints that touch a
  [PO](../business/system-overview.md#glossary-po),
  [PR](../business/system-overview.md#glossary-pr), or
  [BAST](../business/system-overview.md#glossary-bast) record must
  follow the existing naming — the path segment matches the backend
  route, and the type name matches the table name. Renaming for
  client-side ergonomics is forbidden by the type-mirror invariant
  above.
