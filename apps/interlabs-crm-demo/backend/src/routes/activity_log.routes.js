'use strict';

const express = require('express');

const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { success } = require('../utils/response');
const { buildMeta } = require('../utils/pagination');
const svc = require('../services/activity_log.service');

const router = express.Router();

// rbacGuard bypasses for superadmin/ceo via the role fast-path in
// rbac.middleware.js, so no seed change to role_permissions is required
// for the demo. Non-super/ceo roles will 403.
const guard = rbacGuard('activity_log', 'view_global');

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// GET /api/activity-logs
// Query: page, limit, userId, action, resourceType, dateFrom, dateTo, search
router.get(
    '/',
    authMiddleware,
    guard,
    asyncHandler(async (req, res) => {
        const { page, limit, userId, action, resourceType, dateFrom, dateTo, search } = req.query;
        const parsedPage = page ? Math.max(parseInt(page, 10) || 1, 1) : 1;
        const parsedLimit = limit ? Math.min(Math.max(parseInt(limit, 10) || 50, 1), 200) : 50;

        const result = await svc.list({
            page: parsedPage,
            limit: parsedLimit,
            userId,
            action,
            resourceType,
            dateFrom,
            dateTo,
            search,
        });

        res.json(success(result.data, buildMeta(result.total, result.page, result.limit)));
    }),
);

// GET /api/activity-logs/online
// Returns currently connected WebSocket users
router.get(
    '/online',
    authMiddleware,
    guard,
    asyncHandler(async (_req, res) => {
        const users = await svc.onlineUsers();
        res.json(success(users));
    }),
);

module.exports = router;
