'use strict';

// Simple migration runner for the demo deployment.
//
// - Reads every .sql file under migrations/, sorted by filename.
// - Tracks applied filenames in a schema_migrations table.
// - Each migration file is expected to contain a "-- +migrate Up" / "-- +migrate Down"
//   pair. Only the Up section is executed; everything after "-- +migrate Down" is
//   ignored.
// - Idempotent: files already recorded in schema_migrations are skipped.
// - Exits non-zero on any failure so the container entrypoint aborts startup.

const fs = require('fs');
const path = require('path');
const { Pool } = require('pg');

const MIGRATIONS_DIR = path.resolve(__dirname, '..', 'migrations');

function splitUp(sql) {
    const upIdx = sql.indexOf('-- +migrate Up');
    const downIdx = sql.indexOf('-- +migrate Down');
    const start = upIdx >= 0 ? upIdx + '-- +migrate Up'.length : 0;
    const end = downIdx >= 0 ? downIdx : sql.length;
    return sql.slice(start, end).trim();
}

async function run() {
    const databaseUrl = process.env.DATABASE_URL;
    if (!databaseUrl) {
        console.error('[migrate] DATABASE_URL is not set');
        process.exit(1);
    }
    const pool = new Pool({ connectionString: databaseUrl });

    await pool.query(`
        CREATE TABLE IF NOT EXISTS schema_migrations (
            filename   text         PRIMARY KEY,
            applied_at timestamptz  NOT NULL DEFAULT now()
        )
    `);

    const files = fs.readdirSync(MIGRATIONS_DIR)
        .filter((f) => f.endsWith('.sql'))
        .sort();

    const { rows: appliedRows } = await pool.query('SELECT filename FROM schema_migrations');
    const applied = new Set(appliedRows.map((r) => r.filename));

    for (const file of files) {
        if (applied.has(file)) {
            console.log(`[migrate] skip  ${file}`);
            continue;
        }
        const sqlPath = path.join(MIGRATIONS_DIR, file);
        const raw = fs.readFileSync(sqlPath, 'utf8');
        const sqlUp = splitUp(raw);
        console.log(`[migrate] apply ${file}`);
        const client = await pool.connect();
        try {
            await client.query(sqlUp);
            await client.query(
                'INSERT INTO schema_migrations (filename) VALUES ($1)',
                [file],
            );
        } catch (err) {
            console.error(`[migrate] FAILED ${file}: ${err.message}`);
            client.release();
            await pool.end();
            process.exit(1);
        }
        client.release();
    }
    await pool.end();
    console.log('[migrate] done');
}

run().catch((err) => {
    console.error('[migrate] fatal', err);
    process.exit(1);
});
