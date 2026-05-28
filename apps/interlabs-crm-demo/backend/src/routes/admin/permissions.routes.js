'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const db = require('../../config/database');
const perms = require('../../services/permission.service');
const { ValidationError } = require('../../utils/errors');

router.use(authMiddleware);

router.get('/features', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try {
        const r = await db.query(`SELECT id, feature_key, feature_name, module_group FROM feature_definitions ORDER BY module_group, feature_key`);
        res.json({ items: r.rows });
    } catch (e) { next(e); }
});

router.get('/capabilities', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try {
        const r = await db.query(`SELECT id, capability_key, capability_name FROM capability_definitions ORDER BY capability_key`);
        res.json({ items: r.rows });
    } catch (e) { next(e); }
});

router.get('/role-permissions', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try {
        const r = await db.query(`SELECT role_id, level_id, feature_id, capability_id FROM role_permissions`);
        res.json({ items: r.rows });
    } catch (e) { next(e); }
});

router.post(
    '/role-permissions',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            const { role_id, level_id, feature_id, capability_id, enabled } = req.body;
            if (!role_id || !level_id || !feature_id || !capability_id || typeof enabled !== 'boolean') {
                return res.status(400).json({ error: 'role_id, level_id, feature_id, capability_id, enabled required' });
            }

            // Guard: verify the level actually belongs to the submitted role.
            const lvlCheck = await db.query(
                `SELECT 1 FROM role_levels WHERE id = $1 AND role_id = $2 AND deleted_at IS NULL`,
                [level_id, role_id],
            );
            if (!lvlCheck.rowCount) {
                throw new ValidationError('level does not belong to role');
            }

            if (enabled) {
                await db.query(
                    `INSERT INTO role_permissions (role_id, level_id, feature_id, capability_id)
                     VALUES ($1,$2,$3,$4) ON CONFLICT DO NOTHING`,
                    [role_id, level_id, feature_id, capability_id],
                );
            } else {
                await db.query(
                    `DELETE FROM role_permissions WHERE role_id=$1 AND level_id=$2 AND feature_id=$3 AND capability_id=$4`,
                    [role_id, level_id, feature_id, capability_id],
                );
            }
            await perms.invalidateAll();
            res.json({ ok: true });
        } catch (e) { next(e); }
    },
);

module.exports = router;
