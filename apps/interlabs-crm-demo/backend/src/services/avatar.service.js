'use strict';
const sharp = require('sharp');
const crypto = require('node:crypto');
const db = require('../config/database');
const env = require('../config/env');
const { getClient, getPublicClient } = require('../config/minio');
const { validateImageBuffer } = require('../utils/image_validator');
const { ValidationError } = require('../utils/errors');

const BUCKET = env.minio.bucketAvatars;
const PRESIGN_PUT_TTL = 5 * 60;   // 5 min for upload
const PRESIGN_GET_TTL = 15 * 60;  // 15 min for read

async function presignUpload({ userId }) {
  const nonce = crypto.randomBytes(8).toString('hex');
  const objectKey = `avatars/incoming/${userId}/${nonce}.bin`;
  // Use the public client for presigned URLs so the URL is dialable from the browser.
  const minio = getPublicClient();
  const uploadUrl = await minio.presignedPutObject(BUCKET, objectKey, PRESIGN_PUT_TTL);
  return { uploadUrl, objectKey, expiresIn: PRESIGN_PUT_TTL };
}

async function downloadFromMinio(objectKey) {
  const minio = getClient();
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

  const minio = getClient();
  const fileId = crypto.randomUUID();
  const stableKey = `avatars/users/${userId}/${fileId}.webp`;
  const thumbKey  = `avatars/users/${userId}/${fileId}-thumb.webp`;

  await minio.putObject(BUCKET, stableKey, main, main.length, { 'Content-Type': 'image/webp' });
  await minio.putObject(BUCKET, thumbKey, thumb, thumb.length, { 'Content-Type': 'image/webp' });

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
  // Use the public client so the returned URL is dialable from the browser.
  const minio = getPublicClient();
  if (row?.storage_path) {
    const url = await minio.presignedGetObject(BUCKET, row.storage_path, PRESIGN_GET_TTL);
    return { url, fallback: false, expiresIn: PRESIGN_GET_TTL };
  }
  // Fallback to per-role default.
  const defaultKey = `avatars/defaults/${row?.role || 'unknown'}.png`;
  const url = await minio.presignedGetObject(BUCKET, defaultKey, PRESIGN_GET_TTL);
  return { url, fallback: true, expiresIn: PRESIGN_GET_TTL };
}

module.exports = { presignUpload, commit, presignGet };
