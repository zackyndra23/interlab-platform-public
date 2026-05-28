'use strict';
const db = require('../config/database');
const factory = require('./email-providers/factory');

const MAX_ATTEMPTS = 5;

/**
 * Process a single claimed email_queue row (status already set to 'processing').
 * Resolves the sender from row.sender_id (or falls back to the default configured sender).
 *
 * On success:  marks row 'sent'.
 * On failure:  increments attempts; marks 'failed' at MAX_ATTEMPTS, otherwise
 *              resets to 'pending' with next_retry_at set via exponential backoff
 *              (1m, 2m, 4m, 8m … doubling each attempt, capped by MAX_ATTEMPTS).
 */
async function processOne(row) {
    let sender = null;
    if (row.sender_id) {
        const r = await db.query(
            `SELECT * FROM notification_senders WHERE id=$1 AND is_active=true`,
            [row.sender_id],
        );
        sender = r.rows[0] || null;
    }
    if (!sender) sender = await factory.resolveDefaultSender();

    try {
        await factory.sendViaSender(sender, {
            to: row.to_address,
            cc: row.cc_address || undefined,
            bcc: row.bcc_address || undefined,
            subject: row.subject,
            html: row.body_html,
        });
        await db.query(`UPDATE email_queue SET status='sent', sent_at=now() WHERE id=$1`, [row.id]);
        return { sent: true };
    } catch (err) {
        const newAttempts = row.attempts + 1;
        if (newAttempts >= MAX_ATTEMPTS) {
            await db.query(
                `UPDATE email_queue SET attempts=$2, last_error=$3, status='failed' WHERE id=$1`,
                [row.id, newAttempts, err.message?.slice(0, 500)],
            );
        } else {
            // Exponential backoff: 2^attempts minutes (1m, 2m, 4m, 8m, …)
            await db.query(
                `UPDATE email_queue
                    SET attempts=$2, last_error=$3, status='pending',
                        next_retry_at = now() + (interval '1 minute' * power(2, $2 - 1))
                  WHERE id=$1`,
                [row.id, newAttempts, err.message?.slice(0, 500)],
            );
        }
        return { sent: false, attempts: newAttempts };
    }
}

/**
 * Atomically claim up to `batchSize` eligible pending rows using
 * FOR UPDATE SKIP LOCKED so that concurrent ticks never process the same row.
 * Each claimed row is immediately set to 'processing' inside the same CTE,
 * preventing double-pickup before processOne() completes.
 */
async function tick({ batchSize = 20 } = {}) {
    const claimed = await db.query(
        `WITH claimed AS (
           SELECT id FROM email_queue
            WHERE status = 'pending'
              AND attempts < $1
              AND (next_retry_at IS NULL OR next_retry_at <= now())
            ORDER BY created_at ASC
            LIMIT $2
            FOR UPDATE SKIP LOCKED
         )
         UPDATE email_queue
            SET status = 'processing'
          WHERE id IN (SELECT id FROM claimed)
          RETURNING *`,
        [MAX_ATTEMPTS, batchSize],
    );

    const results = [];
    for (const row of claimed.rows) {
        results.push(await processOne(row));
    }
    return { processed: results.length, sent: results.filter((x) => x.sent).length };
}

module.exports = { tick, processOne, MAX_ATTEMPTS };
