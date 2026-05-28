# D2a — Make Chat, PO Tracking & Online-Now Work (Design)

- **Date:** 2026-05-26
- **Working dir:** `/opt/projects/interlab-infra/apps/interlabs-crm-demo`
- **Branch:** `feat/sub2-lite-po-types-dummy-data` (foundation + D1 here, unpushed; D2a builds on it)
- **Target env:** live demo / staging; run via `docker exec interlab-api`.
- **Status:** approved design, pre-implementation

---

## 0. Context

After D1 (data) the user tested as superadmin and reported: **chat errors / shows nothing**, **PO Tracking doesn't work**, and **Online-Now never shows last-login**. Investigation found the root cause is **missing backend REST routes**, not the UI:

- The **chat page** (`frontend/app/(app)/chat/page.tsx`) calls `GET /api/chat/channels` + `/messages`, but **no `/api/chat` route is mounted** (chat is WebSocket-only in the backend). → 404 → `apiList` hands the page a non-array → `.map` crash.
- The **PO Tracking page** calls `/api/po-tracking/search|history|latest`, but **no `/api/po-tracking` route is mounted**. The one existing history endpoint (`/api/po/:id/history`) returns `success({ items })` (object) instead of an array — the same shape bug fixed earlier for notifications.
- **Online-Now** (`/api/activity-logs/online`) returns only live-WebSocket connections; it never surfaces `users.last_login_at` or session duration.

D2a makes these features **function** (the seeded data — 150 chat bubbles, 120 POs with status history, `last_login_at` on all users — already exists). It also fixes one data-fidelity gap: PO status-history actor is currently always `sales`; it should reflect the stage-owner role.

The feedback was decomposed into **D2a (make-it-work)** and **D2b (dashboard redesign + search/charts)**; the user chose **D2a first**.

---

## 1. Scope / non-goals

**In scope (D2a):** chat REST routes; PO-tracking REST routes (browsable list + per-PO timeline) + fix the history shape; seeder actor-per-stage fix; Online-Now `last_login_at` + duration. Backend + thin page wiring; the chat & PO-tracking **pages already exist** and just need working endpoints (+ a browsable list view on the PO-tracking page).

**Out of scope (→ D2b):** dashboard scoreboards/KPI cards, line/pie/bar charts (recharts), max-5 lists + "view all", multi-field search/filter + date-picker, professional polish (items #1, #2, #6).

**Reuse:** existing frontend types (`lib/global-types.ts`: `ChatChannel`, `ChatMessage`, `PoTrackingSearchResult`, `PoStatusHistoryRow`) define the contract the new routes must satisfy; the `apiList`/`apiGet` envelope rules (`data` = the array/object) apply. Reuse `DataTable`, `StatusBadge`, `relativeTime`/`formatDate`.

---

## 2. Chat REST routes

New `backend/src/routes/chat.routes.js`, mounted `app.use('/api/chat', authMiddleware, chatRoutes)` in `app.js`. All endpoints require auth; channel access is **membership-gated** (`chat_channel_members`).

- **`GET /api/chat/channels`** → `success(rows)` where `rows` is an array of channels the current user is a member of. Each row matches the frontend `ChatChannel` type (read `global-types.ts` for exact fields): `id`, `channel_type`, `channel_name`, and for DM the **other participant** (`display_name`, `role`, `avatar_url`), plus `last_message` preview + `last_message_at` + `unread_count` (messages after the member's `last_read_message_id`). Sorted by `last_message_at` desc.
- **`GET /api/chat/channels/:id/messages?before=&limit=`** → `success(rows)` array of messages (newest-first, `limit` default 50, cursor `before` = message id or ISO ts). Each matches `ChatMessage`: `id`, `channel_id`, `sender_user_id` + sender `display_name`/`role`, `content`, `created_at`. **403** if the user is not a member of the channel.
- **`POST /api/chat/channels/:id/messages`** `{ content }` → inserts a `chat_messages` row (member-gated), returns the created row (`success(row)`). REST fallback; the realtime path stays the existing WebSocket handler. (Optionally emit the same WS event so other members get it live — reuse `websocket/emitter`.)

The chat page + WebSocket handlers already exist; these endpoints unblock initial load, history paging, and the offline-send fallback. The 150 seeded DM bubbles render once the routes exist.

---

## 3. PO Tracking REST routes + page

New `backend/src/routes/po-tracking.routes.js`, mounted `app.use('/api/po-tracking', authMiddleware, poTrackingRoutes)`.

- **`GET /api/po-tracking?search=&status=&page=&limit=`** → paginated list of POs (`success(rows, meta)`): `id`, `po_number`, `po_type`, customer name, `current_status`, and the **latest** history entry's `updated_by_role` + `created_at` ("last updated by/at"). `search` = partial `po_number` match; `status` optional filter. RBAC: superadmin/CEO see all; division roles see all POs (tracking is read-only visibility) — follow the existing PO read-scope pattern in `po.service`/stage routes.
- **`GET /api/po-tracking/:id/history`** → `success(rows)` array: the full `purchase_order_status_history` for the PO ordered oldest→newest, each row matching `PoStatusHistoryRow` (`status_code`, `status_label`, `created_at`, `updated_by_role`, `updated_by` **display_name** via join, `note`, `reason_if_delayed`, flags). Also expose tracking events if the type needs them.
- **`GET /api/po-tracking/search?po_number=`** → `success(data)` matching `PoTrackingSearchResult` (the single PO + its latest ~3 history rows) — used by the dashboard PO Quick-Search card.
- **Fix** existing `/api/po/:id/history` (`backend/src/routes/po/stage.routes.js`): return `success(h)` (bare array) instead of `success({ items: h })`.

**Page (`frontend/app/(app)/po-tracking/page.tsx`):** becomes a **browsable list** — `DataTable` of all POs (po_number, customer, type, current_status badge, last-updated by/at) with a po_number search box + status filter; clicking a row opens the **timeline** (the `/:id/history` rows rendered as a vertical stage timeline: status, timestamp, who, note). The existing exact-search box stays for quick lookup.

---

## 4. Data fidelity — actor-per-stage (seeder)

In `scripts/seed-dummy/po.js`, when writing `purchase_order_status_history` (and tracking events) per stage, set `updated_by_user_id`/`updated_by_role` to the **stage-owner role's seeded user** instead of always `sales`:

| Stage | Owner role |
|---|---|
| Registered, Processed | sales |
| Production, Invoice | finance |
| Shipped, Customs, Arrived, Delivery | admin_log |
| Inspected, Installation, BAST | technical |

A small `STAGE_OWNER` map + a per-run lookup of one user per role (cache from `pickActor`). The PO row's `created_by` stays sales (the PO is created by sales); only per-stage history actors vary. Re-seed (`--reset`) to apply. So PO Tracking shows realistic "siapa yang ubah" per stage.

---

## 5. Online-Now + last-login

- **Backend** (`activity_log.service.onlineUsers()` + `/api/activity-logs/online`): return, for users to display, `id, display_name, role, avatar_url, last_login_at, is_online, online_since`. `is_online` = currently WebSocket-connected (existing registry). `online_since` = the WS connection start timestamp — **track connect time in `websocket/state.js`** (store `{ connectedAt }` per connection; expose via the registry). Include recently-active users (by `last_login_at`) so the panel isn't empty when nobody is live.
- **Frontend** (`activity-logs/page.tsx` "Online Now" tab): each row shows name + role and either **"🟢 Online • {duration since online_since}"** (when `is_online`) or **"Terakhir online: {formatDate(last_login_at)} {time}"**. Seeded `last_login_at` (varied, recent) makes this populated immediately.

---

## 6. Testing
- Backend route tests (vitest + supertest, `crmdemo_test`): `GET /api/chat/channels` returns an array for a member + **403** for a non-member; `GET .../messages` array + member gate; `POST` inserts. `GET /api/po-tracking` array+meta, `/:id/history` array (oldest→newest, includes `updated_by_role`), `/search` matches `PoTrackingSearchResult`. `/api/po/:id/history` now returns an array (regression for the shape fix).
- Seeder test: assert `purchase_order_status_history.updated_by_role` covers ≥3 distinct roles (not just `sales`) and matches the stage→owner map for a sample.

## 7. Acceptance criteria
1. Chat page loads: superadmin sees their DM threads (≥7) with message history; sending works.
2. PO Tracking page lists all POs (searchable by no PO + status filter); clicking a PO shows the full status timeline with **per-stage actor (role+name) + timestamp + note**.
3. `/api/po/:id/history` and the new endpoints return arrays (no `{items}` shape bug).
4. Online-Now shows each user's last-login date+time, and "online for {duration}" for currently-connected users.
5. After re-seed, PO status history actors span sales/finance/admin_log/technical per the stage map.
6. All new route tests pass; existing suites stay green.

## 8. Risks & mitigations
- **Chat/PO-tracking routes are net-new backend surface** → keep them thin read endpoints reusing existing db/service patterns; member-gating on chat is the main security concern (test the 403).
- **WS connect-time tracking** touches `websocket/state.js` → additive (store connectedAt; existing callers unaffected).
- **Re-seed needed** for actor-per-stage → done in the gated live run; `--reset` is idempotent.
- **Frontend page changes** (PO-tracking list view) are within D2a; deeper visual polish stays D2b.
