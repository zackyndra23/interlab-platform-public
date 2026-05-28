'use strict';
// POST /api/auth/change-password
//
// Authenticated endpoint. Verifies the caller's current password, hashes the
// new password with argon2id, and clears the must_change_password flag.
//
// This route is allowed through the auth middleware even when
// must_change_password=true (it is in the ALLOWED_WHEN_MUST_CHANGE set).

const express = require('express');
const Joi = require('joi');

const { authMiddleware } = require('../../middleware/auth.middleware');
const { validate } = require('../../middleware/validator.middleware');
const auth = require('../../services/auth.service');
const { success } = require('../../utils/response');
const { validatePasswordStrength } = require('../../utils/password_strength');
const { ValidationError } = require('../../utils/errors');

const router = express.Router();

// Joi validates shape only; strength rules applied separately so we can return
// per-rule errors (Joi messages aren't granular enough for "missing uppercase"
// vs "missing symbol").
const changePasswordSchema = Joi.object({
    current_password: Joi.string().min(1).required(),
    new_password: Joi.string().required(),
});

router.post(
    '/change-password',
    authMiddleware,
    validate({ body: changePasswordSchema }),
    async (req, res, next) => {
        try {
            const { current_password, new_password } = req.body;

            // Strength check (per spec §2: min 12 char + complexity)
            const errors = validatePasswordStrength(new_password);
            if (errors.length > 0) {
                throw new ValidationError(errors[0]);  // surface first failing rule
            }

            await auth.changePassword({
                userId: req.user.id,
                currentPassword: current_password,
                newPassword: new_password,
            });
            res.json(success({ message: 'Password changed successfully' }));
        } catch (e) {
            next(e);
        }
    },
);

module.exports = router;
