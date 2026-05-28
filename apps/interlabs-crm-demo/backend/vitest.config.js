'use strict';
const { defineConfig } = require('vitest/config');

module.exports = defineConfig({
  test: {
    environment: 'node',
    globals: true,                // CJS-friendly; describe/it/expect are global
    include: ['test/**/*.test.js'],
    setupFiles: ['./test/setup.js'],
    globalSetup: ['./test/global-teardown.js'],
    pool: 'forks',
    poolOptions: { forks: { singleFork: true } }, // serial — shared DB
    testTimeout: 15000,           // generous for migration tests in tasks 1.2+
    clearMocks: true,             // reset mock.calls between tests
    restoreMocks: true,           // restore original implementations
  },
});
