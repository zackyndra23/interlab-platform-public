'use strict';

const crypto = require('crypto');

const env = require('../config/env');

// Structured request logger — CTX_architecture §BACKEND ARCHITECTURE step 2:
// "Request logger" runs right after CORS + rate limiter.
//
// Emits one JSON line per completed request (on `res.on('finish')`) with
// enough context to correlate with downstream service logs:
//
//   { ts, req_id, method, path, status, dur_ms, user_id, role, ip }
//
// Design notes:
//   - req_id is a v4 UUID generated here (or taken from an inbound
//     X-Request-Id header if the upstream proxy already set one, so
//     Traefik / the frontend can correlate). Always echoed back as
//     X-Request-Id on the response for client-side observability.
//   - user_id / role come from req.user, which authMiddleware attaches
//     AFTER this middleware. That means the logger captures them via a
//     late read at response-time — req.user is populated by the time the
//     response finishes for authenticated routes.
//   - No body payloads are logged. Avoids accidental secret / PII leak
//     (login emails, PPh NPWPs, etc.).
//   - Uses console.log so existing console sinks (stdout under pm2 /
//     Docker) capture it. For an ELK/Loki pipeline the JSON line is
//     grep-friendly.

function clientIp(req) {
    const fwd = req.headers['x-forwarded-for'];
    if (typeof fwd === 'string' && fwd.length > 0) {
        return fwd.split(',')[0].trim();
    }
    return req.ip || null;
}

function safePath(req) {
    // Strip query string so tokens / secrets that leaked into a query
    // (shouldn't happen, but defence in depth) don't reach stdout.
    const idx = req.originalUrl ? req.originalUrl.indexOf('?') : -1;
    if (idx === -1) return req.originalUrl || req.url || '';
    return req.originalUrl.slice(0, idx);
}

function requestLogger(req, res, next) {
    if (env.logger.level === 'silent') return next();

    // Respect inbound X-Request-Id so traces chain across the edge proxy.
    // If absent, mint a v4 uuid. 26-char alphanumeric cap keeps grep
    // patterns simple in downstream logs.
    const inboundId = req.headers['x-request-id'];
    const reqId = (typeof inboundId === 'string' && inboundId.length > 0
        && inboundId.length <= 128)
        ? inboundId
        : crypto.randomUUID();

    req.id = reqId;
    res.setHeader('X-Request-Id', reqId);

    const startedAt = process.hrtime.bigint();

    res.on('finish', () => {
        const durNs = process.hrtime.bigint() - startedAt;
        const durMs = Number(durNs / 1_000_000n);

        const line = {
            ts: new Date().toISOString(),
            req_id: reqId,
            method: req.method,
            path: safePath(req),
            status: res.statusCode,
            dur_ms: durMs,
            user_id: req.user ? req.user.id : null,
            role: req.user ? req.user.role : null,
            ip: clientIp(req),
        };

        // Route 5xx to stderr so the host's error-log tail picks it up;
        // everything else to stdout. Structured enough that a Loki/ELK
        // ingestor can parse it with a single JSON parser.
        const sink = res.statusCode >= 500 ? console.error : console.log;
        // eslint-disable-next-line no-console
        sink(JSON.stringify(line));
    });

    next();
}

module.exports = { requestLogger };
