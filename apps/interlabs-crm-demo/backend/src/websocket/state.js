'use strict';

// Shared WebSocket runtime state.
//
// Kept in a standalone module so `server.js` (which writes to it on
// connect/disconnect) and `emitter.js` (which reads it to fan out pushes)
// stay decoupled — neither pulls in the other, avoiding circular deps.
//
// Shape:
//   userConnections: Map<userId, Set<WebSocket>>
//     One user may have N concurrent connections (multiple browser tabs,
//     desktop + mobile). Every send-to-user call iterates the Set.
//
//   roleIndex: Map<roleKey, Set<userId>>
//     Cache of role → users. Populated lazily on first connect for each
//     role to avoid a per-push DB lookup on sendToRole(). Invalidated
//     when a user with that role disconnects AND no other user with that
//     role remains connected — cheap because role memberships change at
//     admin time, not request time.
//
//   wss: WebSocketServer instance, set by server.attach().

const state = {
    userConnections: new Map(),
    roleIndex: new Map(),
    wss: null,
};

// Track when each user's first WS connection was established.
// Key: userId (string), Value: Date
const connectedSince = new Map();

function registerConnection(userId, role, ws) {
    let set = state.userConnections.get(userId);
    if (!set) {
        set = new Set();
        state.userConnections.set(userId, set);
    }
    set.add(ws);
    if (!connectedSince.has(userId)) connectedSince.set(userId, new Date());

    if (role) {
        let roleSet = state.roleIndex.get(role);
        if (!roleSet) {
            roleSet = new Set();
            state.roleIndex.set(role, roleSet);
        }
        roleSet.add(userId);
    }
}

function unregisterConnection(userId, role, ws) {
    const set = state.userConnections.get(userId);
    if (set) {
        set.delete(ws);
        if (set.size === 0) {
            state.userConnections.delete(userId);
            connectedSince.delete(userId);
            if (role) {
                const roleSet = state.roleIndex.get(role);
                if (roleSet) {
                    roleSet.delete(userId);
                    if (roleSet.size === 0) state.roleIndex.delete(role);
                }
            }
        }
    }
}

function getUserConnections(userId) {
    return state.userConnections.get(userId) || null;
}

function getConnectedUserIds() {
    return [...state.userConnections.keys()];
}

function getConnectionCount(userId) {
    const set = state.userConnections.get(userId);
    return set ? set.size : 0;
}

function getUsersForRole(role) {
    return state.roleIndex.get(role) || null;
}

function setServer(wss) {
    state.wss = wss;
}

function getServer() {
    return state.wss;
}

function snapshot() {
    return {
        users_connected: state.userConnections.size,
        total_connections: [...state.userConnections.values()]
            .reduce((n, s) => n + s.size, 0),
        roles_indexed: state.roleIndex.size,
    };
}

function getConnectedSince(userId) {
    return connectedSince.get(userId) || null;
}

function reset() {
    state.userConnections.clear();
    state.roleIndex.clear();
    connectedSince.clear();
    state.wss = null;
}

module.exports = {
    registerConnection,
    unregisterConnection,
    getUserConnections,
    getConnectedUserIds,
    getConnectionCount,
    getConnectedSince,
    getUsersForRole,
    setServer,
    getServer,
    snapshot,
    reset,
};
