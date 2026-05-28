'use strict';
const crypto = require('node:crypto');
const env = require('../config/env');

const ALGO = 'aes-256-gcm';
const IV_LEN = 12;
const TAG_LEN = 16;

function getKey() {
    const hex = env.twoFactor?.encryptionKey;
    // Accept keys that are at least 64 hex chars (32 bytes). Longer keys are
    // accepted and truncated to the first 64 hex chars so that production .env
    // files generated with more entropy continue to work unchanged.
    if (!hex || hex.length < 64 || hex.length % 2 !== 0) {
        throw new Error('TWO_FACTOR_ENCRYPTION_KEY must be 64 hex chars (32 bytes)');
    }
    return Buffer.from(hex.slice(0, 64), 'hex');
}

/** Returns base64-encoded ciphertext: iv (12) || authTag (16) || ciphertext */
function encrypt(plaintext) {
    if (typeof plaintext !== 'string') throw new Error('plaintext must be string');
    const iv = crypto.randomBytes(IV_LEN);
    const cipher = crypto.createCipheriv(ALGO, getKey(), iv);
    const ct = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()]);
    const tag = cipher.getAuthTag();
    return Buffer.concat([iv, tag, ct]).toString('base64');
}

/** Reverse of encrypt(). Throws on tag mismatch (tampering). */
function decrypt(b64) {
    const buf = Buffer.from(b64, 'base64');
    if (buf.length < IV_LEN + TAG_LEN) throw new Error('ciphertext too short');
    const iv = buf.subarray(0, IV_LEN);
    const tag = buf.subarray(IV_LEN, IV_LEN + TAG_LEN);
    const ct = buf.subarray(IV_LEN + TAG_LEN);
    const decipher = crypto.createDecipheriv(ALGO, getKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(ct), decipher.final()]).toString('utf8');
}

module.exports = { encrypt, decrypt };
