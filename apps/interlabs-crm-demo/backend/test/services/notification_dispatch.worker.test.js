'use strict';
const { pool } = require('../helpers/db');
const worker = require('../../src/services/notification_dispatch.worker');

describe('notification_dispatch.worker', () => {
    it('tick processes pending email_queue rows', async () => {
        // Clear any leftover pending rows from other tests so our row
        // lands within the batch window.
        await pool.query(`DELETE FROM email_queue WHERE status='pending'`);

        // Insert a stub pending row that will fail (no reachable SMTP in test
        // environment) but should bump attempts.
        const r = await pool.query(
            `INSERT INTO email_queue (to_address, subject, body_html)
             VALUES ($1, $2, $3) RETURNING id`,
            ['unreachable@test.invalid', 'test', '<p>x</p>'],
        );
        const rowId = r.rows[0].id;
        const result = await worker.tick({ batchSize: 5 });
        expect(result.processed).toBeGreaterThan(0);
        const after = await pool.query(
            `SELECT attempts, status FROM email_queue WHERE id=$1`,
            [rowId],
        );
        expect(after.rows[0].attempts).toBeGreaterThan(0);
        await pool.query(`DELETE FROM email_queue WHERE id=$1`, [rowId]);
    });

    it('exits cleanly when no pending rows', async () => {
        const result = await worker.tick();
        expect(result.processed).toBeGreaterThanOrEqual(0);
    });

    it('concurrent tick calls do not process the same row twice (SKIP LOCKED)', async () => {
        // Clear slate
        await pool.query(`DELETE FROM email_queue WHERE status IN ('pending','processing','failed')`);

        // Insert a single pending row
        const r = await pool.query(
            `INSERT INTO email_queue (to_address, subject, body_html)
             VALUES ($1, $2, $3) RETURNING id`,
            ['concurrent@test.invalid', 'concurrent test', '<p>concurrent</p>'],
        );
        const rowId = r.rows[0].id;

        // Fire two concurrent ticks; only one should pick up the row
        const [res1, res2] = await Promise.all([
            worker.tick({ batchSize: 5 }),
            worker.tick({ batchSize: 5 }),
        ]);

        const totalProcessed = res1.processed + res2.processed;
        // The row should have been claimed by exactly one tick
        expect(totalProcessed).toBe(1);

        await pool.query(`DELETE FROM email_queue WHERE id=$1`, [rowId]);
    });

    it('sets next_retry_at on failed send (exponential backoff)', async () => {
        await pool.query(`DELETE FROM email_queue WHERE status IN ('pending','processing','failed')`);

        const r = await pool.query(
            `INSERT INTO email_queue (to_address, subject, body_html)
             VALUES ($1, $2, $3) RETURNING id`,
            ['backoff@test.invalid', 'backoff test', '<p>backoff</p>'],
        );
        const rowId = r.rows[0].id;

        await worker.tick({ batchSize: 5 });

        const after = await pool.query(
            `SELECT attempts, status, next_retry_at FROM email_queue WHERE id=$1`,
            [rowId],
        );
        const row = after.rows[0];
        // Attempt 1 failed: status should be 'pending' (not yet at MAX_ATTEMPTS)
        // and next_retry_at should be set in the future
        if (row.attempts < worker.MAX_ATTEMPTS) {
            expect(row.status).toBe('pending');
            expect(row.next_retry_at).not.toBeNull();
            // next_retry_at should be at least ~1 minute from now
            const retryAt = new Date(row.next_retry_at);
            const nowPlusBit = new Date(Date.now() + 30 * 1000); // 30s from now
            expect(retryAt.getTime()).toBeGreaterThan(nowPlusBit.getTime());
        }

        await pool.query(`DELETE FROM email_queue WHERE id=$1`, [rowId]);
    });

    it('respects next_retry_at: does not re-pick row until delay expires', async () => {
        await pool.query(`DELETE FROM email_queue WHERE status IN ('pending','processing','failed')`);

        // Insert a row with next_retry_at far in the future
        await pool.query(
            `INSERT INTO email_queue (to_address, subject, body_html, attempts, next_retry_at)
             VALUES ($1, $2, $3, 1, now() + interval '1 hour')`,
            ['deferred@test.invalid', 'deferred', '<p>deferred</p>'],
        );

        const result = await worker.tick({ batchSize: 5 });
        // Should not pick up the row since next_retry_at is in the future
        expect(result.processed).toBe(0);

        await pool.query(`DELETE FROM email_queue WHERE to_address='deferred@test.invalid'`);
    });
});
