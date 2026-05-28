'use strict';
const path = require('path');
require('dotenv').config({ path: path.resolve(__dirname, '../../.env') });
process.env.NODE_ENV = 'test';

// Derive test DB and Redis URLs from production .env at runtime so credentials
// stay only in the original .env file. Test DB is `crmdemo_test` on the same
// Postgres instance as DATABASE_URL — connection params (sslmode, etc.) transfer
// via URL parsing.
function deriveTestDbUrl(prodUrl) {
  if (!prodUrl) return prodUrl;
  const u = new URL(prodUrl);
  if (!u.pathname || u.pathname === '/' || u.pathname.includes('/', 1)) {
    throw new Error(
      `DATABASE_URL must include a single dbname segment (got pathname=${JSON.stringify(u.pathname)})`
    );
  }
  u.pathname = '/crmdemo_test';
  return u.toString();
}

function deriveTestRedisUrl(prodUrl) {
  if (!prodUrl) return prodUrl;
  const u = new URL(prodUrl);
  u.pathname = '/1';
  return u.toString();
}

if (process.env.DATABASE_URL) process.env.DATABASE_URL = deriveTestDbUrl(process.env.DATABASE_URL);
if (process.env.REDIS_URL)    process.env.REDIS_URL    = deriveTestRedisUrl(process.env.REDIS_URL);

// Defensive guards: refuse to run if rewrite didn't land where expected.
if (process.env.DATABASE_URL && !/\/crmdemo_test(\?|$)/.test(process.env.DATABASE_URL)) {
  throw new Error('Refusing to run tests: DATABASE_URL did not rewrite to /crmdemo_test');
}
if (process.env.REDIS_URL && !/\/1(\?|$)/.test(process.env.REDIS_URL)) {
  throw new Error('Refusing to run tests: REDIS_URL did not rewrite to /1');
}

// Teardown is handled by test/global-teardown.js (vitest globalSetup teardown
// export) so it fires exactly once after ALL test files complete, not per-file.
// Do NOT add afterAll(close) here — it would fire between test files and close
// shared resources before later test files have a chance to use them.
