'use strict';

const jwt = require('jsonwebtoken');

const env = require('../config/env');
const db = require('../config/database');
const { UnauthorizedError } = require('../utils/errors');

// Extracts a Bearer JWT, verifies it, loads the user record, and attaches
// req.user = { id, email, role, displayName }. Rejects inactive/deleted users.
// This is the only auth path — no session-cookie fallback.
async function authMiddleware(req, _res, next) {
    try {
        const header = req.headers.authorization || '';
        if (!header.startsWith('Bearer ')) {
            throw new UnauthorizedError('Missing or malformed Authorization header');
        }
        const token = header.slice('Bearer '.length).trim();

        let payload;
        try {
            // Pin algorithms explicitly. Prevents "algorithm confusion"
            // attacks and config-drift if env.jwt ever gains an RS256
            // path. Access tokens are signed HS256 in authService.
            payload = jwt.verify(token, env.jwt.secret, {
                algorithms: ['HS256'],
            });
        } catch (_err) {
            throw new UnauthorizedError('Invalid or expired access token');
        }

        const userId = payload.sub || payload.userId || payload.id;
        if (!userId) throw new UnauthorizedError('Token missing subject');

        const { rows } = await db.query(
            `SELECT id, email, role, display_name, account_status, deleted_at,
                    must_change_password
               FROM users
              WHERE id = $1`,
            [userId],
        );
        if (rows.length === 0) throw new UnauthorizedError('User not found');

        const user = rows[0];
        if (user.deleted_at !== null || user.account_status !== 'active') {
            throw new UnauthorizedError('User account is not active');
        }

        req.user = {
            id: user.id,
            email: user.email,
            role: user.role,
            displayName: user.display_name,
            must_change_password: user.must_change_password,
        };

        // Force-password-change gate: when the flag is set, only a narrow
        // allowlist of endpoints may proceed. All other routes get a 403 with
        // a machine-readable code so the frontend can redirect to /change-password.
        if (user.must_change_password) {
            const ALLOWED_WHEN_MUST_CHANGE = new Set([
                'GET /api/auth/me',
                'POST /api/auth/change-password',
                'POST /api/auth/logout',
            ]);
            const path = req.originalUrl.split('?')[0];
            const matched = [...ALLOWED_WHEN_MUST_CHANGE].some((r) => {
                const [m, p] = r.split(' ');
                return req.method === m && path === p;
            });
            if (!matched) {
                return _res.status(403).json({
                    error: 'must change password before continuing',
                    code: 'must_change_password',
                });
            }
        }

        next();
    } catch (err) {
        next(err);
    }
}

module.exports = { authMiddleware };
