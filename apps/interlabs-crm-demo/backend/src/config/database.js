'use strict';

const { Pool } = require('pg');
const env = require('./env');

const pool = new Pool({
    connectionString: env.databaseUrl,
    max: 20,
    idleTimeoutMillis: 30_000,
    connectionTimeoutMillis: 5_000,
});

pool.on('error', (err) => {
    // eslint-disable-next-line no-console
    console.error('[pg] unexpected pool error', err);
});

async function query(text, params) {
    return pool.query(text, params);
}

async function withTransaction(fn) {
    const client = await pool.connect();
    try {
        await client.query('BEGIN');
        const result = await fn(client);
        await client.query('COMMIT');
        return result;
    } catch (err) {
        try { await client.query('ROLLBACK'); } catch (_) { /* ignore */ }
        throw err;
    } finally {
        client.release();
    }
}

module.exports = { pool, query, withTransaction };
