'use strict';

const path = require('path');

// Load the repo-root .env explicitly.
//
// The backend package lives at <repo>/backend/, so from
// <repo>/backend/src/config/env.js the repo root is three directory levels
// up. Using an absolute path here makes env loading independent of
// process.cwd() — the server behaves identically whether `npm start` runs
// from backend/, from the repo root, or from a Docker workdir.
//
// backend/.env.example remains the template for documenting the full set
// of supported variables; populate the repo-root .env from it.
require('dotenv').config({
    path: path.resolve(__dirname, '../../../.env'),
});

const required = (key) => {
    const value = process.env[key];
    if (value === undefined || value === '') {
        throw new Error(`Missing required environment variable: ${key}`);
    }
    return value;
};

const optional = (key, fallback) => {
    const value = process.env[key];
    return value === undefined || value === '' ? fallback : value;
};

// Read the first defined value from a list of env var aliases. Lets us
// accept more than one canonical name for the same setting without leaking
// that choice into application code. The first name in `keys` is treated
// as the preferred name and is what the template (.env.example) documents.
//
// When `isRequired` is true and none of the aliases are set (and no
// `fallback` is supplied), throws with a message that lists every accepted
// name so the operator can pick one.
const firstDefined = (keys, { fallback, isRequired = false } = {}) => {
    for (const key of keys) {
        const value = process.env[key];
        if (value !== undefined && value !== '') return value;
    }
    if (fallback !== undefined) return fallback;
    if (isRequired) {
        throw new Error(
            `Missing required environment variable (expected one of: ${keys.join(', ')})`,
        );
    }
    return undefined;
};

module.exports = {
    nodeEnv: optional('NODE_ENV', 'development'),
    port: Number(optional('PORT', '4000')),

    databaseUrl: required('DATABASE_URL'),

    jwt: {
        secret: required('JWT_SECRET'),
        expiresIn: optional('JWT_EXPIRES_IN', '1h'),
        // JWT_REFRESH_SECRET is the canonical name (documented in
        // backend/.env.example); REFRESH_TOKEN_SECRET is accepted for
        // compatibility with the deployed repo-root .env.
        refreshSecret: firstDefined(
            ['JWT_REFRESH_SECRET', 'REFRESH_TOKEN_SECRET'],
            { isRequired: true },
        ),
        refreshExpiresIn: firstDefined(
            ['JWT_REFRESH_EXPIRES_IN', 'REFRESH_TOKEN_EXPIRES_IN'],
            { fallback: '7d' },
        ),
    },

    bcryptRounds: Number(optional('BCRYPT_ROUNDS', '12')),

    // Remember-me refresh-token expiry (MOD spec: 30 days). Opt-in at
    // login time via remember_me=true on the request body.
    rememberMeRefreshExpiresIn: firstDefined(
        ['JWT_REMEMBER_ME_EXPIRES_IN', 'REMEMBER_ME_EXPIRES_IN'],
        { fallback: '30d' },
    ),

    // Optional reCAPTCHA v2 server-side secret. When absent, the verifier
    // skips the network check — useful in dev / automated tests. In
    // production, set this to enforce CTX_master_context §AUTH reCAPTCHA v2.
    //
    // RECAPTCHA_STRICT (default 'true' when a secret is configured) —
    //   when true, a network error against Google siteverify FAILS the
    //   login (preferred for enterprise/financial posture). When false,
    //   network errors soft-allow so a Google outage doesn't lock users
    //   out. Only relevant when RECAPTCHA_SECRET is set.
    recaptcha: {
        // Accept both RECAPTCHA_SECRET (canonical) and RECAPTCHA_SECRET_KEY
        // (deployed alias) — see CLAUDE.md alias-friendly env pattern.
        secret: firstDefined(
            ['RECAPTCHA_SECRET', 'RECAPTCHA_SECRET_KEY'],
            { fallback: '' },
        ),
        verifyUrl: optional(
            'RECAPTCHA_VERIFY_URL',
            'https://www.google.com/recaptcha/api/siteverify',
        ),
        strict: optional('RECAPTCHA_STRICT', 'true') !== 'false',
    },

    // Login rate limit. CTX_architecture §SECURITY:
    // "rate limit after 5 attempts (per IP + per email)". Values are env-
    // tunable for tests that want a lower cap. Window defaults to 15 min.
    rateLimit: {
        loginWindowMs: Number(optional('LOGIN_RATE_LIMIT_WINDOW_MS',
            String(15 * 60 * 1000))),
        loginMax: Number(optional('LOGIN_RATE_LIMIT_MAX', '5')),
    },

    // HTTP request logging. Default 'info' — emits one JSON line per
    // completed request. Set 'silent' to suppress (e.g. test runs that
    // capture stdout).
    logger: {
        level: optional('LOG_LEVEL', 'info'),
    },

    corsOrigin: optional('CORS_ORIGIN', 'http://localhost:3000'),
    frontendUrl: optional('FRONTEND_URL', 'http://localhost:3000'),
    appBaseUrl: optional('APP_BASE_URL', 'https://app.interlab-portal.com'),

    // MinIO object storage. Two env var dialects are accepted:
    //
    //   1. The documented names (MINIO_ENDPOINT, MINIO_ACCESS_KEY, ...)
    //      used by .env.example.
    //   2. The deployed names (MINIO_HOST, MINIO_ROOT_USER, S3_BUCKET, ...)
    //      used by the production .env co-located with the Docker compose.
    //
    // `endpoint` may be supplied as a full URL ("https://minio.example:9000")
    // or just a hostname; the MinIO client accepts a hostname only, so the
    // URL form is stripped down to host + useSSL. Bucket names are split:
    //   * bucketAttachments — all detail-page uploads land here
    //   * bucketAvatars     — reserved for user profile images
    // When the deployment provides a single MINIO_BUCKET / S3_BUCKET, we
    // default both pools to that bucket. File storage_path keys already
    // namespace by module so shared buckets don't collide.
    minio: (() => {
        const raw = firstDefined(['MINIO_ENDPOINT', 'MINIO_HOST']);
        let host = raw;
        let urlUseSsl;
        if (raw && /^https?:\/\//i.test(raw)) {
            try {
                const u = new URL(raw);
                host = u.hostname;
                urlUseSsl = u.protocol === 'https:';
            } catch { /* fall through to raw as host */ }
        }
        const sslEnv = optional('MINIO_USE_SSL', undefined);
        const useSsl = sslEnv !== undefined
            ? sslEnv === 'true'
            : (urlUseSsl !== undefined ? urlUseSsl : false);
        const sharedBucket = firstDefined(['MINIO_BUCKET', 'S3_BUCKET']);
        return {
            endpoint: host,
            port: Number(optional('MINIO_PORT', '9000')),
            useSsl,
            accessKey: firstDefined(
                ['MINIO_ACCESS_KEY', 'S3_ACCESS_KEY', 'MINIO_ROOT_USER'],
            ),
            secretKey: firstDefined(
                ['MINIO_SECRET_KEY', 'S3_SECRET_KEY', 'MINIO_ROOT_PASSWORD'],
            ),
            bucketAttachments: firstDefined(
                ['MINIO_BUCKET_ATTACHMENTS'],
                { fallback: sharedBucket || 'attachments' },
            ),
            bucketAvatars: firstDefined(
                ['MINIO_BUCKET_AVATARS'],
                { fallback: sharedBucket || 'avatars' },
            ),
            publicUrl: optional('MINIO_PUBLIC_URL', ''),
        };
    })(),

    // File upload constraints. Mirrors the MultiFileUpload frontend component
    // so the backend rejects the same inputs the client would have blocked.
    uploads: {
        maxFileSizeMb: Number(optional('UPLOAD_MAX_FILE_SIZE_MB', '25')),
        presignedDownloadSeconds: Number(
            optional('UPLOAD_PRESIGN_DOWNLOAD_SECONDS', String(15 * 60)),
        ),
    },

    // Background job scheduler.
    //
    // SCHEDULER_ENABLED — set 'false' to disable the scheduler on this
    //   instance (tests, read-only replicas, or a multi-node deploy where
    //   only one node should own the cron triggers). Default: 'true'.
    // SCHEDULER_TIMEZONE — IANA timezone for cron expressions. Business
    //   locale is Indonesia (Asia/Jakarta); node-cron evaluates cron
    //   expressions in this zone so "daily at 08:00" fires at 08:00 WIB.
    //   Falls back to the process-level TZ env var, which is already set
    //   to Asia/Jakarta in the deployed .env.
    scheduler: {
        enabled: optional('SCHEDULER_ENABLED', 'true') !== 'false',
        timezone: optional('SCHEDULER_TIMEZONE',
            optional('TZ', 'Asia/Jakarta')),
    },

    // Redis. Used for session store and permission resolver cache (F2).
    //
    // REDIS_URL — full Redis connection URL. Defaults to localhost for
    //   local dev. In production, point at the interlab-redis container
    //   (e.g. redis://redis:6379/0). The test setup rewrites this to /1
    //   automatically so tests run against logical DB 1, not DB 0.
    // REQUIRE_REDIS — when 'true', a connection error is logged loudly and
    //   will surface in health checks. When 'false' (default) the client
    //   degrades silently — callers must check isAvailable() before use.
    // PERMISSION_CACHE_TTL — TTL in seconds for cached permission lookups.
    //   Default 300 s (5 min). Raise for high-traffic deployments; lower
    //   for environments that need prompt permission propagation.
    redis: {
        url: optional('REDIS_URL', 'redis://localhost:6379'),
        required: optional('REQUIRE_REDIS', 'false') === 'true',
        ttlSeconds: Number(optional('PERMISSION_CACHE_TTL', '300')),
    },

    // SMTP transport config — used by the smtp adapter in email-providers/.
    // Accepts the documented `SMTP_PASS` plus the deployed alias
    // `SMTP_PASSWORD` so the production .env can stay unmodified.
    smtp: {
        host: optional('SMTP_HOST', 'localhost'),
        port: Number(optional('SMTP_PORT', '587')),
        secure: optional('SMTP_SECURE', 'false') === 'true',
        user: optional('SMTP_USER', null),
        pass: optional('SMTP_PASS', null) || optional('SMTP_PASSWORD', null),
    },

    // High-level email delivery config — provider selection and default
    // sender identity. Accepts the deployed `SMTP_FROM_*` aliases alongside
    // the documented `EMAIL_FROM_*` names so resolveDefaultSender() picks up
    // whichever pair is set in .env.
    email: {
        fromName: optional('EMAIL_FROM_NAME', null) || optional('SMTP_FROM_NAME', 'Interlab Notifications'),
        fromAddress: optional('EMAIL_FROM_ADDRESS', null) || optional('SMTP_FROM_EMAIL', null),
        replyTo: optional('EMAIL_REPLY_TO', null),
        provider: optional('EMAIL_PROVIDER', 'smtp'),
    },

    // Two-factor authentication encryption.
    //
    // TWO_FACTOR_ENCRYPTION_KEY — 64 hex chars (32 bytes) used to AES-256-GCM-
    //   encrypt TOTP secrets at rest. Required when any user has TOTP enabled.
    //   Treat as a stable production secret like JWT_SECRET — rotation
    //   invalidates existing encrypted secrets.
    twoFactor: {
        encryptionKey: optional('TWO_FACTOR_ENCRYPTION_KEY', ''),
    },

    // Gmail SMTP via app password (pinned host smtp.gmail.com:465).
    gmail: {
        user: optional('GMAIL_USER', null),
        appPassword: optional('GMAIL_APP_PASSWORD', null),
    },

    // AWS SES. Credentials are optional — when absent the SES client uses
    // the default credential chain (IAM role, env vars, etc.).
    ses: {
        region: optional('AWS_REGION', 'ap-southeast-1'),
        accessKeyId: optional('AWS_ACCESS_KEY_ID', null),
        secretAccessKey: optional('AWS_SECRET_ACCESS_KEY', null),
    },
};
