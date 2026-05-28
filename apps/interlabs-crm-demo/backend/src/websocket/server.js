'use strict';

const { URL } = require('url');
const jwt = require('jsonwebtoken');
const { WebSocketServer } = require('ws');

const env = require('../config/env');
const db = require('../config/database');
const state = require('./state');
const emitter = require('./emitter');
const { handleIncoming } = require('./handlers');

// WebSocket server — bound to the existing HTTP server (shared port).
// Upgrade authentication runs before the WebSocket is upgraded: a
// failing JWT verification or a missing/suspended user closes the socket
// with a 1008 policy-violation code before any message frame is read.
//
// Design notes:
//   - Shares the HTTP server port (same host/TLS) so operators don't
//     deploy a second process.
//   - `noServer: true` + manual `server.on('upgrade')` handler keeps
//     HTTP and WS routing under our control (and lets us scope the
//     /api/ws path to WebSocket upgrades only).
//   - JWT is accepted via Authorization header (preferred) or
//     ?token=<jwt> query string — browsers can't set custom headers on
//     the native WebSocket API, so the query-param path is essential
//     for frontend parity.
//   - Heartbeat: 30s server-initiated ping; clients missing two
//     consecutive pongs are terminated. Keeps the connection map tight
//     and surfaces dead NAT-traversal paths promptly.

const WS_PATH = '/api/ws';
const HEARTBEAT_INTERVAL_MS = 30_000;
const AUTH_FAIL_CODE = 1008;   // WS policy violation
const SHUTDOWN_CODE = 1001;    // WS going away

// ---------------------------------------------------------------------------
// HANDSHAKE AUTHENTICATION
// ---------------------------------------------------------------------------

function extractToken(req) {
    // 1. Authorization: Bearer <token>
    const auth = req.headers['authorization'] || '';
    if (auth.startsWith('Bearer ')) {
        return auth.slice('Bearer '.length).trim();
    }
    // 2. ?token=<jwt> query param
    try {
        const url = new URL(req.url, 'http://placeholder');
        const q = url.searchParams.get('token');
        if (q) return q.trim();
    } catch (_err) { /* fall through */ }
    return null;
}

async function authenticateUpgrade(req) {
    const token = extractToken(req);
    if (!token) throw new Error('missing token');

    let payload;
    try {
        payload = jwt.verify(token, env.jwt.secret, { algorithms: ['HS256'] });
    } catch (_err) {
        throw new Error('invalid token');
    }
    const userId = payload.sub || payload.userId || payload.id;
    if (!userId) throw new Error('token missing subject');

    const { rows } = await db.query(
        `SELECT id, email, role, display_name, account_status, deleted_at
           FROM users
          WHERE id = $1`,
        [userId],
    );
    if (rows.length === 0) throw new Error('user not found');
    const user = rows[0];
    if (user.deleted_at !== null || user.account_status !== 'active') {
        throw new Error('account not active');
    }
    return {
        userId: user.id,
        email: user.email,
        role: user.role,
        displayName: user.display_name,
    };
}

// ---------------------------------------------------------------------------
// HEARTBEAT
// ---------------------------------------------------------------------------

function startHeartbeat(wss) {
    const iv = setInterval(() => {
        for (const ws of wss.clients) {
            // `isAlive` flips to false when we ping; the client's pong
            // flips it back to true. A false still-false means we missed
            // two cycles → drop the connection.
            if (ws.isAlive === false) {
                ws.terminate();
                continue;
            }
            ws.isAlive = false;
            try { ws.ping(); } catch (_err) { ws.terminate(); }
        }
    }, HEARTBEAT_INTERVAL_MS);
    iv.unref(); // don't block Node exit on the heartbeat timer
    return iv;
}

// ---------------------------------------------------------------------------
// LIFECYCLE
// ---------------------------------------------------------------------------

function onConnection(ws, userContext) {
    ws.userContext = userContext;
    ws.isAlive = true;

    state.registerConnection(userContext.userId, userContext.role, ws);

    ws.on('pong', () => { ws.isAlive = true; });

    ws.on('message', async (raw) => {
        // `ws` can emit Buffer or string depending on binaryType; coerce.
        const text = typeof raw === 'string' ? raw : raw.toString('utf8');
        if (text.length > 32_000) {
            try {
                ws.send(JSON.stringify({
                    event: 'ws:error',
                    data: { message: 'frame too large' },
                    ts: new Date().toISOString(),
                }));
            } catch (_err) { /* ignore */ }
            return;
        }
        await handleIncoming(ws, text);
    });

    ws.on('close', () => {
        state.unregisterConnection(
            userContext.userId, userContext.role, ws,
        );
    });

    ws.on('error', () => {
        // Error event is almost always followed by 'close'; unregister
        // is handled there. Log for observability only.
    });

    // Server → Client hello so the frontend knows auth succeeded and can
    // reset its reconnect-backoff counter.
    try {
        ws.send(JSON.stringify({
            event: 'ws:connected',
            data: {
                user_id: userContext.userId,
                role: userContext.role,
            },
            ts: new Date().toISOString(),
        }));
    } catch (_err) { /* socket died between open and send */ }
}

/**
 * Bind the WebSocket server to the given HTTP server. Returns an object
 * with a `close()` method for graceful shutdown.
 */
function attach(httpServer) {
    if (state.getServer()) {
        // eslint-disable-next-line no-console
        console.log('[ws] attach() called twice, ignoring');
        return { close: () => {} };
    }
    const wss = new WebSocketServer({ noServer: true });
    state.setServer(wss);

    httpServer.on('upgrade', async (req, socket, head) => {
        // Only own the /api/ws path. Any other upgrade request is left
        // alone so a future second WebSocket endpoint (or HTTP/2 support)
        // can slot in without this handler swallowing it.
        let pathname;
        try {
            pathname = new URL(req.url, 'http://placeholder').pathname;
        } catch (_err) {
            socket.destroy();
            return;
        }
        if (pathname !== WS_PATH) return;

        let userContext;
        try {
            userContext = await authenticateUpgrade(req);
        } catch (err) {
            // Reject BEFORE completing the upgrade. ws doesn't provide a
            // clean way to send a JSON body here; a plain HTTP 401 with
            // the error reason is clearest for the client.
            const reason = err.message || 'unauthorized';
            socket.write(
                'HTTP/1.1 401 Unauthorized\r\n'
                + 'Content-Type: text/plain\r\n'
                + `Content-Length: ${Buffer.byteLength(reason)}\r\n`
                + 'Connection: close\r\n'
                + '\r\n'
                + reason,
            );
            socket.destroy();
            return;
        }

        wss.handleUpgrade(req, socket, head, (ws) => {
            wss.emit('connection', ws, req);
            onConnection(ws, userContext);
        });
    });

    const heartbeatTimer = startHeartbeat(wss);

    // eslint-disable-next-line no-console
    console.log(`[ws] attached at ${WS_PATH}`);

    return {
        close() {
            clearInterval(heartbeatTimer);
            for (const ws of wss.clients) {
                try { ws.close(SHUTDOWN_CODE, 'server shutting down'); }
                catch (_err) { /* ignore */ }
            }
            wss.close();
            state.reset();
        },
        snapshot: state.snapshot,
        emitter,
    };
}

module.exports = {
    attach,
    WS_PATH,
    // Exposed for tests.
    authenticateUpgrade,
    extractToken,
};
