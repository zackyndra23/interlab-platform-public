'use strict';
const { pool } = require('../helpers/db');
const svc = require('../../src/services/notification_sender.service');

let ceoId;

beforeAll(async () => {
    const u = await pool.query(`SELECT id FROM users WHERE role='ceo' LIMIT 1`);
    ceoId = u.rows[0]?.id;
});

afterAll(async () => {
    await pool.query(`DELETE FROM notification_senders WHERE sender_key LIKE 'test-sender-%'`);
});

describe('notification_sender.service', () => {
    it('create + list', async () => {
        if (!ceoId) return;
        const created = await svc.create({
            actor: { id: ceoId, role: 'ceo' },
            sender_key: `test-sender-${Date.now()}`,
            display_name: 'Test',
            from_email: 'test@example.com',
            provider: 'smtp',
            provider_config_key: 'smtp.default',
        });
        expect(created.id).toBeDefined();
        const list = await svc.list();
        expect(list.find((s) => s.id === created.id)).toBeDefined();
    });

    it('resolveByTemplateKey returns the template-assigned sender or default', async () => {
        if (!ceoId) return;
        // pick any seeded template
        const t = await pool.query(`SELECT template_key FROM notification_templates LIMIT 1`);
        if (!t.rowCount) return;
        const sender = await svc.resolveByTemplateKey(t.rows[0].template_key);
        expect(sender).toBeDefined();
        expect(sender.provider).toBeDefined();
    });

    it('non-superadmin/non-ceo without manage_notifications cannot create', async () => {
        const s = await pool.query(`
          SELECT u.id FROM users u JOIN role_levels rl ON rl.id=u.level_id
           WHERE u.role='sales' AND rl.level_rank=1 LIMIT 1`);
        const staffId = s.rows[0]?.id;
        if (!staffId) return;
        await expect(svc.create({
            actor: { id: staffId, role: 'sales' },
            sender_key: 'test-sender-forbidden', display_name: 'X',
            from_email: 'x@x.com', provider: 'smtp', provider_config_key: 'smtp.default',
        })).rejects.toThrow();
    });
});
