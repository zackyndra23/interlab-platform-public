'use strict';
const Joi = require('joi');

// Schema for POST /users/:id/overrides/grant and POST /users/:id/overrides/deny.
// The override_type is implied by the route; only the (feature, capability, optional
// reason, optional expiry) need to be supplied in the request body.
const grant = Joi.object({
    featureId:    Joi.string().uuid().required(),
    capabilityId: Joi.string().uuid().required(),
    reason:       Joi.string().allow('', null).default(null),
    expiresAt:    Joi.date().iso().allow(null).default(null),
});

// Schema for POST /users/:id/cross-dept-grants.
const crossDept = Joi.object({
    targetRoleKey: Joi.string().required(),
    featureId:     Joi.string().uuid().required(),
    capabilityId:  Joi.string().uuid().required(),
    expiresAt:     Joi.date().iso().allow(null).default(null),
    notes:         Joi.string().allow('', null).default(null),
});

module.exports = { grant, crossDept };
