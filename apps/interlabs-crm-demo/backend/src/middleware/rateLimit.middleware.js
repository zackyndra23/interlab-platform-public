'use strict';

const rateLimit = require('express-rate-limit');

const env = require('../config/env');
const { error: errorEnvelope } = require('../utils/response');

// Login rate limiter — CTX_architecture §SECURITY:
// "rate limit after 5 attempts (per IP + per email)".
//
// Two independent limiters composed into a single middleware so a single
// IP can't brute-force any account AND a single account can't be targeted
// from a botnet of IPs. Either limiter tripping returns 429 with the
// shared error envelope.
//
// Store: in-process memory (`express-rate-limit`'s default
// `MemoryStore`). For a single-VPS demo this is correct; for a
// multi-node deploy swap in `rate-limit-redis` and point it at the
// REDIS_URL already configured in .env. The middleware shape stays the
// same so that migration is a one-line change.
//
// The rate-limit window/max are env-tunable (env.rateLimit.*) so tests
// can dial them down without editing code.

function respond429(req, res) {
    const retryAfterSec = Math.max(
        1, Math.ceil(env.rateLimit.loginWindowMs / 1000 / 10),
    );
    res.set('Retry-After', String(retryAfterSec));
    return res.status(429).json(errorEnvelope(
        'Too many login attempts; please wait and try again',
        'rate_limited',
    ));
}

// Email normaliser must match the one used in auth.service.login so the
// limiter keys line up with the lookup: trim + lowercase, empty if absent.
function normalizeEmail(raw) {
    if (typeof raw !== 'string') return '';
    return raw.trim().toLowerCase();
}

// The actual client IP. Express derives req.ip from the socket by default.
// If the app is deployed behind Traefik and `trust proxy` is enabled at the
// Express level, req.ip reflects the X-Forwarded-For client IP. Here we
// fall back to X-Forwarded-For ourselves for a robust key regardless of
// the trust-proxy setting.
function clientKey(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0].trim();
    }
    return req.ip || 'unknown';
}

const perIpLimiter = rateLimit({
    windowMs: env.rateLimit.loginWindowMs,
    max: env.rateLimit.loginMax,
    standardHeaders: true, // expose RateLimit-* headers per RFC 6585
    legacyHeaders: false,
    keyGenerator: (req) => `login:ip:${clientKey(req)}`,
    handler: respond429,
});

const perEmailLimiter = rateLimit({
    windowMs: env.rateLimit.loginWindowMs,
    max: env.rateLimit.loginMax,
    standardHeaders: true,
    legacyHeaders: false,
    // Skip when email absent — perIpLimiter still enforces.
    skip: (req) => !normalizeEmail(req.body && req.body.email),
    keyGenerator: (req) => `login:email:${normalizeEmail(req.body.email)}`,
    handler: respond429,
});

/**
 * Composite middleware: IP limiter runs first, then email limiter. Order
 * is deliberate — we don't want an attacker guessing wrong emails to DoS
 * a real user by tripping the email-specific limiter against junk
 * addresses. Checking IP first keeps the email bucket honest.
 */
function loginRateLimiter(req, res, next) {
    perIpLimiter(req, res, (err) => {
        if (err) return next(err);
        if (res.headersSent) return; // IP limiter already responded 429
        return perEmailLimiter(req, res, next);
    });
}

// RBAC mutation rate limiter — applied to all permission write routes
// (level create/update/delete, override grant/deny/revoke, cross-dept
// grant create/delete). Keyed by authenticated user ID to prevent a
// single actor from flooding permission mutation endpoints, falling back
// to IP for unauthenticated requests (which auth middleware should have
// already rejected, but defence in depth).
const permissionWriteLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Too many permission writes. Please slow down.' },
});

// Per-IP limiter for activate lookups — prevents token enumeration noise.
// 5 attempts per minute per IP is generous enough for legitimate use while
// blocking automated scanning.
const activateRateLimiter = rateLimit({
    windowMs: 60 * 1000,
    max: 5,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: { error: 'Too many activation attempts.' },
});

// Per-inviter hourly cap on creating invitations — prevents a single
// operator from accidentally (or maliciously) flooding the email queue.
// Keyed by authenticated user ID; falls back to IP if no user on context.
const invitationCreateLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.user?.id || req.ip,
    message: { error: 'Invitation rate limit exceeded.' },
});

// Per-IP hourly cap for forgot-password requests — 3 attempts per hour
// prevents email queue flooding while still allowing genuine retries.
const forgotPasswordLimiter = rateLimit({
    windowMs: 60 * 60 * 1000,  // 1 hour
    max: 3,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => req.ip,
    message: { success: false, error: 'Too many password reset attempts. Try again later.' },
});

// Two-factor public endpoints (login/2fa-verify, 2fa/email-resend). Both run
// before a session exists, so we key on IP. 10 attempts per 15 minutes is
// generous enough for a user fumbling a TOTP code while still capping
// brute-force replay against a leaked pending_token.
const twoFactorVerifyLimiter = rateLimit({
    windowMs: 15 * 60 * 1000,
    max: 10,
    standardHeaders: true,
    legacyHeaders: false,
    keyGenerator: (req) => clientKey(req),
    handler: (req, res) => {
        res.set('Retry-After', '60');
        return res.status(429).json(errorEnvelope(
            'Too many verification attempts; please wait and try again',
            'rate_limited',
        ));
    },
});

module.exports = {
    loginRateLimiter,
    permissionWriteLimiter,
    activateRateLimiter,
    invitationCreateLimiter,
    forgotPasswordLimiter,
    twoFactorVerifyLimiter,
};
