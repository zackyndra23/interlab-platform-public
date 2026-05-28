'use strict';

// Generates auto-incremented record numbers of the form PREFIX-YYYY-NNNNN.
//
// Uniqueness is guaranteed inside a single transaction by:
//   1. Taking a PostgreSQL advisory transaction lock keyed by (table, prefix, year).
//   2. Querying the current max suffix matching the prefix/year.
//   3. Returning prefix + year + zero-padded (max + 1).
//
// Callers MUST run this inside withTransaction() so the advisory lock is held
// until the INSERT is committed. Different prefixes (different forms) never
// collide because the hash key is prefix-specific.
//
// This avoids an out-of-band sequence table and keeps the record-number
// generation entirely self-contained per migration.

const YEAR_WIDTH = 4;
const SUFFIX_WIDTH = 5;

// djb2-ish 63-bit hash → fits in BIGINT for pg_advisory_xact_lock.
function hashKey(str) {
    let hash = 0n;
    for (let i = 0; i < str.length; i += 1) {
        hash = (hash * 131n + BigInt(str.charCodeAt(i))) & 0x7fffffffffffffffn;
    }
    if (hash > 9223372036854775807n) hash -= 9223372036854775807n;
    return hash;
}

/**
 * Generate the next record number for (client, table, column, prefix, year?).
 *
 * @param {pg.PoolClient} client     Transactional client (must be inside BEGIN).
 * @param {string}        table      Target table name (e.g. 'sales_forecasts').
 * @param {string}        column     Record-number column (e.g. 'forecast_record_number').
 * @param {string}        prefix     Literal prefix, e.g. 'SF'.
 * @param {number}        [year]     4-digit year (defaults to current UTC year).
 * @returns {Promise<string>}        e.g. 'SF-2026-00042'.
 */
async function nextRecordNumber(client, table, column, prefix, year) {
    const yyyy = year ?? new Date().getUTCFullYear();
    const pattern = `${prefix}-${String(yyyy).padStart(YEAR_WIDTH, '0')}-%`;
    const lockKey = hashKey(`${table}:${column}:${prefix}:${yyyy}`).toString();

    await client.query('SELECT pg_advisory_xact_lock($1::bigint)', [lockKey]);

    const sql = `
        SELECT ${column} AS rn
          FROM ${table}
         WHERE ${column} LIKE $1
         ORDER BY ${column} DESC
         LIMIT 1
    `;
    const { rows } = await client.query(sql, [pattern]);

    let nextSuffix = 1;
    if (rows.length > 0) {
        const last = rows[0].rn;
        const tail = last.split('-').pop();
        const parsed = Number.parseInt(tail, 10);
        if (Number.isFinite(parsed)) nextSuffix = parsed + 1;
    }

    const suffix = String(nextSuffix).padStart(SUFFIX_WIDTH, '0');
    return `${prefix}-${yyyy}-${suffix}`;
}

// Convenience aliases for the Sales module prefixes defined in MOD_sales.txt.
const SALES_PREFIXES = Object.freeze({
    CUSTOMER: 'CUST',
    FORECAST: 'SF',
    QUOTATION: 'QT',
    HPP: 'HPP',
    PO: 'PO',
    PR: 'PR',
});

// Prefixes for the Admin & Log module (MOD_admin_log.txt).
const ADMIN_LOG_PREFIXES = Object.freeze({
    AWB:         'AWB',
    DELIVERY:    'DO',
    OPERATIONAL: 'OPS',
});

// Prefixes for the Technical module (MOD_technical.txt).
const TECHNICAL_PREFIXES = Object.freeze({
    JOB_ORDER: 'TJO',
    QC:        'QC',
    BAST:      'BAST',
});

// Prefixes for the HRGA / Legal module (MOD_hrga.txt).
const HRGA_PREFIXES = Object.freeze({
    LEGAL_DOCUMENT: 'LGL',
    COMPANY_LETTER: 'LTR',
    ARCHIVE:        'ARC',
});

// Prefixes for the Tax & Insurance module (MOD_tax_insurance.txt).
const TAX_PREFIXES = Object.freeze({
    OPERATIONAL: 'TAX',
});

module.exports = {
    nextRecordNumber,
    SALES_PREFIXES,
    ADMIN_LOG_PREFIXES,
    TECHNICAL_PREFIXES,
    HRGA_PREFIXES,
    TAX_PREFIXES,
};
