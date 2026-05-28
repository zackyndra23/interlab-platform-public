'use strict';

const { AppError } = require('../utils/errors');
const { error: errorEnvelope } = require('../utils/response');
const env = require('../config/env');

// Express error handler. Must have 4 params for Express to recognize it.
// eslint-disable-next-line no-unused-vars
function errorHandler(err, _req, res, _next) {
    if (err instanceof AppError) {
        const payload = errorEnvelope(err.message, err.code);
        if (err.details) payload.details = err.details;
        return res.status(err.status).json(payload);
    }

    if (env.nodeEnv !== 'production') {
        // eslint-disable-next-line no-console
        console.error('[unhandled]', err);
    }
    return res.status(500).json(errorEnvelope('Internal server error', 'internal_error'));
}

module.exports = { errorHandler };
