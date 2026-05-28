'use strict';

// Blocks until the configured DATABASE_URL accepts a trivial SELECT.
// Gives the backend container a clean retry loop during first boot.

const { Pool } = require('pg');

async function waitFor(timeoutMs = 60_000, pollMs = 1_500) {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('[wait-for-postgres] DATABASE_URL is not set');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: databaseUrl, max: 1 });
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
        try {
            await pool.query('SELECT 1');
            await pool.end();
            console.log('[wait-for-postgres] ready');
            return;
        } catch (err) {
            console.log(`[wait-for-postgres] not ready: ${err.message}`);
            await new Promise((r) => setTimeout(r, pollMs));
        }
    }
    await pool.end().catch(() => {});
    console.error('[wait-for-postgres] timed out');
    process.exit(1);
}

waitFor().catch((err) => {
    console.error('[wait-for-postgres] fatal', err);
    process.exit(1);
});
