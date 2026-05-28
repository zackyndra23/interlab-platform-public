'use strict';

const WebSocket = require('ws');

const state = require('./state');

// Fan-out helpers consumed by domain services (NotificationService,
// ChatService, POService) per IMPL_backend §B8.
//
// All sends are best-effort and non-blocking. If a user has no open
// connection, the message is silently dropped — the dashboard REST
// endpoints (notifications list, chat history) remain authoritative on
// next page load. The WS layer is a push optimisation, not a durability
// guarantee.
//
// Payload envelope: every outbound frame is `{ event, data, ts }` so the
// frontend can subscribe to a single message handler and dispatch on
// `event`. Matches CTX_architecture §WEBSOCKET EVENT CATALOGUE event
// names (notification:new, chat:message, etc.).

function serialize(event, data) {
    return JSON.stringify({
        event,
        data: data || {},
        ts: new Date().toISOString(),
    });
}

function safeSend(ws, frame) {
    if (ws.readyState !== WebSocket.OPEN) return false;
    try {
        ws.send(frame);
        return true;
    } catch (_err) {
        // Socket may have closed between readyState check and send; drop.
        return false;
    }
}

/**
 * Send a single event to every open connection for a user.
 * Returns the number of frames actually transmitted.
 */
function sendToUser(userId, event, data) {
    if (!userId) return 0;
    const conns = state.getUserConnections(userId);
    if (!conns || conns.size === 0) return 0;
    const frame = serialize(event, data);
    let sent = 0;
    for (const ws of conns) {
        if (safeSend(ws, frame)) sent += 1;
    }
    return sent;
}

function sendToUsers(userIds, event, data) {
    if (!Array.isArray(userIds) || userIds.length === 0) return 0;
    const frame = serialize(event, data);
    let sent = 0;
    for (const userId of userIds) {
        const conns = state.getUserConnections(userId);
        if (!conns) continue;
        for (const ws of conns) {
            if (safeSend(ws, frame)) sent += 1;
        }
    }
    return sent;
}

/**
 * Send to every connected user holding a given role_key. Backed by the
 * in-memory roleIndex (populated at connect time) so no DB query per
 * broadcast. Users not currently connected are skipped — the REST layer
 * still serves them the data on next pull.
 */
function sendToRole(role, event, data) {
    const users = state.getUsersForRole(role);
    if (!users || users.size === 0) return 0;
    const frame = serialize(event, data);
    let sent = 0;
    for (const userId of users) {
        const conns = state.getUserConnections(userId);
        if (!conns) continue;
        for (const ws of conns) {
            if (safeSend(ws, frame)) sent += 1;
        }
    }
    return sent;
}

/**
 * Broadcast to every connected user. Used sparingly — most domain events
 * route through sendToUser / sendToRole.
 */
function broadcastAll(event, data) {
    const wss = state.getServer();
    if (!wss) return 0;
    const frame = serialize(event, data);
    let sent = 0;
    for (const ws of wss.clients) {
        if (safeSend(ws, frame)) sent += 1;
    }
    return sent;
}

module.exports = {
    sendToUser,
    sendToUsers,
    sendToRole,
    broadcastAll,
    // Exposed for tests.
    serialize,
};
