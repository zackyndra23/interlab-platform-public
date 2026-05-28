'use strict';
const Redis = require('ioredis');
const env = require('./env');

let client = null;

// `getRedis()` lazily creates the client on first call. Boot code should
// invoke it once so the connection warms up before the first request that
// needs it (otherwise `isAvailable()` will return false on cold paths and
// 2FA login will fail with a 422 before Redis ever connects).
function getRedis() {
    if (client) return client;

    client = new Redis(env.redis.url, {
        lazyConnect: false,
        maxRetriesPerRequest: 2,
        enableOfflineQueue: false,
    });

    client.on('error', (err) => {
        if (env.redis.required) {
            console.error('[redis] connection error:', err.message);
        }
    });

    return client;
}

// `client.status` is authoritative: 'ready' means the handshake has finished
// and commands will succeed. Any other state ('connecting', 'reconnecting',
// 'end', 'close', 'wait') means commands will fail-fast (we set
// enableOfflineQueue: false so they don't queue indefinitely).
function isAvailable() {
    return Boolean(client && client.status === 'ready');
}

// Wait up to `timeoutMs` for the client to become ready. Returns true if it
// did, false on timeout. Used by 2FA login paths where a brief boot-warming
// delay is preferable to a hard 422 on the first request after process start.
function awaitReady(timeoutMs = 1500) {
    const c = getRedis();
    if (c.status === 'ready') return Promise.resolve(true);
    return new Promise((resolve) => {
        const onReady = () => { clearTimeout(t); resolve(true); };
        const t = setTimeout(() => {
            c.removeListener('ready', onReady);
            resolve(false);
        }, timeoutMs);
        c.once('ready', onReady);
    });
}

async function close() {
    if (client) {
        await client.quit().catch(() => {});
        client = null;
    }
}

module.exports = { getRedis, isAvailable, awaitReady, close };
