'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { loginRateLimiter } = require('../middleware/rateLimit.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const authService = require('../services/auth.service');
const v = require('../validators/auth.validators');

const router = express.Router();

// Best-effort client IP extraction used only for reCAPTCHA scoring. Respects
// X-Forwarded-For when Express is behind Traefik (the deployed setup). If
// the header is absent, falls back to req.ip which Express derives from the
// socket. Never used for auth decisions — just passed through.
function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// ============================================================================
// POST /api/auth/login
//
// Public endpoint — no auth middleware. Accepts email + password, optionally
// a reCAPTCHA token and a remember_me flag (extends refresh expiry to 30d).
// Returns { access_token, refresh_token, token_type, expires_in, user }.
// ============================================================================

router.post(
    '/login',
    // Order: validate body first so the rate limiter reads a sanitized
    // email; then apply the 5-per-15min-per-IP-and-email limiter.
    validate({ body: v.loginRequest }),
    loginRateLimiter,
    asyncHandler(async (req, res) => {
        const data = await authService.login({
            email: req.body.email,
            password: req.body.password,
            recaptchaToken: req.body.recaptcha_token,
            rememberMe: req.body.remember_me === true,
            clientIp: clientIp(req),
        });
        res.json(success(data));
    }),
);

// ============================================================================
// POST /api/auth/refresh
//
// Public endpoint — the refresh token itself authenticates the call. Returns
// a fresh access_token (no rotation of the refresh token; the existing one
// stays valid until its expires_at).
// ============================================================================

router.post(
    '/refresh',
    validate({ body: v.refreshRequest }),
    asyncHandler(async (req, res) => {
        const data = await authService.refresh({
            refreshToken: req.body.refresh_token,
        });
        res.json(success(data));
    }),
);

// ============================================================================
// POST /api/auth/logout
//
// Authenticated endpoint. Two modes:
//   - body { refresh_token } → revoke just that session (useful for
//     "log this device out" flows on a multi-device account).
//   - empty body → revoke every session for the current user (the "Sign
//     out" button default).
//
// Returns 204 per OpenAPI contract.
// ============================================================================

router.post(
    '/logout',
    authMiddleware,
    validate({ body: v.logoutRequest }),
    asyncHandler(async (req, res) => {
        await authService.logout({
            currentUserId: req.user.id,
            refreshToken: req.body && req.body.refresh_token
                ? req.body.refresh_token
                : null,
        });
        res.status(204).end();
    }),
);

// ============================================================================
// GET /api/auth/me
//
// Authenticated endpoint. Returns the full user profile including RBAC
// role-scope fields (managed_role_scope, can_manage_same_role,
// feature_permission_scope) so the frontend can build the sidebar and
// permission gates without a second round-trip.
// ============================================================================

router.get(
    '/me',
    authMiddleware,
    asyncHandler(async (req, res) => {
        res.json(success(await authService.me(req.user.id)));
    }),
);

module.exports = router;
