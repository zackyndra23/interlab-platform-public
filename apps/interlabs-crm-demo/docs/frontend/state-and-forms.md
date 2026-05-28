---
audience: dev
reading_time: 6 min
last_reviewed: 2026-04-27
---

# Frontend state and forms

## Mental model

Global UI state is owned by four narrow [Zustand](https://github.com/pmndrs/zustand)
stores. There is no top-level Redux-style root: each store is a single
`create<...>()` call that lives next to the feature it serves.

- `auth.store.ts` reflects the decoded session (`user`, `status`) so
  `AuthGuard`, the sidebar, and `usePermission` can render against the
  current role. Token persistence lives in `lib/auth.ts`, not the store
  (`frontend/stores/auth.store.ts:5`).
- `notification.store.ts` holds the bell badge state and the latest five
  unread items pushed by the WebSocket. Full history pages fetch their
  own data; the store is only what realtime UI needs
  (`frontend/stores/notification.store.ts:3`).
- `sidebar.store.ts` owns `collapsed` and `setupOpen`. The collapse bit
  hydrates from `user_preferences.sidebar_collapsed` via the `/me`
  bootstrap (`frontend/stores/sidebar.store.ts:5`).
- `theme.store.ts` drives `data-theme="light|dark"` on `<html>` and
  mirrors to `localStorage` so `ThemeBootstrap` can flip the attribute
  before `/me` returns (`frontend/stores/theme.store.ts:5`).

Forms use [react-hook-form](https://react-hook-form.com/) for state and
[zod](https://zod.dev/) for validation — schemas are parsed with
`schema.safeParse(raw)` inside the `onSubmit` handler rather than via
`@hookform/resolvers`, but the contract is the same: every submission
runs through a zod schema before the API call. `useFormDraft` adds a
universal autosave/rehydrate layer per IMPL_frontend §F9
(`frontend/hooks/useFormDraft.ts:5`). All inputs render through the
shared components in `components/shared/` so labels, error rendering,
file upload caps, IDR formatting, and relational lookups stay
consistent across the eight modules ([**Sales**](../business/system-overview.md#glossary-sales),
[**Admin & Log**](../business/system-overview.md#glossary-admin--log),
[**Finance**](../business/system-overview.md#glossary-finance),
[**Technical**](../business/system-overview.md#glossary-technical),
[**HRGA**](../business/system-overview.md#glossary-hrga),
[**Tax & Insurance**](../business/system-overview.md#glossary-tax--insurance),
plus the [**Superadmin**](../business/system-overview.md#glossary-superadmin)
and [**CEO**](../business/system-overview.md#glossary-ceo) cross-cutting roles).

The four module-edge hooks — `useAuth`, `usePermission`,
`useNotifications`, `useWebSocket` — sit between the stores and page
components so individual screens never reach into the WebSocket client
or the RBAC matrix directly.

## Wiring

A typical create/edit page binds these pieces together in one render:

```tsx
// frontend/components/<module>/<Entity>Form.tsx — canonical shape
const form = useForm<FormValues>({ defaultValues: defaults(existing) });
const values = form.watch();
const draft = useFormDraft<FormValues>({
    formKey: 'admin_log.awb',
    recordId: existing?.id ?? 'new',
    currentValues: values,
});
async function onSubmit(raw: FormValues) {
    const parsed = schema.safeParse(raw);
    if (!parsed.success) { toast.error(parsed.error.issues[0].message); return; }
    await moduleApi.create(parsed.data);
    draft.clearDraft();
    router.replace('/admin-log/awb');
}
```

Lifecycle, in order, on a fresh page mount:

1. **Mount.** The form component initialises `useForm` with
   `defaults(existing)` — either the record loaded from the server or a
   blank shape. `useFormDraft` checks `localStorage` for
   `draft:<formKey>:<recordId|'new'>` and flips `hasDraft` if a stale
   draft is sitting there (`frontend/hooks/useFormDraft.ts:38`).
2. **Resume banner.** When `hasDraft` is `true` the page shows a
   `DraftBanner`; clicking *Resume* calls `draft.loadDraft()` and feeds
   the result to `form.reset(d)`. *Discard* calls `draft.clearDraft()`.
3. **Edit.** As the user types, react-hook-form keeps internal state in
   sync. `form.watch()` exposes the live values; `useFormDraft`
   serialises them to `localStorage` every 60 seconds via a stable
   interval that reads from a ref so the closure stays valid
   (`frontend/hooks/useFormDraft.ts:46`).
4. **Submit.** `form.handleSubmit(onSubmit)` runs RHF's built-in
   per-field validation, then the handler calls `schema.safeParse`. On
   `success: false` we surface the first issue via
   [sonner](https://sonner.emilkowal.ski/) `toast.error`. On success we
   call the typed module-API client (`apiPost` / `apiPut` under
   `lib/<module>-api.ts`).
5. **Toast and redirect.** API success → `toast.success(...)` plus
   `draft.clearDraft()` so a completed record never leaves a stale
   draft behind, then `router.replace(...)` back to the list. API
   failure → `toast.error(err.message)` and the form stays open with
   its current values (and the autosaved draft) intact.

Realtime side-effects are layered on top of this lifecycle. Pages that
care about server-driven changes — for example a
[**PO**](../business/system-overview.md#glossary-po) detail screen that
must redraw when `purchase_order:status:changed` fires — register via
`useWebSocket(eventName, handler)` (`frontend/hooks/useWebSocket.ts:18`).
The hook keeps the handler in a ref so closures over local state stay
fresh without forcing the caller to memoise. `useNotifications` is the
single mounted-once consumer of `notification:new` /
`notification:count`; it also seeds the bell from
`GET /api/notifications?limit=5&unread=true` on mount
(`frontend/hooks/useNotifications.ts:37`). See
[`../backend/websocket.md`](../backend/websocket.md) for the full WebSocket contract.

## Key files

### Stores

| File | Owns | Hydrated from |
| --- | --- | --- |
| `frontend/stores/auth.store.ts:25` | `user`, bootstrap `status` | `GET /api/auth/me` via `AuthGuard` |
| `frontend/stores/notification.store.ts:35` | `unreadCount`, `latestUnread` (5) | `GET /api/notifications` + WebSocket pushes |
| `frontend/stores/sidebar.store.ts:22` | `collapsed`, `setupOpen` | `user_preferences.sidebar_collapsed` via `/me` |
| `frontend/stores/theme.store.ts:31` | `theme` (`light|dark`) | `localStorage['theme']` then `/me` |

### Hooks and shared components

| File | Role |
| --- | --- |
| `frontend/hooks/useAuth.ts:11` | Subscribes to `auth.store` and returns `{ user, status }` |
| `frontend/hooks/usePermission.ts:11` | UI-only feature gate against `lib/rbac.ts` (backend remains authoritative) |
| `frontend/hooks/useFormDraft.ts:22` | 60-second autosave + `loadDraft` / `clearDraft` / `saveNow`, keyed `draft:<formKey>:<recordId>` |
| `frontend/hooks/useNotifications.ts:25` | Seeds + binds the notification store to WebSocket events |
| `frontend/hooks/useWebSocket.ts:18` | Stable per-event subscription with a handler ref |
| `frontend/components/shared/FormField.tsx:23` | Label + required marker + inline error/hint wrapper |
| `frontend/components/shared/CurrencyInput.tsx:14` | Numeric input + `IDR/USD/EUR` selector |
| `frontend/components/shared/DatePicker.tsx:13` | ISO-8601 single-date input mapped to backend `DATE` |
| `frontend/components/shared/SearchDropdown.tsx:31` | Debounced async relational lookup against any `?search=` endpoint |
| `frontend/components/shared/RepeaterTable.tsx:39` | Inline editable table for line items / contacts |
| `frontend/components/shared/MultiFileUpload.tsx:48` | Upload-on-select panel returning `file_id`s |
| `frontend/components/shared/AttachmentList.tsx:38` | Read-only attachment list for detail pages |

## Invariants

1. **Forms always go through react-hook-form + zod.** Every create or
   edit page binds `useForm<FormValues>` and runs `schema.safeParse(raw)`
   inside `onSubmit` before the API call. There is no
   ad-hoc `useState`-driven form anywhere in the module pages — the
   `useFormDraft` autosave contract assumes RHF semantics
   (`form.watch()` for the live values,
   `form.reset(loadDraft())` for rehydrate). See the canonical pattern
   in `frontend/components/admin-log/AwbForm.tsx:86`.

2. **Currency uses `CurrencyInput`.** Every monetary field —
   [**Quotation**](../business/system-overview.md#glossary-quotation) totals,
   [**HPP**](../business/system-overview.md#glossary-hpp) rows,
   [**PR**](../business/system-overview.md#glossary-pr) line items,
   invoice amounts — renders through `CurrencyInput` so the IDR-primary formatting story stays in
   one place (`frontend/components/shared/CurrencyInput.tsx:14`). The
   stored value is always a number (or `null`); never persist a
   formatted string. Use `formatCurrency(value, currency)` from
   `lib/utils.ts` for read-only displays.

3. **File uploads use `MultiFileUpload` with the matching backend size
   cap.** The component's `maxSizeMB` prop defaults to `25`
   (`frontend/components/shared/MultiFileUpload.tsx:54`), which is the
   exact value the backend enforces via
   `UPLOAD_MAX_FILE_SIZE_MB` →
   `config.uploads.maxFileSizeMb` (`backend/src/config/env.js:178`,
   default `25` in `backend/.env.example:40`). When you raise the cap in
   one place, raise it in the other — the comment in `env.js:175`
   names the relationship explicitly. `MultiFileUpload` uploads on
   selection and surfaces the server-assigned `file_id`s via `onChange`
   so forms submit references, never raw bytes
   (`frontend/components/shared/MultiFileUpload.tsx:74`). See
   [`../backend/architecture.md`](../backend/architecture.md) for the
   server-side multer + MinIO chain.

4. **The four global stores are the only Zustand stores.** New
   per-feature state belongs in component state or react-query (when it
   lands), not a fifth store. Page-level cache that survives
   navigation is the autosaved draft, not the store layer.

5. **`usePermission` is UI-only.** A `false` return must hide a button
   or menu entry, never replace a server check. The backend route
   middleware enforces RBAC for real
   (see [`../backend/auth-and-rbac.md`](../backend/auth-and-rbac.md)).

6. **`useWebSocket` handlers are not memoised by the caller.** The
   hook holds the handler in a ref so closures over component state
   stay fresh (`frontend/hooks/useWebSocket.ts:22`). Don't wrap your
   handler in `useCallback` — it's unnecessary and hides the contract.

## Extension points

- **New form on an existing module.** Copy an existing module form
  (e.g. `frontend/components/admin-log/AwbForm.tsx`) verbatim, swap the
  zod schema, defaults, and `moduleApi.*` call, and pick a new
  `useFormDraft` `formKey` — the convention is
  `<module>.<entity>` (e.g. `admin_log.awb`, `finance.po_customer`).
  Keep the resume-banner block, the `safeParse` guard, the
  `clearDraft()` on success, and the toast-on-error path.

- **New shared input.** Add the component under
  `frontend/components/shared/`, follow the pattern of `DatePicker`
  (small focused wrapper) or `SearchDropdown` (debounced async). Keep
  the public surface minimal: `value`, `onChange`, `disabled`, plus
  whatever lookups the input needs. Wire it inside `FormField` at the
  call site so labels and error rendering stay uniform. Do not add a
  validation library — schemas live with the form, not the input.

- **New global UI state.** Add a fifth Zustand store only when the
  state is genuinely cross-page and read by more than one mounted
  component. Put it in `frontend/stores/<name>.store.ts`, hydrate from
  `/me` if it's a user preference, and document the source-of-truth
  rule in the file header comment the way `theme.store.ts` does.

- **New WebSocket-driven page.** Subscribe with `useWebSocket(event,
  handler)` inside a `useEffect`-free component body — the hook owns
  the effect. For events that should mutate the notification badge,
  reuse `useNotifications` rather than reading the store directly so
  the optimistic mark-read paths stay consistent.

<!-- drift-anchors:
  frontend/stores/auth.store.ts
  frontend/stores/notification.store.ts
  frontend/stores/sidebar.store.ts
  frontend/stores/theme.store.ts
  frontend/hooks/useAuth.ts
  frontend/hooks/useFormDraft.ts
  frontend/hooks/useNotifications.ts
  frontend/hooks/useWebSocket.ts
  frontend/hooks/usePermission.ts
  frontend/components/shared/RepeaterTable.tsx
  frontend/components/shared/MultiFileUpload.tsx
  frontend/components/shared/FormField.tsx
  frontend/components/shared/DatePicker.tsx
  frontend/components/shared/CurrencyInput.tsx
  frontend/components/shared/SearchDropdown.tsx
  frontend/components/shared/AttachmentList.tsx
  frontend/components/admin-log/AwbForm.tsx
  backend/src/config/env.js
  backend/.env.example
  CLAUDE.md
-->
