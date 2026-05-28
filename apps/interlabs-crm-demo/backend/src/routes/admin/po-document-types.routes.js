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

const STAGES = ['Registered','Processed','Production','Shipped','Customs','Arrived','Inspected','Delivery','Installation','BAST','Invoice'];

const upsert = Joi.object({
    doc_key:            Joi.string().min(1).max(100).required(),
    doc_name:           Joi.string().min(1).max(255).required(),
    triggers_stage:     Joi.string().valid(...STAGES).allow(null).default(null),
    required_for_stage: Joi.string().valid(...STAGES).allow(null).default(null),
    uploader_role_keys: Joi.array().items(Joi.string()).default([]),
    is_active:          Joi.boolean().default(true),
});

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try {
        const r = await db.query(`SELECT * FROM po_document_types ORDER BY doc_name`);
        res.json(success({ items: r.rows }));
    } catch (e) { next(e); }
});

router.post('/',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: upsert }),
    async (req, res, next) => {
        try {
            const b = req.body;
            const r = await db.query(`
                INSERT INTO po_document_types
                  (doc_key, doc_name, triggers_stage, required_for_stage, uploader_role_keys, is_active)
                VALUES ($1,$2,$3,$4,$5::jsonb,$6) RETURNING *`,
                [b.doc_key, b.doc_name, b.triggers_stage, b.required_for_stage,
                    JSON.stringify(b.uploader_role_keys), b.is_active]);
            res.status(201).json(success(r.rows[0]));
        } catch (e) { next(e); }
    });

router.patch('/:id',
    rbacGuard('admin_rbac', 'edit'),
    permissionWriteLimiter,
    validate({ body: upsert.fork(Object.keys(upsert.describe().keys), s => s.optional()) }),
    async (req, res, next) => {
        try {
            const b = req.body;
            const r = await db.query(`
                UPDATE po_document_types SET
                  doc_key            = COALESCE($2, doc_key),
                  doc_name           = COALESCE($3, doc_name),
                  triggers_stage     = COALESCE($4, triggers_stage),
                  required_for_stage = COALESCE($5, required_for_stage),
                  uploader_role_keys = COALESCE($6::jsonb, uploader_role_keys),
                  is_active          = COALESCE($7, is_active),
                  updated_at         = now()
                 WHERE id=$1 RETURNING *`,
                [req.params.id, b.doc_key, b.doc_name, b.triggers_stage, b.required_for_stage,
                    b.uploader_role_keys != null ? JSON.stringify(b.uploader_role_keys) : null,
                    b.is_active]);
            res.json(success(r.rows[0]));
        } catch (e) { next(e); }
    });

router.delete('/:id',
    rbacGuard('admin_rbac', 'delete'),
    permissionWriteLimiter,
    async (req, res, next) => {
        try {
            await db.query(`DELETE FROM po_document_types WHERE id=$1`, [req.params.id]);
            res.json(success({ ok: true }));
        } catch (e) { next(e); }
    });

module.exports = router;
