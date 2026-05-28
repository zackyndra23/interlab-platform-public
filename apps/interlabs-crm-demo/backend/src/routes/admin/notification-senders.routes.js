'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../../middleware/auth.middleware');
const { rbacGuard } = require('../../middleware/rbac.middleware');
const { permissionWriteLimiter } = require('../../middleware/rateLimit.middleware');
const { validate } = require('../../middleware/validator.middleware');
const svc = require('../../services/notification_sender.service');
const { success } = require('../../utils/response');

router.use(authMiddleware);

const createSchema = Joi.object({
    sender_key: Joi.string().min(2).max(60).required(),
    display_name: Joi.string().min(1).max(120).required(),
    from_email: Joi.string().email().required(),
    reply_to_email: Joi.string().email().allow(null, ''),
    provider: Joi.string().valid('smtp', 'gmail', 'ses', 'postmark', 'resend').required(),
    provider_config_key: Joi.string().min(1).max(120).required(),
    is_active: Joi.boolean().default(true),
});

const updateSchema = Joi.object({
    display_name: Joi.string().min(1).max(120),
    from_email: Joi.string().email(),
    reply_to_email: Joi.string().email().allow(null, ''),
    provider: Joi.string().valid('smtp', 'gmail', 'ses', 'postmark', 'resend'),
    provider_config_key: Joi.string().min(1).max(120),
    is_active: Joi.boolean(),
}).min(1);

router.get('/', rbacGuard('admin_rbac', 'view_global'), async (_req, res, next) => {
    try { res.json(success({ items: await svc.list() })); } catch (e) { next(e); }
});

router.post('/', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: createSchema }),
    async (req, res, next) => {
        try {
            res.status(201).json(success(await svc.create({ actor: req.user, ...req.body })));
        } catch (e) { next(e); }
    });

router.patch('/:id', rbacGuard('admin_rbac', 'edit'), permissionWriteLimiter, validate({ body: updateSchema }),
    async (req, res, next) => {
        try {
            res.json(success(await svc.update({ actor: req.user, id: req.params.id, patch: req.body })));
        } catch (e) { next(e); }
    });

router.delete('/:id', rbacGuard('admin_rbac', 'delete'), permissionWriteLimiter,
    async (req, res, next) => {
        try {
            res.json(success(await svc.remove({ actor: req.user, id: req.params.id })));
        } catch (e) { next(e); }
    });

module.exports = router;
