'use strict';
// seed_default_avatars.js
//
// Uploads the per-role default avatar PNGs from the assets directory into
// MinIO at `avatars/defaults/{role}.png`. Idempotent: existing objects are
// overwritten (safe — content is deterministic).
//
// Usage:
//   node scripts/seed_default_avatars.js
//
// The script reads MinIO connection details from the repo-root .env via the
// same env.js module used by the API. Run it once on a fresh deploy (after
// `migrate.js` and `seed.js`) to populate the default avatar objects.
//
// Docker usage (if running outside the backend container):
//   docker run --rm \
//     --network interlab-data-net \
//     -v /opt/projects/interlabs-crm-demo/.worktrees/plan1-foundation-f2:/work \
//     -v /opt/projects/interlabs-crm-demo/.env:/work/.env:ro \
//     -v /opt/projects/interlabs-crm-demo/interlabs-crm-demo/pictures/interlab_role_avatar_generation:/avatars:ro \
//     -w /work/backend \
//     node:20 node scripts/seed_default_avatars.js

const path = require('path');
const fs = require('fs');

// Load env before requiring minio config (env.js resolves .env relative to
// backend/src/config, so requiring it from scripts/ still works because it
// uses an absolute __dirname-based path internally).
const env = require('../src/config/env');
const { getClient, bucketAvatars } = require('../src/config/minio');

// ---------------------------------------------------------------------------
// Role → filename mapping
// ---------------------------------------------------------------------------
//
// Source filenames:  avatar_{roleNoUnderscore}_A.png
// Target objects:    avatars/defaults/{role_key}.png
//
// The _A variant is the canonical default (one per role). _B variants exist
// but are not uploaded here; they can be offered as alternate choices later.

const ROLES = [
    'superadmin',
    'ceo',
    'sales',
    'admin_log',
    'finance',
    'technical',
    'hrga',
    'tax_insurance',
];

// Map role_key → source filename prefix (strip underscores).
function roleToFilePrefix(roleKey) {
    return roleKey.replace(/_/g, '');
}

// ---------------------------------------------------------------------------
// Avatar source directory
//
// Primary: /avatars (Docker volume mount, read-only)
// Fallback: relative path from this script (for local dev without Docker)
// ---------------------------------------------------------------------------

const AVATAR_DIR_CANDIDATES = [
    '/avatars',
    path.resolve(__dirname, '../../../../interlabs-crm-demo/pictures/interlab_role_avatar_generation'),
];

function findAvatarDir() {
    for (const candidate of AVATAR_DIR_CANDIDATES) {
        if (fs.existsSync(candidate)) {
            const files = fs.readdirSync(candidate);
            if (files.some((f) => f.startsWith('avatar_'))) return candidate;
        }
    }
    return null;
}

// ---------------------------------------------------------------------------
// Main
// ---------------------------------------------------------------------------

async function run() {
    const avatarDir = findAvatarDir();
    if (!avatarDir) {
        console.error(
            '[seed_default_avatars] ERROR: Could not find avatar source directory.\n' +
            'Searched:\n' +
            AVATAR_DIR_CANDIDATES.map((d) => `  ${d}`).join('\n') + '\n' +
            'Mount the pictures directory or adjust AVATAR_DIR_CANDIDATES.',
        );
        process.exit(1);
    }
    console.log(`[seed_default_avatars] Reading avatars from: ${avatarDir}`);

    const client = getClient();
    const bucket = bucketAvatars;

    // Ensure the avatars bucket exists; create it if not (idempotent).
    const bucketExists = await client.bucketExists(bucket);
    if (!bucketExists) {
        await client.makeBucket(bucket, 'us-east-1');
        console.log(`[seed_default_avatars] Created bucket: ${bucket}`);
    }

    let uploaded = 0;
    let skipped = 0;

    for (const roleKey of ROLES) {
        const filePrefix = roleToFilePrefix(roleKey);
        const sourceFilename = `avatar_${filePrefix}_A.png`;
        const sourcePath = path.join(avatarDir, sourceFilename);

        if (!fs.existsSync(sourcePath)) {
            console.warn(`[seed_default_avatars] WARN: source file not found — ${sourcePath} (skipping)`);
            skipped++;
            continue;
        }

        const objectKey = `avatars/defaults/${roleKey}.png`;
        const fileBuffer = fs.readFileSync(sourcePath);
        const fileSize = fileBuffer.length;

        await client.putObject(bucket, objectKey, fileBuffer, fileSize, {
            'Content-Type': 'image/png',
        });
        console.log(`[seed_default_avatars] Uploaded ${sourceFilename} → ${bucket}/${objectKey} (${fileSize} bytes)`);
        uploaded++;
    }

    console.log(
        `[seed_default_avatars] Done. ${uploaded} uploaded, ${skipped} skipped.`,
    );
    process.exit(0);
}

run().catch((err) => {
    console.error('[seed_default_avatars] Fatal error:', err && err.message ? err.message : err);
    process.exit(1);
});
