'use strict';

const express = require('express');
const cors = require('cors');
const helmet = require('helmet');

const env = require('./config/env');
const { errorHandler } = require('./middleware/errorHandler.middleware');
const { requestLogger } = require('./middleware/requestLogger.middleware');
const authRoutes = require('./routes/auth.routes');
const salesRoutes = require('./routes/sales.routes');
const financeRoutes = require('./routes/finance.routes');
const adminLogRoutes = require('./routes/admin_log.routes');
const technicalRoutes = require('./routes/technical.routes');
const hrgaRoutes = require('./routes/hrga.routes');
const taxRoutes = require('./routes/tax.routes');
const filesRoutes = require('./routes/files.routes');
const activityLogRoutes = require('./routes/activity_log.routes');
const settingsRoutes = require('./routes/settings.routes');
const avatarRoutes = require('./routes/users/me-avatar.routes');
const scheduler = require('./jobs/scheduler');
const websocket = require('./websocket');

const app = express();

// Trust the first hop proxy (Traefik in the deployed setup) so req.ip
// reflects the real client IP. Single-hop is the norm here; if multiple
// proxies are chained, increase the count accordingly.
app.set('trust proxy', 1);

// Middleware stack per CTX_architecture §BACKEND ARCHITECTURE:
//   1. CORS (+ helmet security headers)
//   2. Request logger (assigns req.id, times each request)
//   3. Body parser
//   (route-level: rate limiter → JWT auth → RBAC → validator → handler)
//   4. Error handler (registered last)
app.use(cors({ origin: env.corsOrigin, credentials: true }));
app.use(helmet({
    // The API does not serve HTML; disabling CSP avoids a spurious
    // security header on JSON responses. All other helmet defaults
    // (HSTS, X-Content-Type-Options, X-Frame-Options, etc.) remain on.
    contentSecurityPolicy: false,
    // Don't set cross-origin-resource-policy=same-origin on an API that
    // is consumed cross-origin by the SPA; the CORS layer already
    // controls origin access.
    crossOriginResourcePolicy: false,
}));
app.use(requestLogger);
app.use(express.json({ limit: '1mb' }));

app.get('/health', (_req, res) => res.json({ success: true, data: { status: 'ok' } }));

app.use('/api/auth', authRoutes);
app.use('/api/sales', salesRoutes);
app.use('/api/finance', financeRoutes);
app.use('/api/admin-log', adminLogRoutes);
app.use('/api/technical', technicalRoutes);
app.use('/api/hrga', hrgaRoutes);
app.use('/api/tax', taxRoutes);
app.use('/api/files', filesRoutes);
app.use('/api/activity-logs', activityLogRoutes);
app.use('/api/settings', settingsRoutes);
app.use('/api/admin', require('./routes/admin/levels.routes'));
app.use('/api/admin', require('./routes/admin/overrides.routes'));
app.use('/api/admin', require('./routes/admin/permissions.routes'));
app.use('/api/admin', require('./routes/admin/invitations.routes'));
app.use('/api/admin', require('./routes/admin/reset-to-backup.routes'));
app.use('/api/po', require('./routes/po/stage.routes'));
app.use('/api/admin/po-document-types', require('./routes/admin/po-document-types.routes'));
app.use('/api/admin/notification-senders', require('./routes/admin/notification-senders.routes'));
app.use('/api/admin/notification-templates', require('./routes/admin/notification-templates.routes'));
app.use('/api/auth', require('./routes/auth/activate.routes'));
app.use('/api/auth', require('./routes/auth/changePassword.routes'));
app.use('/api/auth', require('./routes/auth/forgotPassword.routes'));
app.use('/api/auth', require('./routes/auth/twofactor.routes'));
app.use('/api/users/me/avatar', avatarRoutes.router);
app.use('/api/users/me/profile', require('./routes/users/me-profile.routes'));
app.use('/api/users/me/notifications', require('./routes/users/me-notifications.routes'));
app.use('/api/users', avatarRoutes.idRouter);
app.use('/api/users', require('./routes/users/users.routes'));
app.use('/api/notifications', require('./routes/notifications.routes'));
app.use('/api/chat', require('./routes/chat.routes'));
app.use('/api/po-tracking', require('./routes/po-tracking.routes'));

// 404 for unmatched API routes (falls through to non-API 404 handled by clients).
app.use('/api', (_req, res) => {
    res.status(404).json({ success: false, error: 'Route not found', code: 'not_found' });
});

app.use(errorHandler);

if (require.main === module) {
    // Warm up the Redis connection before the first request arrives. The
    // 2FA login path needs Redis ready to issue a pending_token; lazy init
    // on first request fails because `enableOfflineQueue: false` makes
    // commands throw before the handshake completes.
    require('./config/redis').getRedis();

    const server = app.listen(env.port, () => {
        // eslint-disable-next-line no-console
        console.log(`[api] listening on :${env.port} (${env.nodeEnv})`);
    });

    // Start the background job scheduler on the same process as the API.
    // For horizontal scaling, set SCHEDULER_ENABLED=false on every node
    // except the one designated to own the cron triggers.
    scheduler.start();

    // Attach the WebSocket server to the same HTTP listener (shared port,
    // shared TLS). /api/ws is the only path it owns; all other upgrade
    // requests fall through untouched.
    const wsHandle = websocket.attach(server);

    // Graceful shutdown: stop the WS server, the scheduler, and the HTTP
    // server before letting Node exit so in-flight jobs, requests, and
    // open WS connections finish cleanly.
    const shutdown = (signal) => {
        // eslint-disable-next-line no-console
        console.log(`[api] received ${signal}, shutting down`);
        wsHandle.close();
        scheduler.stop();
        server.close(() => process.exit(0));
        // Hard-exit fallback if a connection is hung past 10s.
        setTimeout(() => process.exit(1), 10_000).unref();
    };
    process.on('SIGTERM', () => shutdown('SIGTERM'));
    process.on('SIGINT', () => shutdown('SIGINT'));
}

module.exports = app;
