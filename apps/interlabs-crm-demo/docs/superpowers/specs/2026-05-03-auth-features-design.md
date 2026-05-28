# Authentication & User Account Features — Design Spec

**Date:** 2026-05-03
**Owner:** Zaky / PT. Interlab Sentra Solutions Indonesia
**Project:** `interlabs-crm-demo` (extending Phase 2 work)
**Branch (target):** `main`

---

## 1. Scope

Four interrelated authentication & profile features built on top of the existing Phase 2 codebase:

| ID | Feature | Status |
|---|---|---|
| A | Remember me on login | 95% existing — verify + minor polish |
| B | Forgot Password flow | NET-NEW — backend endpoints + frontend pages + email |
| C | User Menu Redesign + Edit Profile page | NET-NEW UI — small backend additions |
| D1 | Change Password section in Edit Profile | UI only — backend endpoint exists (Plan 2) |
| D2 | Two-Factor Authentication (Email + TOTP) | NET-NEW — full backend + frontend + library deps |

### Non-goals
- Multi-tenant 2FA policy (single-org only)
- WebAuthn / Passkeys (out of scope; future)
- SSO / SAML / OAuth providers (out of scope)
- Mobile push 2FA (out of scope)
- Password recovery via SMS (out of scope; email only)
- Forced password rotation policy (out of scope)
- Migrating existing demo bcrypt passwords retroactively (handled organically when each user changes password — auth.changePassword dual-verify already in place)

---

## 2. Architectural decisions (locked from brainstorming)

| Decision | Choice |
|---|---|
| Documentation strategy | (d) Single source of truth: this spec doc + brief section updates in `docs/backend/auth-and-rbac.md`, `docs/business/audit-and-compliance.md`, `docs/runbook/deployment.md`, `docs/frontend/architecture.md` after each stage |
| TOTP library | `otplib@^12.0.1` + `qrcode@^1.5.4` |
| `display_name` | Independent field; auto-init from `first_name + last_name` on first save; user can override |
| Phone format | E.164 (`+62...`); validation regex `/^\+[1-9]\d{1,14}$/` |
| Backup codes | 10 codes × 10-char alphanumeric (e.g. `7K3M-9XQ2-NP`); each bcrypt-hashed; single-use |
| Password strength | min 12 char + 1 upper + 1 lower + 1 digit + 1 symbol — applied to forgot-pw, change-pw, 2FA-disable; not retroactively enforced on existing accounts |
| Remember me | Existing pattern (refresh token TTL 30d when remember_me=true) — verify, no architecture change |
| Password hashing | argon2id (new) with bcrypt fallback for legacy demo accounts (existing dual-verify in `auth.changePassword`) |
| 2FA secret encryption | AES-256-GCM, key from env `TWO_FACTOR_ENCRYPTION_KEY` (32 bytes hex) |
| 2FA pending state (between password OK and 2FA verify) | Redis key `2fa:pending:{nonce}` with TTL 5 min |
| Email engine | Raw HTML string + regex `{{placeholder}}` substitution (existing pattern from Plan 2 invitation_pending) |
| Email theme | Light theme only (universal client compat) |
| 2FA login flow | Two-step: password verify → if 2FA enabled return `{requires_2fa: true, pending_token, method}` → user submits OTP → final session |
| CSRF | None added (JWT-in-Authorization-header is CSRF-resistant) |

---

## 3. Database schema (migration 029)

### 3.1 ALTER `users`

```sql
ALTER TABLE users
    ADD COLUMN first_name             text         NULL,
    ADD COLUMN last_name              text         NULL,
    ADD COLUMN phone                  text         NULL,
    ADD COLUMN two_factor_method      text         NOT NULL DEFAULT 'disabled',
    ADD COLUMN two_factor_secret      text         NULL,         -- AES-256-GCM ciphertext
    ADD COLUMN two_factor_backup_codes text[]      NULL,         -- bcrypt hashes
    ADD COLUMN two_factor_enabled_at  timestamptz  NULL,
    ADD CONSTRAINT users_two_factor_method_chk
        CHECK (two_factor_method IN ('disabled','email','totp')),
    ADD CONSTRAINT users_phone_e164_chk
        CHECK (phone IS NULL OR phone ~ '^\+[1-9][0-9]{1,14}$');

CREATE INDEX users_2fa_method_idx ON users (two_factor_method)
    WHERE two_factor_method <> 'disabled';
```

### 3.2 NEW `password_reset_tokens`

```sql
CREATE TABLE password_reset_tokens (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    token_hash    text         NOT NULL UNIQUE,            -- SHA-256(plaintext_token)
    expires_at    timestamptz  NOT NULL,                   -- created_at + 30 min
    used_at       timestamptz  NULL,
    requested_ip  text         NULL,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX password_reset_tokens_user_idx ON password_reset_tokens (user_id);
CREATE INDEX password_reset_tokens_active_idx
    ON password_reset_tokens (token_hash) WHERE used_at IS NULL;
```

### 3.3 NEW `two_factor_email_codes`

```sql
CREATE TABLE two_factor_email_codes (
    id            uuid         PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid         NOT NULL REFERENCES users(id) ON DELETE CASCADE,
    code_hash     text         NOT NULL,                   -- SHA-256(6-digit OTP)
    expires_at    timestamptz  NOT NULL,                   -- created_at + 10 min
    used_at       timestamptz  NULL,
    attempts      int          NOT NULL DEFAULT 0,
    created_at    timestamptz  NOT NULL DEFAULT now()
);
CREATE INDEX two_factor_email_codes_user_idx ON two_factor_email_codes (user_id, created_at);
```

(Pending login state between password OK and 2FA OK uses **Redis** with TTL 5 min — no DB table.)

### 3.4 No retroactive backfill required

`first_name` / `last_name` / `phone` start NULL for existing users. They populate on next profile edit. `display_name` (existing) remains the visible identity until first save.

---

## 4. Security checklist

| Item | Decision |
|---|---|
| Password hashing | argon2id, OWASP params (memoryCost ≥ 19456, timeCost ≥ 2, parallelism 1) — already in `utils/initial_password.js` (Plan 2). New code reuses. |
| bcrypt legacy accounts | Auto-migrated to argon2id when user changes password (existing logic). |
| Reset token | 32 random bytes hex (64-char string); stored as SHA-256 hash only; 30-min expiry; single-use; bound to user_id |
| 2FA TOTP secret | AES-256-GCM encrypted at rest; encryption key from env `TWO_FACTOR_ENCRYPTION_KEY` (32 hex) |
| 2FA backup codes | 10 codes × 10 alphanumeric; bcrypt hashed (cost 12); single-use; user warned to save them |
| 2FA email OTP | 6 digits, SHA-256 hashed in DB, 10-min expiry, single-use, max 5 wrong attempts then code voided |
| Rate limit: login | EXISTING `loginRateLimiter` (5/15min per IP+email) ✓ |
| Rate limit: forgot-password | NEW limiter — 3/hour/IP + 3/hour/email |
| Rate limit: 2FA verify | 5 attempts per pending session; lock 15 min after exhaustion |
| Rate limit: change-password | EXISTING `permissionWriteLimiter` (10/min/user) — apply to /api/auth/change-password |
| Email enumeration prevention | `forgot-password` always returns 200 regardless of email existence |
| CSRF | Not needed (JWT-in-Authorization, not cookie) |
| Audit log events | `auth.login.success`, `auth.login.failed`, `auth.password.changed`, `auth.password.reset.requested`, `auth.password.reset.completed`, `auth.2fa.enabled`, `auth.2fa.disabled`, `auth.2fa.failed`, `auth.profile.updated` |
| Operator action | 🔐 Regenerate Google App Password before production (user noted SMTP creds may have leaked in external chat) |

---

## 5. Per-feature design

### 5.1 Feature A — Remember me

**Status: 95% existing.** No code changes expected; verify works end-to-end after other stages land.

**Existing flow:**
- Frontend `<Checkbox>` "Remember me" → submit body `remember_me: bool`
- Backend `login()` calls `createSession({ rememberMe })` which sets refresh token TTL = 30d (vs 7d default)
- Refresh token stored as bcrypt hash in `user_sessions.token_hash`; token returned to client
- Client persists access_token + refresh_token. Whether to use `localStorage` (persistent) vs `sessionStorage` (tab-only) is currently in `setTokens({rememberMe})` — verify the rememberMe flag actually toggles storage. (If not, minor frontend tweak.)
- Logout clears tokens + revokes session — already implemented

**Verify acceptance criteria:**
- Login with remember_me=true → close browser → reopen → still authenticated within 30d
- Login with remember_me=false → close browser → reopen → forced re-login
- Logout always wipes both tokens regardless of remember_me

### 5.2 Feature B — Forgot Password flow

**New backend endpoints:**

| Method/Path | Body | Response |
|---|---|---|
| `POST /api/auth/forgot-password` | `{email}` | always 200 `{ ok: true }` (no enumeration) |
| `POST /api/auth/reset-password` | `{token, new_password}` | 200 `{ ok: true }` or 400/410 |

**Forgot-password flow:**
1. Validate body. Always return 200. (Enumeration prevention.)
2. SELECT user by lowered email. If not found, no-op log + return.
3. If found: invalidate any prior unused tokens for this user (`UPDATE used_at = now()` to prevent reuse).
4. Generate 32-byte random token, SHA-256 hash, INSERT `password_reset_tokens`.
5. Build reset URL: `{APP_BASE_URL}/reset-password/{token}`.
6. Enqueue `email_queue` row with subject + HTML body using `password_reset_email` template (seed in DB) + sender resolved from `notification_senders` (default 'noreply').
7. activity_log `auth.password.reset.requested`.

**Reset-password flow:**
1. Validate body schema (token = 64 hex; new_password = strength rule).
2. SELECT password_reset_tokens by token_hash WHERE used_at IS NULL.
3. If not found OR expired (`expires_at < now()`) → 410 generic error.
4. argon2id hash new password.
5. Atomic transaction: UPDATE users SET password_hash, must_change_password=false, updated_at; UPDATE token SET used_at = now().
6. Revoke all `user_sessions` for user (force re-login on all devices).
7. activity_log `auth.password.reset.completed`.

**Frontend pages:**
- `/forgot-password` — email input, submit, "Check your email" feedback (always shown, no enumeration)
- `/reset-password/[token]` — 2 password fields (new + repeat), strength indicator, submit → redirect to /login

**Email template (HTML, light theme):**
```
Subject: Reset your Interlab Portal password

Hello {{display_name}},

We received a request to reset your password. Click the button below to choose a new one:

[Reset Password]  → href={{reset_url}}

Or copy this URL: {{reset_url}}

This link expires in 30 minutes. If you didn't request this, you can safely ignore this email — your password remains unchanged.

— Interlab Portal
```

### 5.3 Feature C — User Menu Redesign + Edit Profile page

**Frontend changes:**
- `frontend/components/layout/UserCard.tsx` — convert avatar+name+role+email card to clickable button; render new `<UserMenuDropdown/>` below
- `frontend/components/layout/UserMenuDropdown.tsx` (NEW) — 2 items: "Edit Profile" (Pencil icon) → navigate `/profile/edit`; "Logout" (LogOut icon) → existing logout flow
- `frontend/app/(app)/profile/edit/page.tsx` (NEW) — full edit page
- Existing `<Sign out>` button removed

**Edit profile page sections:**
1. **Profile** (avatar + identity)
   - Avatar uploader (reuse `<AvatarUploader/>` Plan 3)
   - First name * (required)
   - Last name * (required)
   - Email * (required, validate format)
   - Phone * (required, validate E.164)
   - Save button → `PATCH /api/users/me/profile`
2. **Change your password** (Stage 4 — see 5.4)
3. **Two-Factor Authentication** (Stage 6 — see 5.5)

**New backend endpoints:**
| Method/Path | Body | Response |
|---|---|---|
| `GET /api/users/me/profile` | — | `{first_name, last_name, email, phone, display_name, avatar_url}` |
| `PATCH /api/users/me/profile` | `{first_name, last_name, email, phone}` | updated profile |

**`PATCH /api/users/me/profile`** rules:
- Email change requires re-verification? **NO for MVP** — direct change. (Future: send confirmation email.)
- `display_name` auto-derive on first save: if `display_name` was the seeded default and `first_name+last_name` provided, set `display_name = first_name + ' ' + last_name`. If user has already overridden display_name, leave alone.
- activity_log `auth.profile.updated`.

### 5.4 Feature D1 — Change Password (UI section)

**Backend: existing endpoint** `POST /api/auth/change-password` (Plan 2 Task 2.10) — verifies current password (argon2 OR bcrypt), hashes new with argon2id, clears must_change_password.

**Frontend: new section in `/profile/edit` page:**
- Current password field
- New password field (strength validation realtime)
- Repeat new password field (must match)
- Save button → call existing endpoint
- On success: toast + auto-revoke other sessions (existing endpoint should optionally do this — verify in code; if not, add a "log out from other devices" checkbox)

### 5.5 Feature D2 — Two-Factor Authentication

**Library:** `otplib@^12.0.1` (TOTP), `qrcode@^1.5.4` (QR data URI).

**Encryption util** (`backend/src/utils/twofactor_crypto.js`, NEW):
```js
// AES-256-GCM with key from env.twoFactor.encryptionKey
encrypt(plaintext) → ciphertext_base64
decrypt(ciphertext_base64) → plaintext
// Format: iv (12 bytes) || authTag (16 bytes) || ciphertext, all base64
```

**TOTP setup flow (when user picks "Enable Google Authenticator"):**
1. Frontend calls `POST /api/auth/2fa/setup-totp`
2. Backend: generate TOTP secret (`otplib.authenticator.generateSecret()`), build otpauth URI (`otpauth://totp/Interlab:user@example.com?secret=...`), generate QR data URI
3. Return `{secret, qr_data_url}` (NOT yet persisted — user must verify first)
4. Frontend shows QR + secret (manual entry fallback) + 6-digit input
5. User scans / enters → submits to `POST /api/auth/2fa/verify-totp-setup` with `{secret, code}`
6. Backend verifies code with otplib (window 1, ±30s tolerance). If valid:
   - Encrypt secret with AES-256-GCM
   - Generate 10 backup codes (10-char alphanumeric)
   - bcrypt-hash each
   - UPDATE users SET two_factor_method='totp', two_factor_secret=encrypted, two_factor_backup_codes=hashes_array, two_factor_enabled_at=now()
   - Return `{backup_codes: [...]}` to display ONCE (warning: save now, won't be shown again)
   - activity_log `auth.2fa.enabled` (method=totp)

**Email 2FA setup flow:**
1. User picks "Enable Email Two Factor Authentication" → POST `/api/auth/2fa/enable-email`
2. Backend: UPDATE users SET two_factor_method='email', two_factor_enabled_at=now()
3. activity_log `auth.2fa.enabled` (method=email)

(No setup verification needed — first login attempt will exercise the flow.)

**2FA disable:**
- `POST /api/auth/2fa/disable` body `{current_password, code?}` — require current password + (TOTP code OR backup code if currently totp; OR no code if currently email — email user just confirms via password)
- UPDATE users SET two_factor_method='disabled', two_factor_secret=NULL, two_factor_backup_codes=NULL, two_factor_enabled_at=NULL
- Revoke all sessions (force re-login)
- activity_log `auth.2fa.disabled`

**Login flow with 2FA:**
1. User submits email + password + recaptcha → existing flow proceeds
2. After password verify but BEFORE creating session, check user.two_factor_method
3. If `disabled`: existing flow continues, return session
4. If `email` or `totp`:
   - Generate pending nonce (32-byte hex)
   - Store in Redis: key `2fa:pending:{nonce}` value `JSON.stringify({user_id, ip, ts: now})` TTL 5 min
   - If method=email: generate 6-digit OTP, hash, INSERT two_factor_email_codes; enqueue email
   - Return 200 `{requires_2fa: true, pending_token: nonce, method: 'email'|'totp'}` (NO session yet)
5. Frontend redirects to `/login/2fa` with pending_token in URL state
6. User enters 6-digit code → POST `/api/auth/login/2fa-verify` body `{pending_token, code}`
7. Backend:
   - Read Redis `2fa:pending:{pending_token}`. If missing → 410 expired.
   - Decrypt user.two_factor_secret if totp; verify with otplib (window 1)
   - For email: SELECT two_factor_email_codes by user_id ORDER BY created_at DESC LIMIT 1; verify SHA-256 match + not expired + attempts<5
   - For backup code path: bcrypt-compare against each unrevoked entry in two_factor_backup_codes; on match remove that hash from array
   - On success: createSession(rememberMe was already in pending payload? — store in pending state), return tokens; DEL Redis key
   - On fail: increment attempts; if attempts ≥ 5 → DEL pending key, return 429 lockout
   - activity_log `auth.2fa.failed` or `auth.login.success`

**Frontend:**
- `/login/2fa` page (new) — single 6-digit input + "Resend code" button (email mode only) + "Use backup code" link (totp mode)
- 2FA section in `/profile/edit` — radio buttons (Disabled / Email / TOTP) + setup wizard for TOTP (QR + verify) + backup codes display once
- "?" tooltip on Email option (per spec)

---

## 6. UI/UX

| Topic | Decision |
|---|---|
| Edit Profile location | Separate page `/profile/edit` (bookmarkable, accessible) |
| User dropdown component | Custom (no new lib) — native button + click-outside hook + Tailwind absolute positioning |
| Theme | Pakai red palette (Input/Select/StatusBadge dark variants) — already in place |
| Avatar | Reuse `<AvatarUploader/>` + `<AvatarDisplay/>` Plan 3 |
| Form validation | Zod schema (frontend realtime on blur) + Joi (backend authoritative). Pattern: red border on invalid blur; submit blocked until valid. |
| Required asterisk | Red `*` after label, e.g. `First Name <span className="text-red-500">*</span>` |
| Error pattern | Existing `<p role="alert" className="rounded-md border border-destructive/40 bg-destructive/10 px-3 py-2 text-sm text-destructive">` |
| Success pattern | `toast.success(...)` from sonner |
| Backup codes display | Modal-style overlay with copy button + checkbox "I saved these" required to close |

---

## 7. Email templates

Stored in `notification_templates` table (existing infrastructure from Plan 5). Seeded in seed.js.

### 7.1 `password_reset_email`

```
template_key: 'password_reset_email'
template_name: 'Password reset link'
feature_group: 'auth'
trigger_event: 'auth.password.reset.requested'
recipient_roles_json: '[]'   -- direct recipient via to_address
send_email_enabled: true
send_dashboard_notification_enabled: false
status: 'enabled'
subject: 'Reset your Interlab Portal password'
body: <HTML body — see section 5.2>
```

### 7.2 `two_factor_email_otp`

```
template_key: 'two_factor_email_otp'
subject: 'Your Interlab Portal verification code'
body:
  Hello {{display_name}},
  Your verification code is: {{code}}
  This code expires in 10 minutes.
  If you did not try to log in, please change your password immediately.
  — Interlab Portal
```

---

## 8. Stage rollout — 6 stages with manual checkpoints

Each stage produces working software + manual test gate before advancing.

### Stage 1 — Database migration + schema

**Scope:** Migration 029 (users alter + password_reset_tokens + two_factor_email_codes), apply to test DB.

**Changes:**
- `backend/migrations/029_user_profile_and_2fa.sql` (new)
- Test: `backend/test/migrations/029_*.test.js`

**Manual test:** verify columns/tables exist; existing users still work.

### Stage 2 — Verify Remember Me

**Scope:** End-to-end test of existing flow. Possibly minor frontend tweak (storage choice).

**Changes:** Possibly `frontend/lib/auth.ts` — verify `setTokens({rememberMe})` actually persists differently.

**Manual test:** login with/without checkbox; close browser; verify behavior.

### Stage 3 — Edit Profile + User Menu Dropdown

**Scope:** Backend `GET/PATCH /api/users/me/profile` + frontend dropdown + `/profile/edit` page (basic identity section only — no password / 2FA sections yet).

**Changes:**
- `backend/src/routes/users/me-profile.routes.js` (new)
- `backend/src/services/user_profile.service.js` (new) — `getProfile`, `updateProfile`
- `backend/src/validators/profile.validators.js` (new)
- `frontend/components/layout/UserMenuDropdown.tsx` (new)
- `frontend/components/layout/UserCard.tsx` (modify — clickable, embed dropdown)
- `frontend/app/(app)/profile/edit/page.tsx` (new)
- `frontend/lib/profile-api.ts` (new)
- `frontend/lib/profile-types.ts` (new)
- `backend/src/app.js` (modify — mount route)
- Tests for service + validators

**Manual test:** click user card → dropdown → Edit Profile → fill all 4 fields → save → reload → values persist.

### Stage 4 — Change Password section in Edit Profile

**Scope:** UI section in `/profile/edit` calling existing `POST /api/auth/change-password`.

**Changes:**
- `frontend/app/(app)/profile/edit/page.tsx` (modify — add ChangePasswordSection component)
- `frontend/components/profile/ChangePasswordSection.tsx` (new) — current pw + new pw + repeat
- `frontend/lib/profile-api.ts` (modify — add changePassword call wrapper)

**Manual test:** wrong current → error; weak new → blocked; correct → success + can login with new password.

### Stage 5 — Forgot Password flow + email

**Scope:** Backend forgot/reset endpoints, email template seed, frontend `/forgot-password` and `/reset-password/[token]` pages.

**Changes:**
- `backend/src/routes/auth/forgotPassword.routes.js` (new) — POST `/forgot-password` + `/reset-password`
- `backend/src/services/password_reset.service.js` (new)
- `backend/src/middleware/rateLimit.middleware.js` (modify — add `forgotPasswordLimiter`)
- `backend/scripts/seed.js` (modify — add `password_reset_email` template)
- `backend/src/app.js` (modify — mount route)
- `frontend/app/forgot-password/page.tsx` (new)
- `frontend/app/reset-password/[token]/page.tsx` (new)
- `frontend/lib/auth.ts` (modify — add forgotPassword/resetPassword API helpers)
- Login page — wire "Forgot password?" link to `/forgot-password`
- Tests for service + endpoints

**Manual test:** click forgot password → enter email → check email inbox → click link → set new password → login.

### Stage 6 — Two-Factor Authentication (most complex)

**Scope:** All TOTP + Email 2FA flows.

**Library install:** `otplib@^12.0.1` `qrcode@^1.5.4` (backend), `@types/qrcode@^1.5.5` (dev dep).

**New env var:** `TWO_FACTOR_ENCRYPTION_KEY=<32-byte-hex>` (generate via `openssl rand -hex 32`).

**Changes:**
- `backend/src/utils/twofactor_crypto.js` (new) — AES-256-GCM encrypt/decrypt
- `backend/src/utils/twofactor_codes.js` (new) — backup codes generate + hash + verify
- `backend/src/services/two_factor.service.js` (new) — setupTotp, verifyTotpSetup, enableEmail, disable, generatePendingNonce, verifyOtp/Totp/BackupCode
- `backend/src/routes/auth/twofactor.routes.js` (new) — setup-totp, verify-totp-setup, enable-email, disable, login/2fa-verify, 2fa/email-resend
- `backend/src/services/auth.service.js` (modify) — `login()` returns `{requires_2fa,...}` if user has 2FA enabled; new `loginWith2fa(pending_token, code)` method
- `backend/scripts/seed.js` (modify — add `two_factor_email_otp` template)
- `backend/migrations/029_user_profile_and_2fa.sql` already covers schema (Stage 1)
- `frontend/components/profile/TwoFactorSection.tsx` (new) — radio buttons + setup wizard + backup codes display
- `frontend/app/login/2fa/page.tsx` (new) — verify OTP page after password
- `frontend/lib/twofactor-api.ts` (new)
- `frontend/lib/twofactor-types.ts` (new)
- `frontend/app/login/page.tsx` (modify — handle `requires_2fa: true` response → redirect to `/login/2fa`)
- Tests for service + crypto util + endpoints

**Manual test scenarios:**
- Enable Email 2FA → logout → login → receive email OTP → enter → success
- Enable TOTP → scan QR → verify → save backup codes → logout → login → enter TOTP → success
- TOTP login with wrong code 5x → lockout
- TOTP login with backup code → success → backup code consumed
- Disable 2FA with password + code → revert to normal login

---

## 9. Library install summary (require user approval per stage)

| Stage | Package | Purpose |
|---|---|---|
| 6 | `otplib@^12.0.1` | TOTP generation/verification |
| 6 | `qrcode@^1.5.4` | QR data URI generation |
| 6 | `@types/qrcode@^1.5.5` (dev) | TS types |

No frontend deps added — all UI is custom React with existing components.

---

## 10. Documentation updates per stage

After each stage lands and is tested:

| Stage | Doc updates |
|---|---|
| 1 | `docs/runbook/database.md` — note migration 029 added |
| 2 | `docs/backend/auth-and-rbac.md` — confirm Remember Me documented |
| 3 | `docs/frontend/architecture.md` — UserMenuDropdown + Edit Profile route |
| 4 | `docs/backend/auth-and-rbac.md` — Change Password endpoint usage |
| 5 | `docs/backend/auth-and-rbac.md` — Forgot/Reset endpoints; `docs/runbook/deployment.md` — `APP_BASE_URL` env var |
| 6 | `docs/backend/auth-and-rbac.md` — 2FA endpoints; `docs/runbook/deployment.md` — `TWO_FACTOR_ENCRYPTION_KEY` env var; `docs/business/audit-and-compliance.md` — new audit events |

---

## 11. Testing plan

Test runner: vitest 1.x via Docker (existing Phase 2 pattern).

| Stage | Test files (high-level) |
|---|---|
| 1 | `test/migrations/029_*.test.js` — column existence, constraint, index |
| 2 | (manual) |
| 3 | `test/services/user_profile.service.test.js`; `test/routes/users.me-profile.test.js` |
| 4 | (existing change-password tests cover backend; FE manual) |
| 5 | `test/services/password_reset.service.test.js`; `test/routes/auth.forgotPassword.test.js` |
| 6 | `test/utils/twofactor_crypto.test.js`; `test/services/two_factor.service.test.js`; `test/routes/auth.twofactor.test.js`; `test/services/auth.login.2fa.test.js` |

---

## 12. Acceptance criteria summary

End of all 6 stages:

- ✓ User can update first/last/email/phone/avatar via `/profile/edit`
- ✓ Click user card → dropdown with Edit Profile + Logout
- ✓ Forgot password email → click link → set new password → login
- ✓ Change password from `/profile/edit` (current → new)
- ✓ Enable Email 2FA → login challenges OTP → enter → success
- ✓ Enable TOTP 2FA → QR scan → verify → backup codes → login challenges TOTP → success
- ✓ Backup code consumes correctly, single use
- ✓ Disable 2FA reverts to normal login
- ✓ Remember me 30d session persists, logout clears, no plaintext password ever stored client-side
- ✓ All required audit events logged in activity_log
- ✓ Rate limits enforced (forgot-pw, 2fa-verify, change-pw)

---

## 13. Out of scope (future)

- WebAuthn / Passkeys
- SMS 2FA
- TOTP via SMS gateway
- Forced password expiry / rotation policy
- Multi-tenant 2FA enforcement policy
- Security key (FIDO2) hardware support
- Email 2FA "trust this device for 30 days"
- TOTP recovery via support team manual override (workaround: admin can soft-reset 2FA via DB UPDATE for the specific user)

---

## 14. References

- `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` — Phase 2 base
- `backend/src/services/auth.service.js` — existing login/refresh flow
- `backend/src/services/avatar.service.js` — Plan 3 avatar pattern (reused)
- `backend/src/services/notification_dispatch.worker.js` — Plan 5 email dispatch (reused)
- `backend/src/utils/initial_password.js` — Plan 2 argon2id pattern (reused)
- `backend/src/utils/invitation_token.js` — Plan 2 token-hash pattern (reused for reset tokens)

---

**END OF SPEC**
