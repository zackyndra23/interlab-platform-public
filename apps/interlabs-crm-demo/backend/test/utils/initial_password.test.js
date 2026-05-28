'use strict';
const { generatePassphrase, hashPassword, verifyPassword } = require('../../src/utils/initial_password');

describe('initial_password', () => {
  it('generatePassphrase produces 4 hyphenated words from a curated wordlist', () => {
    const p = generatePassphrase();
    const parts = p.split('-');
    expect(parts.length).toBe(4);
    parts.forEach(w => {
      expect(w).toMatch(/^[a-z]+$/);
      expect(w.length).toBeGreaterThanOrEqual(3);
    });
  });

  it('hashPassword returns argon2id hash that verifies', async () => {
    const pw = 'hello-world-foo-bar';
    const h = await hashPassword(pw);
    expect(h).toMatch(/^\$argon2id\$/);
    expect(await verifyPassword(h, pw)).toBe(true);
    expect(await verifyPassword(h, 'wrong')).toBe(false);
  });

  it('hashPassword for the same input produces different hashes (salted)', async () => {
    const a = await hashPassword('same-input');
    const b = await hashPassword('same-input');
    expect(a).not.toBe(b);
    // Both verify
    const { verifyPassword: v } = require('../../src/utils/initial_password');
    expect(await v(a, 'same-input')).toBe(true);
    expect(await v(b, 'same-input')).toBe(true);
  });
});
