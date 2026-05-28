'use strict';
const { Pool } = require('pg');
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  application_name: 'crmdemo-tests',
});

async function withTx(fn) {
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    try {
      return await fn(client);
    } finally {
      await client.query('ROLLBACK');
    }
  } finally {
    client.release();
  }
}

async function close() {
  if (pool.ending || pool.ended) return;
  await pool.end();
}

module.exports = { pool, withTx, close };
