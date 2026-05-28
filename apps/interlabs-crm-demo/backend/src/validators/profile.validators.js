'use strict';

const Joi = require('joi');

const updateProfile = Joi.object({
    first_name: Joi.string().trim().min(1).max(120).required(),
    last_name:  Joi.string().trim().min(1).max(120).required(),
    email:      Joi.string().email().max(320).required(),
    phone:      Joi.string().pattern(/^\+[1-9]\d{1,14}$/).required().messages({
        'string.pattern.base': 'Phone must be in E.164 format (e.g. +628123456789)',
    }),
});

module.exports = { updateProfile };
