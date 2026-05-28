'use strict';
// twofactor_crypto.test.js
// Unit tests for AES-256-GCM encrypt/decrypt utility.
// No network/DB calls — fully pure.

// Set the encryption key in the env module before the service loads.
// env.js is already cached by setup.js, so we mutate the cached object directly.
const env = require('../../src/config/env');
// Use the key already loaded from .env (if present), or fall back to a
// 64-hex-char test key.  This lets the suite run without TWO_FACTOR_ENCRYPTION_KEY
// in CI and also exercises the production key length tolerance.
const ORIGINAL_KEY = env.twoFactor?.encryptionKey ?? '';
const TEST_KEY = ORIGINAL_KEY.length >= 64 ? ORIGINAL_KEY : 'a'.repeat(64);

beforeAll(() => {
    if (!env.twoFactor) env.twoFactor = {};
    env.twoFactor.encryptionKey = TEST_KEY;
});

afterAll(() => {
    env.twoFactor.encryptionKey = ORIGINAL_KEY;
});

const { encrypt, decrypt } = require('../../src/utils/twofactor_crypto');

describe('twofactor_crypto', () => {
    describe('encrypt / decrypt round-trip', () => {
        it('decrypts back to the original plaintext', () => {
            const original = 'JBSWY3DPEHPK3PXP';  // typical TOTP base32 secret
            const ciphertext = encrypt(original);
            expect(decrypt(ciphertext)).toBe(original);
        });

        it('produces different ciphertext each call (random IV)', () => {
            const plain = 'same-secret';
            const c1 = encrypt(plain);
            const c2 = encrypt(plain);
            expect(c1).not.toBe(c2);
        });

        it('round-trips a long string', () => {
            const long = 'x'.repeat(500);
            expect(decrypt(encrypt(long))).toBe(long);
        });

        it('round-trips an empty string', () => {
            expect(decrypt(encrypt(''))).toBe('');
        });

        it('round-trips a string with special characters', () => {
            const special = 'abc\n\t"\'<>&';
            expect(decrypt(encrypt(special))).toBe(special);
        });
    });

    describe('tamper detection', () => {
        it('throws on a bit-flipped ciphertext (GCM auth-tag mismatch)', () => {
            const ciphertext = encrypt('hello');
            const buf = Buffer.from(ciphertext, 'base64');
            // Flip a byte in the ciphertext region (past IV + tag = first 28 bytes).
            buf[28] ^= 0xff;
            const tampered = buf.toString('base64');
            expect(() => decrypt(tampered)).toThrow();
        });

        it('throws when ciphertext is too short', () => {
            // Fewer than IV(12) + TAG(16) = 28 bytes.
            const short = Buffer.alloc(20).toString('base64');
            expect(() => decrypt(short)).toThrow('ciphertext too short');
        });
    });

    describe('key validation', () => {
        it('throws when key is shorter than 64 hex chars', () => {
            const saved = env.twoFactor.encryptionKey;
            env.twoFactor.encryptionKey = 'aa'.repeat(31); // 62 chars — just short
            try {
                expect(() => encrypt('test')).toThrow('TWO_FACTOR_ENCRYPTION_KEY must be 64 hex chars');
            } finally {
                env.twoFactor.encryptionKey = saved;
            }
        });

        it('accepts keys longer than 64 hex chars (e.g. 128 chars)', () => {
            // Production may have generated a 128-char key; it must still work.
            const saved = env.twoFactor.encryptionKey;
            env.twoFactor.encryptionKey = 'ab'.repeat(64); // 128 hex chars
            try {
                const c = encrypt('test');
                expect(decrypt(c)).toBe('test');
            } finally {
                env.twoFactor.encryptionKey = saved;
            }
        });

        it('throws when key is absent (empty string)', () => {
            const saved = env.twoFactor.encryptionKey;
            env.twoFactor.encryptionKey = '';
            try {
                expect(() => encrypt('test')).toThrow('TWO_FACTOR_ENCRYPTION_KEY must be 64 hex chars');
            } finally {
                env.twoFactor.encryptionKey = saved;
            }
        });

        it('throws when key is null', () => {
            const saved = env.twoFactor.encryptionKey;
            env.twoFactor.encryptionKey = null;
            try {
                expect(() => encrypt('test')).toThrow('TWO_FACTOR_ENCRYPTION_KEY must be 64 hex chars');
            } finally {
                env.twoFactor.encryptionKey = saved;
            }
        });
    });

    describe('encrypt input validation', () => {
        it('throws when plaintext is null', () => {
            expect(() => encrypt(null)).toThrow('plaintext must be string');
        });

        it('throws when plaintext is a number', () => {
            expect(() => encrypt(42)).toThrow('plaintext must be string');
        });
    });
});
