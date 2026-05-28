'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { twoFactorVerifyLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const svc = require('../../services/two_factor.service');
const auth = require('../../services/auth.service');
const { success } = require('../../utils/response');

// Best-effort client IP — matches the pattern used in auth.routes.js. Used
// for activity logging on the public 2FA verification endpoint.
function clientIp(req) {
    const forwarded = req.headers['x-forwarded-for'];
    if (typeof forwarded === 'string' && forwarded.length > 0) {
        return forwarded.split(',')[0].trim();
    }
    return req.ip;
}

// ============================================================================
// AUTHENTICATED ROUTES — managing your own 2FA settings (require login)
// authMiddleware applied per-route so it does not leak into the public routes
// declared below. (A previously-used sub-router approach swallowed public
// requests as 404, hence per-route middleware is the safer pattern.)
// ============================================================================

// POST /api/auth/2fa/setup-totp
// Generates a fresh TOTP secret + QR code. Not yet persisted; caller must
// follow up with /verify-totp-setup providing a valid 6-digit code.
router.post('/2fa/setup-totp',
    authMiddleware,
    async (req, res, next) => {
        try {
            res.json(success(await svc.setupTotp(req.user.id)));
        } catch (e) { next(e); }
    });

// POST /api/auth/2fa/verify-totp-setup
// Verifies the first TOTP code, encrypts + persists the secret, generates 10
// backup codes (returned ONCE), enables 2FA on the user.
router.post('/2fa/verify-totp-setup',
    authMiddleware,
    validate({ body: Joi.object({
        secret: Joi.string().required(),
        code: Joi.string().length(6).pattern(/^\d{6}$/).required(),
    })}),
    async (req, res, next) => {
        try {
            res.json(success(await svc.verifyTotpSetup({ userId: req.user.id, ...req.body })));
        } catch (e) { next(e); }
    });

// POST /api/auth/2fa/enable-email
// Switches 2FA method to email — no setup verification needed (next login
// will exercise the flow naturally).
router.post('/2fa/enable-email',
    authMiddleware,
    async (req, res, next) => {
        try {
            res.json(success(await svc.enableEmail(req.user.id)));
        } catch (e) { next(e); }
    });

// POST /api/auth/2fa/disable
// Disables 2FA. Requires current password verification; if method=totp,
// also requires a current TOTP code or a backup code. Revokes all sessions.
router.post('/2fa/disable',
    authMiddleware,
    validate({ body: Joi.object({
        current_password: Joi.string().required(),
        code: Joi.string().allow('', null),
    })}),
    async (req, res, next) => {
        try {
            res.json(success(await svc.disable({
                userId: req.user.id,
                currentPassword: req.body.current_password,
                code: req.body.code || null,
            })));
        } catch (e) { next(e); }
    });

// ============================================================================
// PUBLIC ROUTES — completing the 2FA challenge after a successful password
// login. The /login response gives the caller a `pending_token`; these
// endpoints consume that token and either issue a real session or rotate
// the email OTP. NO authMiddleware here.
// ============================================================================

// POST /api/auth/login/2fa-verify
router.post('/login/2fa-verify',
    twoFactorVerifyLimiter,
    validate({ body: Joi.object({
        pending_token: Joi.string().length(64).hex().required(),
        code: Joi.string().required(), // 6-digit OTP/TOTP or 10-char backup code
    })}),
    async (req, res, next) => {
        try {
            const result = await auth.completeLoginWith2fa({
                pendingToken: req.body.pending_token,
                code: req.body.code,
                clientIp: clientIp(req),
            });
            res.json(success(result));
        } catch (e) { next(e); }
    });

// POST /api/auth/2fa/email-resend
router.post('/2fa/email-resend',
    twoFactorVerifyLimiter,
    validate({ body: Joi.object({
        pending_token: Joi.string().length(64).hex().required(),
    })}),
    async (req, res, next) => {
        try {
            await auth.resend2faEmail(req.body.pending_token);
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

module.exports = router;
