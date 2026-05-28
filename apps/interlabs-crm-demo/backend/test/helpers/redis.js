'use strict';
const { getRedis } = require('../../src/config/redis');

async function flushTestKeys(prefix = 'perm:') {
    const redis = getRedis();
    const keys = await redis.keys(`${prefix}*`);
    if (keys.length) await redis.del(...keys);
}

module.exports = { flushTestKeys };
