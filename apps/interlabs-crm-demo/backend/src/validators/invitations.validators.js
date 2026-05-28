'use strict';
const Joi = require('joi');

const create = Joi.object({
    email: Joi.string().email().required(),
    roleKey: Joi.string().valid('sales', 'admin_log', 'finance', 'technical', 'hrga', 'tax_insurance').required(),
    levelId: Joi.string().uuid().allow(null),
});

const revoke = Joi.object({
    reason: Joi.string().max(255).allow('', null),
});

const accept = Joi.object({
    token: Joi.string().length(64).hex().required(),
    newPassword: Joi.string().min(8).max(120).required(),
    displayName: Joi.string().min(1).max(120).required(),
});

module.exports = { create, revoke, accept };
