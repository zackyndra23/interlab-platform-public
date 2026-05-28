# Plan 3 — F3 Avatar Upload Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use `superpowers:subagent-driven-development` (recommended) or `superpowers:executing-plans` to implement this plan task-by-task.
>
> **Spec:** `docs/superpowers/specs/2026-05-02-mindio-phase2-design.md` (commit `95efcec`)
> **Master plan:** `docs/superpowers/plans/2026-05-02-mindio-phase2-master-plan.md`
> **Depends on:** Plan 1 (Foundation + F2). Plan 2 (Invitation) may or may not be merged — Plan 3 doesn't depend on it.

**Goal:** Authenticated users can upload, replace, or remove their own avatar; everyone else views avatars via short-lived presigned URLs with role-default PNG fallback.

**Architecture:** Two-step upload: client gets a presigned PUT URL, uploads the raw image directly to MinIO, then calls a commit endpoint that downloads the file, validates it (mime + magic-byte sniff + dimensions), resizes via `sharp` to a 256×256 webp + 64×64 thumbnail, strips EXIF, and re-uploads to a stable path. The user's `avatar_file_id` FK points at the resulting `file_attachments` row. Display: presigned GET URL (15-min TTL); fallback to `avatars/defaults/{role}.png` for users with no upload.

**Tech Stack:** `sharp` ^0.33 (new — image processing), `file-type` ^16 (new — magic-byte sniff; v16 is the last CJS-compatible version), existing `minio` client, existing `file.service.js` for storage primitives, Next.js client-side image preview before upload.

---

## File map

**Net-new backend files**
- `backend/migrations/021_user_avatars.sql`
- `backend/src/utils/image_validator.js`
- `backend/src/services/avatar.service.js`
- `backend/src/routes/users/me-avatar.routes.js`
- `backend/test/migrations/021_user_avatars.test.js`
- `backend/test/utils/image_validator.test.js`
- `backend/test/services/avatar.service.test.js`

**Modified backend files**
- `backend/package.json` — add `sharp@^0.33`, `file-type@^16.5.4`
- `backend/src/app.js` — mount avatar routes
- `backend/src/services/auth.service.js` — `loadProfile` returns `avatar_url` resolved to a presigned URL (or default fallback)

**Net-new frontend files**
- `frontend/lib/avatar-api.ts`
- `frontend/components/avatar/AvatarUploader.tsx`
- `frontend/components/avatar/AvatarDisplay.tsx`

**Modified frontend files**
- `frontend/components/layout/Topbar.tsx` (or wherever the avatar currently displays in the shell)
- `frontend/app/(app)/profile/page.tsx` (if exists; otherwise create)
- `frontend/lib/auth.ts` or `lib/rbac.ts` — extend `UserProfile` type with `avatar_url: string | null` if not already present

---

## Task 3.1 — Migration 021: `users.avatar_file_id` + `avatar_updated_at`

**Files:**
- Create: `backend/migrations/021_user_avatars.sql`
- Create: `backend/test/migrations/021_user_avatars.test.js`

- [ ] **Step 3.1.1 — Write failing test**

```js
'use strict';
const { pool } = require('../helpers/db');

describe('migration 021 user avatars', () => {
  it('users.avatar_file_id column exists with FK to file_attachments', async () => {
    const r = await pool.query(`
      SELECT 1 FROM information_schema.columns
       WHERE table_name='users' AND column_name='avatar_file_id'`);
    expect(r.rowCount).toBe(1);

    const fk = await pool.query(`
      SELECT pg_get_constraintdef(c.oid) AS def
        FROM pg_constraint c
       WHERE c.conrelid = 'users'::regclass
         AND c.contype = 'f'
         AND pg_get_constraintdef(c.oid) LIKE '%avatar_file_id%'`);
    expect(fk.rowCount).toBe(1);
    expect(fk.rows[0].def).toMatch(/REFERENCES file_attachments/i);
    expect(fk.rows[0].def).toMatch(/ON DELETE SET NULL/i);
  });

  it('users.avatar_updated_at column exists (nullable timestamptz)', async () => {
    const r = await pool.query(`
      SELECT data_type, is_nullable
        FROM information_schema.columns
       WHERE table_name='users' AND column_name='avatar_updated_at'`);
    expect(r.rowCount).toBe(1);
    expect(r.rows[0].data_type).toMatch(/timestamp/i);
    expect(r.rows[0].is_nullable).toBe('YES');
  });
});
```

- [ ] **Step 3.1.2 — Run failing test**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/migrations/021_user_avatars.test.js 2>&1 | tail -10
```

Expected: 2 fails.

- [ ] **Step 3.1.3 — Write migration**

```sql
-- ============================================================================
-- Migration 021: user avatar columns
-- F3 Avatar Upload (spec section 4)
-- ============================================================================

-- +migrate Up
BEGIN;

ALTER TABLE users
  ADD COLUMN avatar_file_id    uuid        NULL REFERENCES file_attachments(id) ON DELETE SET NULL,
  ADD COLUMN avatar_updated_at timestamptz NULL;

CREATE INDEX users_avatar_file_idx ON users (avatar_file_id) WHERE avatar_file_id IS NOT NULL;

COMMIT;

-- +migrate Down
BEGIN;
DROP INDEX IF EXISTS users_avatar_file_idx;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_updated_at;
ALTER TABLE users DROP COLUMN IF EXISTS avatar_file_id;
COMMIT;
```

- [ ] **Step 3.1.4 — Apply + run test**

```bash
DB_URL=$(grep '^DATABASE_URL=' /opt/projects/interlabs-crm-demo/.env | cut -d= -f2- | sed -E 's|/[^/?]+(\?.*)?$|/crmdemo_test\1|') && \
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/backend \
  -e DATABASE_URL="$DB_URL" \
  node:20 node scripts/migrate.js 2>&1 | tail -3
```

Expected: `[migrate] apply 021_user_avatars.sql`.

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

Expected: full suite passes.

- [ ] **Step 3.1.5 — Commit**

```bash
git add backend/migrations/021_user_avatars.sql backend/test/migrations/021_user_avatars.test.js
git commit -m "feat(db): migration 021 user avatars

Adds users.avatar_file_id (FK to file_attachments, ON DELETE SET NULL)
and users.avatar_updated_at. Partial index on avatar_file_id for the
'find users without avatar' query.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.2 — Image validator utility

**Files:**
- Create: `backend/src/utils/image_validator.js`
- Create: `backend/test/utils/image_validator.test.js`

The utility validates uploaded image bytes — defends against MIME spoofing (e.g. `.png` filename with PDF bytes) and rejects SVG outright.

- [ ] **Step 3.2.1 — Install file-type@16**

`file-type` v17+ is ESM-only. Use v16 for CJS compatibility:

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/backend node:20 npm install file-type@^16.5.4 2>&1 | tail -5
```

- [ ] **Step 3.2.2 — Write failing test**

```js
'use strict';
const { validateImageBuffer, ACCEPTED_MIMES, MAX_BYTES } = require('../../src/utils/image_validator');

// Magic-byte starters for PNG and JPEG
function pngBytes() {
  return Buffer.from([0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A,
                      0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44, 0x52, 0, 0, 0, 1, 0, 0, 0, 1]);
}
function jpegBytes() {
  return Buffer.from([0xFF, 0xD8, 0xFF, 0xE0, 0x00, 0x10, 0x4A, 0x46]);
}

describe('image_validator', () => {
  it('exports a list of accepted mimes (png, jpeg, webp)', () => {
    expect(ACCEPTED_MIMES).toEqual(expect.arrayContaining(['image/png','image/jpeg','image/webp']));
    expect(ACCEPTED_MIMES).not.toContain('image/svg+xml');
  });

  it('exports MAX_BYTES around 5 MiB', () => {
    expect(MAX_BYTES).toBeGreaterThanOrEqual(1024 * 1024);
    expect(MAX_BYTES).toBeLessThanOrEqual(10 * 1024 * 1024);
  });

  it('accepts a valid PNG buffer', async () => {
    const r = await validateImageBuffer(pngBytes());
    expect(r.ok).toBe(true);
    expect(r.mime).toBe('image/png');
  });

  it('accepts a valid JPEG buffer', async () => {
    const r = await validateImageBuffer(jpegBytes());
    expect(r.ok).toBe(true);
    expect(r.mime).toMatch(/jpeg/);
  });

  it('rejects bytes that do not match a known image format', async () => {
    const r = await validateImageBuffer(Buffer.from('this is not an image'));
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an image|unsupported/i);
  });

  it('rejects oversized buffer', async () => {
    const big = Buffer.alloc(MAX_BYTES + 1, 0xFF);
    const r = await validateImageBuffer(big);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/too large|exceeds/i);
  });

  it('rejects SVG bytes (text/xml not in accepted list)', async () => {
    const svg = Buffer.from('<svg xmlns="http://www.w3.org/2000/svg"></svg>');
    const r = await validateImageBuffer(svg);
    expect(r.ok).toBe(false);
    expect(r.reason).toMatch(/not an image|unsupported/i);
  });
});
```

- [ ] **Step 3.2.3 — Implement**

```js
'use strict';
const fileType = require('file-type'); // v16 CJS

const ACCEPTED_MIMES = ['image/png', 'image/jpeg', 'image/webp'];
const MAX_BYTES = 5 * 1024 * 1024;  // 5 MiB

async function validateImageBuffer(buf) {
  if (!Buffer.isBuffer(buf)) return { ok: false, reason: 'expected Buffer input' };
  if (buf.length > MAX_BYTES) {
    return { ok: false, reason: `image too large: ${buf.length} bytes exceeds ${MAX_BYTES}` };
  }
  // Magic-byte sniff (defeats extension spoofing)
  const ft = await fileType.fromBuffer(buf);
  if (!ft || !ACCEPTED_MIMES.includes(ft.mime)) {
    return { ok: false, reason: `not an image or unsupported format (detected: ${ft?.mime || 'unknown'})` };
  }
  return { ok: true, mime: ft.mime, ext: ft.ext };
}

module.exports = { validateImageBuffer, ACCEPTED_MIMES, MAX_BYTES };
```

- [ ] **Step 3.2.4 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/utils/image_validator.test.js 2>&1 | tail -10
```

Expected: 7/7 pass.

```bash
git add backend/package.json backend/package-lock.json backend/src/utils/image_validator.js backend/test/utils/image_validator.test.js
git commit -m "feat(util): image_validator — magic-byte mime sniff + 5MiB cap

Defeats MIME spoofing (e.g. PDF renamed .png) by reading actual bytes
via file-type. Whitelist: PNG, JPEG, WEBP. Explicitly rejects SVG.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.3 — Avatar service: presign + commit + get

**Files:**
- Create: `backend/src/services/avatar.service.js`
- Create: `backend/test/services/avatar.service.test.js`

- [ ] **Step 3.3.1 — Install sharp**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/backend node:20 npm install sharp@^0.33 2>&1 | tail -5
```

- [ ] **Step 3.3.2 — Read existing file.service.js**

Read `backend/src/services/file.service.js` end-to-end first. Note specifically:
- The `buildStoragePath(relatedModule, entityId, fileId, originalFilename)` helper
- `uploadFile({ ... })` signature (what params, what returns)
- `getPresignedUrl(fileId)` signature
- Whether the MinIO client is exposed directly or only through file.service primitives

For the avatar service we need:
- A presigned PUT URL pointing to a **temporary** path (e.g. `avatars/incoming/{user_id}/{nonce}.bin`)
- After upload, a commit step that downloads from temp, validates, resizes, re-uploads to a stable path, writes a `file_attachments` row, updates `users.avatar_file_id`, soft-deletes the prior avatar's file_attachment row
- A get step that returns a presigned GET URL (15-min TTL) for a user's current avatar

If `file.service.js` doesn't expose the raw MinIO client, you may need to require `backend/src/config/minio.js` directly.

- [ ] **Step 3.3.3 — Write failing test**

```js
'use strict';
const { pool } = require('../helpers/db');
const sharp = require('sharp');
const svc = require('../../src/services/avatar.service');
const { getMinio } = require('../../src/config/minio');

let userId;
const FIXTURE_EMAIL = 'avatar-test@test.local';

async function makePngBuffer(size = 300) {
  return await sharp({
    create: {
      width: size, height: size, channels: 3,
      background: { r: 255, g: 0, b: 0 },
    },
  }).png().toBuffer();
}

beforeAll(async () => {
  const lvl = await pool.query(`
    SELECT rl.id FROM role_levels rl JOIN roles r ON r.id=rl.role_id
     WHERE r.role_key='sales' AND rl.level_rank=1 LIMIT 1`);
  const r = await pool.query(`
    INSERT INTO users (email, password_hash, role, level_id, display_name, account_status)
    VALUES ($1, 'fixture', 'sales', $2, 'Avatar Fixture', 'active')
    ON CONFLICT (email) DO UPDATE SET level_id = EXCLUDED.level_id
    RETURNING id`,
    [FIXTURE_EMAIL, lvl.rows[0]?.id]);
  userId = r.rows[0].id;
});

afterAll(async () => {
  await pool.query(`DELETE FROM users WHERE email=$1`, [FIXTURE_EMAIL]);
});

describe('avatar.service', () => {
  it('presignUpload returns a PUT URL with a temp object key', async () => {
    if (!userId) return;
    const r = await svc.presignUpload({ userId });
    expect(r.uploadUrl).toMatch(/^https?:\/\/.+/);
    expect(r.objectKey).toMatch(/^avatars\/incoming\/[0-9a-f-]+\/.+\.(bin|png|jpe?g|webp)$/i);
  });

  it('commit validates, resizes to 256x256 webp, writes file_attachments + updates user', async () => {
    if (!userId) return;
    // Upload a fixture PNG directly to the temp key first
    const tempKey = `avatars/incoming/${userId}/test-${Date.now()}.bin`;
    const minio = getMinio();
    const png = await makePngBuffer(400);
    await minio.putObject(process.env.MINIO_BUCKET || 'interlab-files', tempKey, png);

    const r = await svc.commit({ userId, rawObjectKey: tempKey });
    expect(r.fileId).toBeDefined();
    expect(r.objectKey).toMatch(/^avatars\/users\/[0-9a-f-]+\/.+\.webp$/i);

    // user row updated
    const u = await pool.query(`SELECT avatar_file_id, avatar_updated_at FROM users WHERE id=$1`, [userId]);
    expect(u.rows[0].avatar_file_id).toBe(r.fileId);
    expect(u.rows[0].avatar_updated_at).not.toBeNull();

    // file_attachments row written
    const fa = await pool.query(`SELECT mime_type, related_module, related_entity_id FROM file_attachments WHERE id=$1`, [r.fileId]);
    expect(fa.rows[0].mime_type).toBe('image/webp');
    expect(fa.rows[0].related_module).toBe('users');
    expect(fa.rows[0].related_entity_id).toBe(userId);
  });

  it('replacing avatar soft-deletes the previous file_attachment', async () => {
    if (!userId) return;
    const before = await pool.query(`SELECT avatar_file_id FROM users WHERE id=$1`, [userId]);
    const previousFileId = before.rows[0].avatar_file_id;

    const tempKey = `avatars/incoming/${userId}/test-replace-${Date.now()}.bin`;
    const minio = getMinio();
    const png = await makePngBuffer(400);
    await minio.putObject(process.env.MINIO_BUCKET || 'interlab-files', tempKey, png);

    const r = await svc.commit({ userId, rawObjectKey: tempKey });
    expect(r.fileId).not.toBe(previousFileId);

    const old = await pool.query(`SELECT deleted_at FROM file_attachments WHERE id=$1`, [previousFileId]);
    expect(old.rows[0].deleted_at).not.toBeNull();
  });

  it('commit rejects non-image bytes', async () => {
    if (!userId) return;
    const tempKey = `avatars/incoming/${userId}/bad-${Date.now()}.bin`;
    const minio = getMinio();
    await minio.putObject(process.env.MINIO_BUCKET || 'interlab-files', tempKey, Buffer.from('not an image'));
    await expect(svc.commit({ userId, rawObjectKey: tempKey })).rejects.toThrow(/image|unsupported/i);
  });

  it('presignGet returns a URL for current avatar; falls back to defaults when none', async () => {
    if (!userId) return;
    const r = await svc.presignGet({ userId });
    expect(r.url).toMatch(/^https?:\/\/.+/);

    // Clear the avatar and re-call — should fall back to default
    await pool.query(`UPDATE users SET avatar_file_id=NULL, avatar_updated_at=NULL WHERE id=$1`, [userId]);
    const fb = await svc.presignGet({ userId });
    expect(fb.url).toMatch(/^https?:\/\/.+/);
    expect(fb.fallback).toBe(true);
  });
});
```

(NOTE: the `MINIO_BUCKET` env var name may differ — read `backend/src/config/env.js` and `backend/src/config/minio.js` to find the actual name. Common aliases per CLAUDE.md: `S3_BUCKET`, `MINIO_BUCKET_NAME`. Use whatever the config exports as `env.minio.bucket` or similar.)

- [ ] **Step 3.3.4 — Implement**

```js
'use strict';
const sharp = require('sharp');
const crypto = require('node:crypto');
const path = require('node:path');
const db = require('../config/database');
const env = require('../config/env');
const { getMinio } = require('../config/minio');
const { validateImageBuffer } = require('../utils/image_validator');
const { ValidationError } = require('../utils/errors');

const BUCKET = env.minio.bucket;
const PRESIGN_PUT_TTL = 5 * 60;   // 5 min for upload
const PRESIGN_GET_TTL = 15 * 60;  // 15 min for read

async function presignUpload({ userId }) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const objectKey = `avatars/incoming/${userId}/${nonce}.bin`;
  const minio = getMinio();
  const uploadUrl = await new Promise((resolve, reject) => {
    minio.presignedPutObject(BUCKET, objectKey, PRESIGN_PUT_TTL, (err, url) => {
      if (err) reject(err); else resolve(url);
    });
  });
  return { uploadUrl, objectKey, expiresIn: PRESIGN_PUT_TTL };
}

async function downloadFromMinio(objectKey) {
  const minio = getMinio();
  const stream = await minio.getObject(BUCKET, objectKey);
  const chunks = [];
  for await (const c of stream) chunks.push(c);
  return Buffer.concat(chunks);
}

async function commit({ userId, rawObjectKey }) {
  // Sanity: the rawObjectKey MUST be in the user's incoming path. Prevents
  // a malicious client passing someone else's key.
  if (!rawObjectKey.startsWith(`avatars/incoming/${userId}/`)) {
    throw new ValidationError('invalid object key');
  }

  const raw = await downloadFromMinio(rawObjectKey);
  const v = await validateImageBuffer(raw);
  if (!v.ok) throw new ValidationError(v.reason);

  // Sharp pipeline: rotate (honor EXIF), resize, strip EXIF, output webp.
  const main = await sharp(raw).rotate().resize(256, 256, { fit: 'cover' }).webp({ quality: 86 }).toBuffer();
  const thumb = await sharp(raw).rotate().resize(64, 64, { fit: 'cover' }).webp({ quality: 80 }).toBuffer();

  const minio = getMinio();
  const fileId = crypto.randomUUID();
  const stableKey = `avatars/users/${userId}/${fileId}.webp`;
  const thumbKey  = `avatars/users/${userId}/${fileId}-thumb.webp`;
  await new Promise((resolve, reject) => {
    minio.putObject(BUCKET, stableKey, main, main.length, { 'Content-Type': 'image/webp' }, (err) => err ? reject(err) : resolve());
  });
  await new Promise((resolve, reject) => {
    minio.putObject(BUCKET, thumbKey, thumb, thumb.length, { 'Content-Type': 'image/webp' }, (err) => err ? reject(err) : resolve());
  });

  // Soft-delete prior avatar file_attachment + record new one + update user.
  const client = await db.pool.connect();
  try {
    await client.query('BEGIN');

    const prior = await client.query(`SELECT avatar_file_id FROM users WHERE id=$1`, [userId]);
    const priorFileId = prior.rows[0]?.avatar_file_id;

    const ins = await client.query(`
      INSERT INTO file_attachments
        (id, original_filename, mime_type, extension, uploaded_by,
         related_module, related_entity_id, storage_bucket, storage_path, size_bytes)
      VALUES ($1, $2, 'image/webp', 'webp', $3, 'users', $3, $4, $5, $6)
      RETURNING id`,
      [fileId, `avatar-${fileId}.webp`, userId, BUCKET, stableKey, main.length]);

    await client.query(`
      UPDATE users SET avatar_file_id=$2, avatar_updated_at=now(), updated_at=now() WHERE id=$1`,
      [userId, ins.rows[0].id]);

    if (priorFileId) {
      await client.query(`UPDATE file_attachments SET deleted_at = now() WHERE id=$1`, [priorFileId]);
    }

    await client.query('COMMIT');

    // Best-effort: remove the temp object after successful commit.
    minio.removeObject(BUCKET, rawObjectKey).catch(() => {});

    return { fileId: ins.rows[0].id, objectKey: stableKey, thumbKey };
  } catch (e) {
    await client.query('ROLLBACK').catch(() => {});
    throw e;
  } finally {
    client.release();
  }
}

async function presignGet({ userId }) {
  const r = await db.query(`
    SELECT u.avatar_file_id, u.role, fa.storage_path
      FROM users u
      LEFT JOIN file_attachments fa ON fa.id = u.avatar_file_id AND fa.deleted_at IS NULL
     WHERE u.id = $1`, [userId]);
  const row = r.rows[0];
  const minio = getMinio();
  if (row?.storage_path) {
    const url = await new Promise((resolve, reject) => {
      minio.presignedGetObject(BUCKET, row.storage_path, PRESIGN_GET_TTL, (err, u) => err ? reject(err) : resolve(u));
    });
    return { url, fallback: false, expiresIn: PRESIGN_GET_TTL };
  }
  // Fallback to per-role default.
  const defaultKey = `avatars/defaults/${row?.role || 'unknown'}.png`;
  const url = await new Promise((resolve, reject) => {
    minio.presignedGetObject(BUCKET, defaultKey, PRESIGN_GET_TTL, (err, u) => err ? reject(err) : resolve(u));
  });
  return { url, fallback: true, expiresIn: PRESIGN_GET_TTL };
}

module.exports = { presignUpload, commit, presignGet };
```

- [ ] **Step 3.3.5 — Run + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npx vitest run test/services/avatar.service.test.js 2>&1 | tail -20
```

Expected: 5/5 pass. (If tests skip MinIO due to credentials, the env vars must be loaded — confirm `MINIO_*` vars in `.env`.)

```bash
git add backend/package.json backend/package-lock.json backend/src/services/avatar.service.js backend/test/services/avatar.service.test.js
git commit -m "feat(avatar): presign + commit + get with sharp resize pipeline

Two-step upload: client gets a 5-min presigned PUT URL to avatars/incoming/
{user_id}/{nonce}.bin, then commits which downloads, validates (magic byte
mime sniff), resizes to 256x256 webp + 64x64 thumb, EXIF-stripped via
sharp.rotate(), uploads to stable avatars/users/{user_id}/{fileId}.webp,
records file_attachments row, swaps users.avatar_file_id atomically, soft-
deletes prior avatar.

presignGet returns a 15-min URL for the current avatar OR falls back to
avatars/defaults/{role}.png.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.4 — Routes: `/api/users/me/avatar/*`

**Files:**
- Create: `backend/src/routes/users/me-avatar.routes.js`
- Modify: `backend/src/app.js`

- [ ] **Step 3.4.1 — Implement routes**

```js
'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const Joi = require('joi');
const { validate } = require('../../middleware/validator.middleware');
const svc = require('../../services/avatar.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

// POST /api/users/me/avatar/presign
//   returns { uploadUrl, objectKey, expiresIn }
router.post('/presign', async (req, res, next) => {
  try {
    const r = await svc.presignUpload({ userId: req.user.id });
    res.json(success(r));
  } catch (e) { next(e); }
});

// POST /api/users/me/avatar/commit
//   body: { rawObjectKey }
//   returns { fileId, objectKey, thumbKey }
router.post('/commit',
  validate({ body: Joi.object({ rawObjectKey: Joi.string().min(10).max(500).required() }) }),
  async (req, res, next) => {
    try {
      const r = await svc.commit({ userId: req.user.id, rawObjectKey: req.body.rawObjectKey });
      res.json(success(r));
    } catch (e) { next(e); }
  });

// GET /api/users/:id/avatar
//   returns { url, fallback, expiresIn }
//   public-ish: any authenticated user can view another user's avatar URL
const idRouter = express.Router();
idRouter.use(authMiddleware);
idRouter.get('/:id/avatar', async (req, res, next) => {
  try {
    const r = await svc.presignGet({ userId: req.params.id });
    res.json(success(r));
  } catch (e) { next(e); }
});

module.exports = { router, idRouter };
```

- [ ] **Step 3.4.2 — Mount in app.js**

```js
const avatarRoutes = require('./routes/users/me-avatar.routes');
app.use('/api/users/me/avatar', avatarRoutes.router);
app.use('/api/users', avatarRoutes.idRouter);
```

(Pick the right place near other route mounts.)

- [ ] **Step 3.4.3 — Run full suite + commit**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

Expected: full suite still passes.

```bash
git add backend/src/routes/users/me-avatar.routes.js backend/src/app.js
git commit -m "feat(avatar): /api/users/me/avatar/{presign,commit} + /api/users/:id/avatar

Presign returns a 5-min PUT URL. Commit validates+resizes+swaps atomically.
Get returns a 15-min presigned URL or fallback to per-role default.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.5 — Frontend AvatarUploader component + lib

**Files:**
- Create: `frontend/lib/avatar-api.ts`
- Create: `frontend/components/avatar/AvatarUploader.tsx`
- Create: `frontend/components/avatar/AvatarDisplay.tsx`

- [ ] **Step 3.5.1 — `lib/avatar-api.ts`**

```ts
import { api } from './api';

export interface AvatarPresign {
  uploadUrl: string;
  objectKey: string;
  expiresIn: number;
}

export interface AvatarCommitResult {
  fileId: string;
  objectKey: string;
  thumbKey: string;
}

export interface AvatarGetResult {
  url: string;
  fallback: boolean;
  expiresIn: number;
}

export const avatarApi = {
  presign: () =>
    api.post<{ data: AvatarPresign }>('/api/users/me/avatar/presign', {}).then(r => r.data.data),
  commit: (rawObjectKey: string) =>
    api.post<{ data: AvatarCommitResult }>('/api/users/me/avatar/commit', { rawObjectKey }).then(r => r.data.data),
  get: (userId: string) =>
    api.get<{ data: AvatarGetResult }>(`/api/users/${userId}/avatar`).then(r => r.data.data),
};
```

- [ ] **Step 3.5.2 — `components/avatar/AvatarUploader.tsx`**

```tsx
'use client';
import { useState, useRef } from 'react';
import { avatarApi } from '@/lib/avatar-api';
import axios from 'axios';
import { toast } from 'sonner';

interface Props {
  onUploaded?: () => void;
  className?: string;
}

const ACCEPT = 'image/png,image/jpeg,image/webp';
const MAX_SIZE = 5 * 1024 * 1024;

export function AvatarUploader({ onUploaded, className }: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState(false);

  async function handleFile(file: File) {
    if (!ACCEPT.split(',').includes(file.type)) {
      toast.error('Only PNG, JPEG, or WebP images are allowed');
      return;
    }
    if (file.size > MAX_SIZE) {
      toast.error(`File too large (max ${Math.round(MAX_SIZE/1024/1024)}MB)`);
      return;
    }
    setUploading(true);
    try {
      // 1. Get presigned PUT URL
      const presign = await avatarApi.presign();
      // 2. Upload directly to MinIO
      await axios.put(presign.uploadUrl, file, { headers: { 'Content-Type': file.type } });
      // 3. Commit
      await avatarApi.commit(presign.objectKey);
      toast.success('Avatar updated');
      onUploaded?.();
    } catch (e: any) {
      toast.error(`Upload failed: ${e?.response?.data?.error || e?.message || 'unknown'}`);
    } finally {
      setUploading(false);
      if (inputRef.current) inputRef.current.value = '';
    }
  }

  function onChange(e: React.ChangeEvent<HTMLInputElement>) {
    const file = e.target.files?.[0];
    if (file) handleFile(file);
  }

  return (
    <div className={className}>
      <input ref={inputRef} type="file" accept={ACCEPT} onChange={onChange} className="hidden" />
      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        disabled={uploading}
        className="bg-blue-600 text-white px-3 py-1 rounded disabled:opacity-50"
      >
        {uploading ? 'Uploading...' : 'Change avatar'}
      </button>
    </div>
  );
}
```

- [ ] **Step 3.5.3 — `components/avatar/AvatarDisplay.tsx`**

```tsx
'use client';
import { useEffect, useState } from 'react';
import { avatarApi } from '@/lib/avatar-api';

interface Props {
  userId: string;
  size?: number; // px
  className?: string;
  refreshKey?: number; // bump to force re-fetch after upload
}

export function AvatarDisplay({ userId, size = 40, className = '', refreshKey = 0 }: Props) {
  const [url, setUrl] = useState<string | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    let cancelled = false;
    setError(false);
    avatarApi.get(userId).then(r => {
      if (!cancelled) setUrl(r.url);
    }).catch(() => {
      if (!cancelled) setError(true);
    });
    return () => { cancelled = true; };
  }, [userId, refreshKey]);

  if (error || !url) {
    return (
      <div
        className={`rounded-full bg-gray-300 ${className}`}
        style={{ width: size, height: size }}
      />
    );
  }
  return (
    <img
      src={url}
      alt="avatar"
      className={`rounded-full object-cover ${className}`}
      style={{ width: size, height: size }}
    />
  );
}
```

- [ ] **Step 3.5.4 — Type-check + commit**

```bash
docker run --rm \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

Expected: no NEW errors.

```bash
git add frontend/lib/avatar-api.ts frontend/components/avatar/
git commit -m "feat(frontend): AvatarUploader + AvatarDisplay components + avatar-api lib

Two-step client upload: POST /presign → PUT direct to MinIO → POST /commit.
Display fetches presigned URL on mount, falls back to gray circle on error.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 3.6 — Wire into Topbar + profile page

**Files:**
- Modify: existing topbar/header component (location varies; search for it)
- Modify or Create: profile page

- [ ] **Step 3.6.1 — Locate the existing avatar display**

```bash
grep -rn "avatar_url\|avatar_file_id\|<Avatar\|user\.avatar" frontend/components/ frontend/app/ frontend/lib/ 2>/dev/null | head -20
```

Identify where the user's avatar currently renders (likely in a topbar or sidebar component). Note the user object source (`useAuthStore`, prop, etc.).

- [ ] **Step 3.6.2 — Replace existing display with `<AvatarDisplay/>`**

Wherever the current rendering is, replace with:

```tsx
import { AvatarDisplay } from '@/components/avatar/AvatarDisplay';
// ...
<AvatarDisplay userId={user.id} size={36} className="border" />
```

If the existing code renders `<img src={user.avatar_url}/>`, replace with the component above.

- [ ] **Step 3.6.3 — Profile page upload section**

Find or create `frontend/app/(app)/profile/page.tsx`. Add a section:

```tsx
'use client';
import { useState } from 'react';
import { useAuthStore } from '@/stores/auth.store';
import { AvatarDisplay } from '@/components/avatar/AvatarDisplay';
import { AvatarUploader } from '@/components/avatar/AvatarUploader';

export default function ProfilePage() {
  const user = useAuthStore(s => s.user);
  const [refreshKey, setRefreshKey] = useState(0);

  if (!user) return null;

  return (
    <div className="p-6 max-w-2xl">
      <h1 className="text-2xl font-semibold mb-4">Profile</h1>
      <section className="space-y-4">
        <div className="flex items-center gap-4">
          <AvatarDisplay userId={user.id} size={96} className="border-2 border-gray-200" refreshKey={refreshKey} />
          <div>
            <div className="font-medium">{user.display_name}</div>
            <div className="text-sm text-gray-500">{user.email}</div>
            <div className="text-sm text-gray-500">{user.role}</div>
          </div>
        </div>
        <AvatarUploader onUploaded={() => setRefreshKey(k => k + 1)} />
      </section>
    </div>
  );
}
```

(If the user store path is `@/stores/auth.store` — verify via the existing imports. May be `useAuthStore` or `useUser` somewhere else.)

- [ ] **Step 3.6.4 — Type-check + commit**

```bash
docker run --rm \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

```bash
git add frontend/
git commit -m "feat(frontend): topbar + profile page integrate AvatarDisplay/Uploader

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Final integration check

- [ ] **F.1 — Run full backend suite**

```bash
docker run --rm --network interlab-data-net \
  -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
  -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
  -w /work/backend node:20 npm test 2>&1 | tail -10
```

Expected: all prior + 14 new (2 migration + 7 validator + 5 avatar service) tests pass.

- [ ] **F.2 — Frontend type-check**

```bash
docker run --rm -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work -w /work/frontend node:20 npx tsc --noEmit 2>&1 | tail -10
```

Expected: no new errors.

- [ ] **F.3 — Manual smoke (recommended before merge)**

1. Start frontend dev server (`npm run dev` in `frontend/`).
2. Login as any user.
3. Navigate to `/profile`.
4. Click "Change avatar", select a JPEG/PNG.
5. Verify the avatar updates in profile + topbar.
6. Try uploading an SVG → toast error.
7. Try uploading a 6 MB file → toast error or 400 from server.

---

## Self-review

- ✅ **Spec coverage**: F3 acceptance criteria all addressed
  - Presigned URL upload (Task 3.3)
  - 256×256 webp + 64×64 thumb (Task 3.3 sharp pipeline)
  - SVG rejected, mime whitelist (Task 3.2)
  - 5MB cap (Task 3.2)
  - EXIF strip via `sharp.rotate()` (Task 3.3)
  - Old avatar soft-deleted (Task 3.3)
  - Default fallback per role (Task 3.3 `presignGet`)
  - Stable storage path `avatars/users/{user_id}/{hash}.webp` (Task 3.3)
- ✅ **No placeholders within steps**: every step has concrete code or commands
- ✅ **Type/method consistency**: `presignUpload`/`commit`/`presignGet` consistent across service tests, routes, and frontend api
- ✅ **Plan 1 dependencies**: uses `db.pool.connect()`, `success()` wrapper, `authMiddleware`, `validate({...})` helper, all consistent with previous plans

---

## Execution handoff

**Plan complete and saved to `docs/superpowers/plans/2026-05-02-plan3-avatar-upload.md`.**

Two execution options:

**1. Subagent-Driven (recommended)** — fresh subagent per task with two-stage review. ~6 task dispatches.

**2. Inline Execution** — execute via `superpowers:executing-plans`, batch with checkpoints.

**Which approach?**
