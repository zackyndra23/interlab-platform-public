'use strict';

const { BadRequestError } = require('../utils/errors');

const JOI_OPTIONS = Object.freeze({
    abortEarly: false,
    stripUnknown: true,
    convert: true,
});

// validate({ body?, params?, query? }) returns Express middleware that runs
// each supplied Joi schema against the matching request section. On any
// failure it throws BadRequestError with per-field details. On success it
// replaces the request section with the coerced/normalized value so handlers
// can trust their input.
function validate(schemas) {
    return function validateMiddleware(req, _res, next) {
        try {
            const sections = ['body', 'params', 'query'];
            for (const section of sections) {
                const schema = schemas[section];
                if (!schema) continue;
                const { value, error } = schema.validate(req[section], JOI_OPTIONS);
                if (error) {
                    const details = error.details.map((d) => ({
                        path: d.path.join('.'),
                        message: d.message,
                    }));
                    throw new BadRequestError('Validation failed', details);
                }
                req[section] = value;
            }
            next();
        } catch (err) {
            next(err);
        }
    };
}

module.exports = { validate };
