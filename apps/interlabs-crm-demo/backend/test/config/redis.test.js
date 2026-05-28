'use strict';
const { getRedis, isAvailable, close } = require('../../src/config/redis');

// Wait for the Redis client to reach the 'ready' state before tests run.
// The client uses enableOfflineQueue:false so commands issued before the
// connection is established will throw — we must wait for 'ready'.
beforeAll(async () => {
    const redis = getRedis();
    if (!isAvailable()) {
        await new Promise((resolve, reject) => {
            const onReady = () => { redis.off('error', onError); resolve(); };
            const onError = (e) => { redis.off('ready', onReady); reject(e); };
            redis.once('ready', onReady);
            redis.once('error', onError);
        });
    }
});

describe('redis client', () => {
    it('returns a client when REDIS_URL is reachable', async () => {
        const redis = getRedis();
        expect(redis).not.toBeNull();
        const pong = await redis.ping();
        expect(pong).toBe('PONG');
    });

    it('reports availability status', () => {
        expect(typeof isAvailable()).toBe('boolean');
    });
});
