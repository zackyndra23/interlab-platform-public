'use strict';
const { pool } = require('../helpers/db');
const ns = require('../../src/services/notification.service');

describe('notification.emit — extras + mutes + dedupe', () => {
    let testUserId, templateId;

    beforeAll(async () => {
        const u = await pool.query(`SELECT id FROM users WHERE role='sales' LIMIT 1`);
        testUserId = u.rows[0]?.id;
        const t = await pool.query(`SELECT id, template_key FROM notification_templates LIMIT 1`);
        templateId = t.rows[0]?.id;
    });

    afterAll(async () => {
        if (testUserId && templateId) {
            await pool.query(
                `DELETE FROM notification_template_extra_recipients WHERE template_id=$1 AND user_id=$2`,
                [templateId, testUserId],
            );
            await pool.query(
                `DELETE FROM notification_user_mutes WHERE user_id=$1 AND template_id=$2`,
                [testUserId, templateId],
            );
        }
        // Clean up any notifications + email_queue rows created by these tests.
        if (testUserId) {
            const notifRows = await pool.query(
                `SELECT id FROM notifications WHERE recipient_user_id=$1 AND related_module='test'`,
                [testUserId],
            );
            const ids = notifRows.rows.map((r) => r.id);
            if (ids.length) {
                await pool.query(`DELETE FROM notification_logs WHERE notification_id = ANY($1::uuid[])`, [ids]);
                await pool.query(`DELETE FROM notifications WHERE id = ANY($1::uuid[])`, [ids]);
            }
        }
    });

    it('extra recipient receives notification beyond role expansion', async () => {
        if (!testUserId || !templateId) return;
        await pool.query(
            `INSERT INTO notification_template_extra_recipients (template_id, user_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [templateId, testUserId],
        );
        const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
        // Omit entityId so no dedupe key is written — keeps this test idempotent.
        const r = await ns.emit(null, {
            templateKey: tk.rows[0].template_key,
            title: 'test extra',
            message: 'extra recipient test',
            module: 'test', entityType: 'test',
        });
        expect(r.notificationIds.length).toBeGreaterThan(0);
        await pool.query(
            `DELETE FROM notification_template_extra_recipients WHERE template_id=$1 AND user_id=$2`,
            [templateId, testUserId],
        );
    });

    it('muted user is excluded from recipients', async () => {
        if (!testUserId || !templateId) return;
        await pool.query(
            `INSERT INTO notification_user_mutes (user_id, template_id) VALUES ($1, $2)
             ON CONFLICT DO NOTHING`,
            [testUserId, templateId],
        );
        const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
        const r = await ns.emit(null, {
            templateKey: tk.rows[0].template_key,
            title: 'test muted',
            extraRecipientUserIds: [testUserId], // even if explicitly named, mute wins
        });
        // The muted user should not receive — verify user absent from result notifications.
        if (r.notificationIds.length > 0) {
            const sent = await pool.query(
                `SELECT 1 FROM notifications WHERE id = ANY($1::uuid[]) AND recipient_user_id=$2`,
                [r.notificationIds, testUserId],
            );
            expect(sent.rowCount).toBe(0);
        }
        await pool.query(
            `DELETE FROM notification_user_mutes WHERE user_id=$1 AND template_id=$2`,
            [testUserId, templateId],
        );
    });

    it('dedupe window suppresses duplicate emits within 60s', async () => {
        if (!testUserId || !templateId) return;
        const tk = await pool.query(`SELECT template_key FROM notification_templates WHERE id=$1`, [templateId]);
        // Use a fixed UUID as the entity_id for the dedupe key.
        // Pre-clear the Redis key so the test is idempotent across runs.
        const fixedEntityId = '00000000-0000-0000-0000-000000000001';
        const { getRedis, isAvailable } = require('../../src/config/redis');
        const tk2 = await pool.query(`SELECT id FROM notification_templates WHERE template_key=$1`, [tk.rows[0].template_key]);
        const dedupeKey = `notif:dedupe:${tk2.rows[0]?.id}:${fixedEntityId}`;
        if (isAvailable()) { await getRedis().del(dedupeKey).catch(() => {}); }
        const r1 = await ns.emit(null, {
            templateKey: tk.rows[0].template_key,
            title: 'dedupe test',
            module: 'test', entityType: 'test', entityId: fixedEntityId,
            extraRecipientUserIds: [testUserId],
        });
        const r2 = await ns.emit(null, {
            templateKey: tk.rows[0].template_key,
            title: 'dedupe test 2',
            module: 'test', entityType: 'test', entityId: fixedEntityId,
            extraRecipientUserIds: [testUserId],
        });
        // Second emit should be deduped (notificationIds empty or skipped flag).
        expect(r2.deduped).toBe(true);
    });
});
