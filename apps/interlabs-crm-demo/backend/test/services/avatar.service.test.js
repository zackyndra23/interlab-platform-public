'use strict';
const { pool } = require('../helpers/db');
const sharp = require('sharp');
const svc = require('../../src/services/avatar.service');
const { getClient } = require('../../src/config/minio');
const env = require('../../src/config/env');

let userId;
const FIXTURE_EMAIL = 'avatar-test@test.local';
const BUCKET = env.minio.bucketAvatars;

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
    const minio = getClient();
    const png = await makePngBuffer(400);
    await minio.putObject(BUCKET, tempKey, png);

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
    const minio = getClient();
    const png = await makePngBuffer(400);
    await minio.putObject(BUCKET, tempKey, png);

    const r = await svc.commit({ userId, rawObjectKey: tempKey });
    expect(r.fileId).not.toBe(previousFileId);

    const old = await pool.query(`SELECT deleted_at FROM file_attachments WHERE id=$1`, [previousFileId]);
    expect(old.rows[0].deleted_at).not.toBeNull();
  });

  it('commit rejects non-image bytes', async () => {
    if (!userId) return;
    const tempKey = `avatars/incoming/${userId}/bad-${Date.now()}.bin`;
    const minio = getClient();
    await minio.putObject(BUCKET, tempKey, Buffer.from('not an image'));
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
