'use strict';
const Joi = require('joi');

const forgotPassword = Joi.object({
    email: Joi.string().email().max(320).required(),
});

const resetPassword = Joi.object({
    token: Joi.string().length(64).hex().required(),
    new_password: Joi.string().required(),  // strength checked in service
});

module.exports = { forgotPassword, resetPassword };
