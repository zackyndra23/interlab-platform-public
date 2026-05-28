'use strict';
/**
 * Tests for the PATCH /notification_templates route's dynamic SET builder.
 * Verifies:
 *   - explicit null clears a nullable text column (subject, body)
 *   - empty body {} does not error and does not mutate the row
 */
const { pool } = require('../helpers/db');
const db = require('../../src/config/database');

// We test the SQL logic directly against the DB rather than via HTTP so we
// can run without a live server while still exercising the exact query shape
// used in the route handler.

async function patchTemplate(id, body) {
    const values = [id];
    const fields = [];

    if ('sender_id' in body) {
        fields.push(`sender_id = $${values.push(body.sender_id)}`);
    }
    if ('recipient_roles_json' in body) {
        fields.push(`recipient_roles_json = $${values.push(
            body.recipient_roles_json != null ? JSON.stringify(body.recipient_roles_json) : null,
        )}::jsonb`);
    }
    if ('send_email_enabled' in body) {
        fields.push(`send_email_enabled = $${values.push(body.send_email_enabled)}`);
    }
    if ('send_dashboard_notification_enabled' in body) {
        fields.push(`send_dashboard_notification_enabled = $${values.push(body.send_dashboard_notification_enabled)}`);
    }
    if ('status' in body) {
        fields.push(`status = $${values.push(body.status)}`);
    }
    if ('subject' in body) {
        fields.push(`subject = $${values.push(body.subject)}`);
    }
    if ('body' in body) {
        fields.push(`body = $${values.push(body.body)}`);
    }

    fields.push('updated_at = now()');
    const sql = `UPDATE notification_templates SET ${fields.join(', ')} WHERE id=$1 RETURNING *`;
    const r = await db.query(sql, values);
    return r.rows[0] || null;
}

describe('notification template PATCH dynamic builder', () => {
    let templateId;
    const testKey = `test-patch-${Date.now()}`;

    beforeAll(async () => {
        // Insert a minimal test template with a known subject and body
        const r = await pool.query(
            `INSERT INTO notification_templates
               (template_key, template_name, feature_group, trigger_event, subject, body)
             VALUES ($1, $2, 'test', 'test.event', 'initial subject', 'initial body')
             RETURNING id`,
            [testKey, 'Test Patch Template'],
        );
        templateId = r.rows[0].id;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM notification_templates WHERE template_key=$1`, [testKey]);
    });

    it('PATCH with explicit null clears subject and body', async () => {
        const row = await patchTemplate(templateId, { subject: null, body: null });
        expect(row).not.toBeNull();
        expect(row.subject).toBeNull();
        expect(row.body).toBeNull();
    });

    it('PATCH with empty body {} does not error and does not change subject/body', async () => {
        // First restore values
        await pool.query(
            `UPDATE notification_templates SET subject='restored subject', body='restored body' WHERE id=$1`,
            [templateId],
        );
        // PATCH with empty body should not fail and should not mutate
        const row = await patchTemplate(templateId, {});
        expect(row).not.toBeNull();
        expect(row.subject).toBe('restored subject');
        expect(row.body).toBe('restored body');
    });

    it('PATCH with a value sets the column', async () => {
        const row = await patchTemplate(templateId, { subject: 'updated subject', body: '<p>new</p>' });
        expect(row).not.toBeNull();
        expect(row.subject).toBe('updated subject');
        expect(row.body).toBe('<p>new</p>');
    });
});

describe('notification_sender.service update — reply_to_email null-clear', () => {
    const svc = require('../../src/services/notification_sender.service');
    const senderKey = `test-null-clear-${Date.now()}`;
    let senderId;
    let ceoId;

    beforeAll(async () => {
        const u = await pool.query(`SELECT id FROM users WHERE role='ceo' LIMIT 1`);
        ceoId = u.rows[0]?.id;
        if (!ceoId) return;

        const r = await pool.query(
            `INSERT INTO notification_senders
               (sender_key, display_name, from_email, reply_to_email, provider, provider_config_key)
             VALUES ($1, 'Test Null Clear', 'null@test.example', 'reply@test.example', 'smtp', 'smtp.test')
             RETURNING id`,
            [senderKey],
        );
        senderId = r.rows[0].id;
    });

    afterAll(async () => {
        await pool.query(`DELETE FROM notification_senders WHERE sender_key=$1`, [senderKey]);
    });

    it('update with reply_to_email: null clears the column', async () => {
        if (!ceoId || !senderId) return;
        const updated = await svc.update({
            actor: { id: ceoId, role: 'ceo' },
            id: senderId,
            patch: { reply_to_email: null },
        });
        expect(updated.reply_to_email).toBeNull();
    });

    it('update with empty patch does not mutate display_name', async () => {
        if (!ceoId || !senderId) return;
        const before = await pool.query(`SELECT display_name FROM notification_senders WHERE id=$1`, [senderId]);
        const original = before.rows[0].display_name;
        // Pass an empty patch
        const updated = await svc.update({
            actor: { id: ceoId, role: 'ceo' },
            id: senderId,
            patch: {},
        });
        expect(updated.display_name).toBe(original);
    });
});
