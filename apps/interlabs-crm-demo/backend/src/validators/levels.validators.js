'use strict';
const Joi = require('joi');

const create = Joi.object({
    levelKey:         Joi.string().pattern(/^[a-z][a-z0-9_]{2,59}$/).message('level_key must be lowercase alnum + underscore, 3-60 chars').required(),
    levelName:        Joi.string().min(1).max(120).required(),
    levelRank:        Joi.number().integer().min(1).max(99).required(),
    dataScopeDefault: Joi.string().valid('own', 'team', 'role', 'global').default('own'),
});

const update = Joi.object({
    levelName:        Joi.string().min(1).max(120),
    levelRank:        Joi.number().integer().min(1).max(99),
    dataScopeDefault: Joi.string().valid('own', 'team', 'role', 'global'),
}).min(1);

module.exports = { create, update };
