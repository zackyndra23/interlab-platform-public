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
