'use strict';
const express = require('express');
const router = express.Router();
const { validate } = require('../../middleware/validator.middleware');
const { forgotPasswordLimiter } = require('../../middleware/rateLimit.middleware');
const v = require('../../validators/forgotPassword.validators');
const svc = require('../../services/password_reset.service');
const { success } = require('../../utils/response');

function clientIp(req) {
    return req.ip || req.connection?.remoteAddress || 'unknown';
}

// POST /api/auth/forgot-password — always 200 (email enumeration prevention)
router.post('/forgot-password',
    forgotPasswordLimiter,
    validate({ body: v.forgotPassword }),
    async (req, res, next) => {
        try {
            await svc.requestReset({ email: req.body.email, ip: clientIp(req) });
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

// POST /api/auth/reset-password
router.post('/reset-password',
    validate({ body: v.resetPassword }),
    async (req, res, next) => {
        try {
            await svc.consumeReset({
                token: req.body.token,
                newPassword: req.body.new_password,
                ip: clientIp(req),
            });
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

module.exports = router;
