'use strict';

const Joi = require('joi');

// Login request — matches openapi.yaml §LoginRequest.
//
// recaptcha_token is accepted (per spec) but verification is stubbed out at
// the service layer unless a secret is configured via env. That way
// development can run without Google credentials while production deploys
// can flip on the verifier by setting RECAPTCHA_SECRET.
const loginRequest = Joi.object({
    email: Joi.string().email().max(320).required(),
    password: Joi.string().min(8).max(200).required(),
    recaptcha_token: Joi.string().max(4000).allow('', null),
    remember_me: Joi.boolean().default(false),
});

const refreshRequest = Joi.object({
    refresh_token: Joi.string().max(4000).required(),
});

const logoutRequest = Joi.object({
    // Optional: lets a client log out a specific refresh token without
    // revealing its access token. If omitted, the current session inferred
    // from the access token is revoked.
    refresh_token: Joi.string().max(4000).allow('', null),
});

module.exports = {
    loginRequest,
    refreshRequest,
    logoutRequest,
};
