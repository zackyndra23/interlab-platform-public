'use strict';
// Global teardown: runs once after ALL test files have completed, regardless
// of how many test files there are. This is the correct place for shared
// resource cleanup (pg pool, Redis client) in a vitest singleFork run.
//
// Registered via vitest.config.js globalSetup. The exported teardown function
// is called by vitest after all test suites finish.

async function setup() {
    // nothing to set up globally — env is handled by setupFiles (test/setup.js)
}

async function teardown() {
    try {
        const { close: closeDb } = require('./helpers/db');
        await closeDb();
    } catch { /* pool may already be closed */ }
    try {
        const { close: closeRedis } = require('../src/config/redis');
        await closeRedis();
    } catch { /* redis may not have been required by any test */ }
}

module.exports = setup;
module.exports.teardown = teardown;
