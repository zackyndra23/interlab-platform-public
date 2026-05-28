'use strict';
const Joi = require('joi');

const STAGES = ['Registered','Processed','Production','Shipped','Customs','Arrived','Inspected','Delivery','Installation','BAST','Invoice'];

const reject = Joi.object({
  toStatus: Joi.string().valid(...STAGES).required(),
  reason: Joi.string().min(3).max(500).required(),
});

const adminOverride = Joi.object({
  targetStatus: Joi.string().valid(...STAGES).required(),
  reason: Joi.string().min(3).max(500).required(),
});

module.exports = { reject, adminOverride };
