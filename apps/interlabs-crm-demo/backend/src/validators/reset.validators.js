'use strict';
const Joi = require('joi');

module.exports = {
    resetToBackup: Joi.object({
        userId: Joi.string().uuid().required(),
    }),
};
