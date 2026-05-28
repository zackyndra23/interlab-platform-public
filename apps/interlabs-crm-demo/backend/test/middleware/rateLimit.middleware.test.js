'use strict';
const rl = require('../../src/middleware/rateLimit.middleware');

describe('rateLimit middleware', () => {
    it('exports permissionWriteLimiter', () => {
        expect(rl.permissionWriteLimiter).toBeDefined();
        expect(typeof rl.permissionWriteLimiter).toBe('function');
    });

    it('exports loginRateLimiter', () => {
        expect(rl.loginRateLimiter).toBeDefined();
        expect(typeof rl.loginRateLimiter).toBe('function');
    });

    it('exports activateRateLimiter (5/min/IP for token enumeration protection)', () => {
        expect(rl.activateRateLimiter).toBeDefined();
        expect(typeof rl.activateRateLimiter).toBe('function');
    });

    it('exports invitationCreateLimiter (10/h/inviter)', () => {
        expect(rl.invitationCreateLimiter).toBeDefined();
        expect(typeof rl.invitationCreateLimiter).toBe('function');
    });
});
