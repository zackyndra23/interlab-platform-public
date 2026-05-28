'use strict';
const { generateToken, hashToken } = require('../../src/utils/invitation_token');

describe('invitation_token', () => {
  it('generateToken returns a 64-char hex string (32 bytes)', () => {
    const t = generateToken();
    expect(typeof t).toBe('string');
    expect(t).toMatch(/^[0-9a-f]{64}$/);
  });

  it('generateToken produces unique tokens each call', () => {
    const a = generateToken();
    const b = generateToken();
    expect(a).not.toBe(b);
  });

  it('hashToken returns deterministic SHA-256 hex', () => {
    const t = 'a'.repeat(64);
    const h1 = hashToken(t);
    const h2 = hashToken(t);
    expect(h1).toBe(h2);
    expect(h1).toMatch(/^[0-9a-f]{64}$/);
  });

  it('hashToken differs for different input', () => {
    expect(hashToken('a')).not.toBe(hashToken('b'));
  });
});
