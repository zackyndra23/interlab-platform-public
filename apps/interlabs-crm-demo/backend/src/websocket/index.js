'use strict';

// Public entry for the WebSocket layer.
//
// Domain services should import from `../websocket` (this file) rather
// than reaching into `emitter.js` / `server.js` directly — keeps the
// internal split free to change.

const { attach } = require('./server');
const emitter = require('./emitter');
const state = require('./state');

module.exports = {
    attach,
    // Re-exported fan-out helpers.
    sendToUser: emitter.sendToUser,
    sendToUsers: emitter.sendToUsers,
    sendToRole: emitter.sendToRole,
    broadcastAll: emitter.broadcastAll,
    // Introspection for ops / tests.
    snapshot: state.snapshot,
};
