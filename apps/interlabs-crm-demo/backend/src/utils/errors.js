'use strict';

class AppError extends Error {
    constructor(message, { status = 500, code = 'internal_error' } = {}) {
        super(message);
        this.name = this.constructor.name;
        this.status = status;
        this.code = code;
    }
}

class BadRequestError extends AppError {
    constructor(message, details) {
        super(message, { status: 400, code: 'bad_request' });
        if (details) this.details = details;
    }
}

class UnauthorizedError extends AppError {
    constructor(message = 'Unauthorized') {
        super(message, { status: 401, code: 'unauthorized' });
    }
}

class ForbiddenError extends AppError {
    constructor(message = 'Forbidden') {
        super(message, { status: 403, code: 'forbidden' });
    }
}

class NotFoundError extends AppError {
    constructor(message = 'Resource not found') {
        super(message, { status: 404, code: 'not_found' });
    }
}

class ConflictError extends AppError {
    constructor(message) {
        super(message, { status: 409, code: 'conflict' });
    }
}

class UnprocessableError extends AppError {
    constructor(message, details) {
        super(message, { status: 422, code: 'unprocessable' });
        if (details) this.details = details;
    }
}

// Alias used by services that need a semantic "validation/bad input" error
// without coupling to HTTP 400. Maps to 422 (same as UnprocessableError) so
// callers can distinguish domain validation failures from malformed requests.
class ValidationError extends AppError {
    constructor(message, details) {
        super(message, { status: 422, code: 'validation_error' });
        if (details) this.details = details;
    }
}

module.exports = {
    AppError,
    BadRequestError,
    UnauthorizedError,
    ForbiddenError,
    NotFoundError,
    ConflictError,
    UnprocessableError,
    ValidationError,
};
