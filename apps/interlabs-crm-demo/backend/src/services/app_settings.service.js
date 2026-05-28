'use strict';

const db = require('../config/database');

function groupByDotPrefix(rows) {
    const out = {};
    for (const { key, value } of rows) {
        const dot = key.indexOf('.');
        if (dot === -1) {
            out[key] = value;
            continue;
        }
        const group = key.slice(0, dot);
        const rest = key.slice(dot + 1);
        if (!out[group]) out[group] = {};
        out[group][rest] = value;
    }
    return out;
}

async function getAll() {
    const { rows } = await db.query('SELECT key, value FROM app_settings');
    const grouped = groupByDotPrefix(rows);
    if (!grouped.general) grouped.general = {};
    if (!grouped.email)   grouped.email = {};
    return grouped;
}

async function getByKey(key) {
    const { rows } = await db.query(
        'SELECT value FROM app_settings WHERE key = $1',
        [key],
    );
    return rows.length ? rows[0].value : null;
}

async function set(key, value, userId) {
    await db.query(
        `INSERT INTO app_settings (key, value, updated_by, updated_at)
         VALUES ($1, $2::jsonb, $3, now())
         ON CONFLICT (key)
         DO UPDATE SET value = EXCLUDED.value,
                       updated_by = EXCLUDED.updated_by,
                       updated_at = now()`,
        [key, JSON.stringify(value), userId || null],
    );
}

async function setMany(entries, userId) {
    if (!Array.isArray(entries) || entries.length === 0) return 0;
    return db.withTransaction(async (client) => {
        for (const [key, value] of entries) {
            await client.query(
                `INSERT INTO app_settings (key, value, updated_by, updated_at)
                 VALUES ($1, $2::jsonb, $3, now())
                 ON CONFLICT (key)
                 DO UPDATE SET value = EXCLUDED.value,
                               updated_by = EXCLUDED.updated_by,
                               updated_at = now()`,
                [key, JSON.stringify(value), userId || null],
            );
        }
        return entries.length;
    });
}

module.exports = { getAll, getByKey, set, setMany };
