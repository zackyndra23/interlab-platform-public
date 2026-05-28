'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const db = require('../../config/database');
const { success } = require('../../utils/response');

router.use(authMiddleware);

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try {
        const r = await db.query(
            `SELECT id, template_key, template_name, feature_group, trigger_event,
                    recipient_roles_json, send_email_enabled, send_dashboard_notification_enabled,
                    status, subject, body, sender_id, updated_at
               FROM notification_templates ORDER BY feature_group, template_key`,
        );
        res.json(success({ items: r.rows }));
    } catch (e) { next(e); }
});

router.get('/:id', rbacGuard('admin_rbac', 'view_global'), async (req, res, next) => {
    try {
        const t = await db.query(`SELECT * FROM notification_templates WHERE id=$1`, [req.params.id]);
        if (!t.rowCount) return res.status(404).json({ error: 'not found' });
        const extras = await db.query(
            `SELECT u.id AS user_id, u.email, u.display_name
               FROM notification_template_extra_recipients e
               JOIN users u ON u.id = e.user_id
              WHERE e.template_id = $1`,
            [req.params.id],
        );
        res.json(success({ template: t.rows[0], extra_recipients: extras.rows }));
    } catch (e) { next(e); }
});

const patchSchema = Joi.object({
    sender_id: Joi.string().uuid().allow(null),
    recipient_roles_json: Joi.array().items(Joi.string()),
    send_email_enabled: Joi.boolean(),
    send_dashboard_notification_enabled: Joi.boolean(),
    status: Joi.string().valid('enabled', 'disabled'),
    subject: Joi.string().allow('', null),
    body: Joi.string().allow('', null),
}).min(1);

router.patch('/:id', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: patchSchema }),
    async (req, res, next) => {
        try {
            const b = req.body;
            // Build SET clauses dynamically so that explicitly-supplied null values
            // clear the column rather than being swallowed by COALESCE.
            const values = [req.params.id]; // $1 = id
            const fields = [];

            // Non-nullable flags / references — only set when present in the body.
            if ('sender_id' in b) {
                fields.push(`sender_id = $${values.push(b.sender_id)}`);
            }
            if ('recipient_roles_json' in b) {
                fields.push(`recipient_roles_json = $${values.push(
                    b.recipient_roles_json != null ? JSON.stringify(b.recipient_roles_json) : null,
                )}::jsonb`);
            }
            if ('send_email_enabled' in b) {
                fields.push(`send_email_enabled = $${values.push(b.send_email_enabled)}`);
            }
            if ('send_dashboard_notification_enabled' in b) {
                fields.push(`send_dashboard_notification_enabled = $${values.push(b.send_dashboard_notification_enabled)}`);
            }
            if ('status' in b) {
                fields.push(`status = $${values.push(b.status)}`);
            }
            // Nullable text fields — explicit null must clear the column.
            if ('subject' in b) {
                fields.push(`subject = $${values.push(b.subject)}`);
            }
            if ('body' in b) {
                fields.push(`body = $${values.push(b.body)}`);
            }

            fields.push('updated_at = now()');
            const sql = `UPDATE notification_templates SET ${fields.join(', ')} WHERE id=$1 RETURNING *`;
            const r = await db.query(sql, values);
            res.json(success(r.rows[0]));
        } catch (e) { next(e); }
    });

router.put('/:id/extra-recipients', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter,
    validate({ body: Joi.object({ user_ids: Joi.array().items(Joi.string().uuid()).required() }) }),
    async (req, res, next) => {
        try {
            const client = await db.pool.connect();
            try {
                await client.query('BEGIN');
                await client.query(
                    `DELETE FROM notification_template_extra_recipients WHERE template_id=$1`,
                    [req.params.id],
                );
                for (const uid of req.body.user_ids) {
                    await client.query(
                        `INSERT INTO notification_template_extra_recipients (template_id, user_id)
                         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
                        [req.params.id, uid],
                    );
                }
                await client.query('COMMIT');
                res.json(success({ ok: true, count: req.body.user_ids.length }));
            } catch (e) {
                await client.query('ROLLBACK').catch(() => {});
                throw e;
            } finally { client.release(); }
        } catch (e) { next(e); }
    });

module.exports = router;
