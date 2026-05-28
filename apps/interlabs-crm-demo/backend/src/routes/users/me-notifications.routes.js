'use strict';
const express = require('express');
const router = express.Router();
const { authMiddleware } = require('../../middleware/auth.middleware');
const muteSvc = require('../../services/notification_mute.service');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

router.get('/templates', async (req, res, next) => {
    try {
        const r = await db.query(
            `SELECT t.id, t.template_key, t.template_name, t.feature_group,
                    EXISTS (SELECT 1 FROM notification_user_mutes m
                             WHERE m.user_id = $1 AND m.template_id = t.id) AS muted
               FROM notification_templates t
              WHERE t.status = 'enabled'
              ORDER BY t.feature_group, t.template_name`,
            [req.user.id],
        );
        res.json(success({ items: r.rows }));
    } catch (e) { next(e); }
});

router.post('/mutes/:templateId', async (req, res, next) => {
    try {
        res.json(success(await muteSvc.mute(req.user.id, req.params.templateId)));
    } catch (e) { next(e); }
});

router.delete('/mutes/:templateId', async (req, res, next) => {
    try {
        res.json(success(await muteSvc.unmute(req.user.id, req.params.templateId)));
    } catch (e) { next(e); }
});

module.exports = router;
