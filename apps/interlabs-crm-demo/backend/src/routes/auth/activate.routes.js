'use strict';
// POST /api/auth/activate
//
// Public endpoint (no auth required). Completes onboarding in one atomic step:
//   1. Verify the 64-hex invitation token and create the user row (must_change_password=true).
//   2. Immediately rotate the password to the user-chosen value and clear must_change_password.
//   3. Issue an access token + refresh session — same shape as the login response so the
//      frontend can treat activation as a login and redirect straight into the app.
//
// Login response shape (from auth.service.login):
//   { access_token, refresh_token, token_type, expires_in, refresh_expires_at, user }
// Mirror that exactly so callers don't need special-casing.

const express = require('express');
const { validate } = require('../../middleware/validator.middleware');
const { activateRateLimiter } = require('../../middleware/rateLimit.middleware');
const v = require('../../validators/invitations.validators');
const svc = require('../../services/invitation.service');
const auth = require('../../services/auth.service');
const { hashPassword } = require('../../utils/initial_password');
const db = require('../../config/database');
const { success } = require('../../utils/response');

const router = express.Router();

router.post(
    '/activate',
    activateRateLimiter,
    validate({ body: v.accept }),
    async (req, res, next) => {
        try {
            const { token, newPassword, displayName } = req.body;

            // Step 1: Accept the invitation — verifies token, creates user with
            // initial passphrase hash and must_change_password=true.
            const { userId } = await svc.accept({ token, displayName });

            // Step 2: Rotate password to the user-chosen value + clear the forced
            // change flag. Both writes happen in a single query for atomicity.
            const newHash = await hashPassword(newPassword);
            await db.query(
                `UPDATE users
                    SET password_hash       = $2,
                        must_change_password = false,
                        updated_at          = now()
                  WHERE id = $1`,
                [userId, newHash],
            );

            // Step 3: Load the full profile (same path as login / /me).
            const profile = await auth.loadProfile(userId);

            // Step 4: Issue a refresh session + sign an access token.
            // Use db.withTransaction so the session INSERT is atomic and we get
            // back the opaque refresh token + its expiry — matching login exactly.
            const { refreshToken, expiresAt } = await db.withTransaction((client) =>
                auth.createSession(client, { userId, rememberMe: false }),
            );

            const accessToken = auth.signAccessToken(profile);

            // Return login-shaped response so the frontend can store tokens and
            // navigate directly into the app without a second login call.
            res.status(201).json(success({
                access_token: accessToken,
                refresh_token: refreshToken,
                token_type: 'Bearer',
                expires_in: auth.accessTokenTtlSeconds(),
                refresh_expires_at: expiresAt.toISOString(),
                user: profile,
            }));
        } catch (e) { next(e); }
    },
);

module.exports = router;
