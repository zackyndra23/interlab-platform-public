'use strict';
const db = require('../config/database');

async function listForUser(userId) {
    const r = await db.query(
        `SELECT m.template_id, t.template_key, t.template_name
           FROM notification_user_mutes m
           JOIN notification_templates t ON t.id = m.template_id
          WHERE m.user_id = $1`,
        [userId],
    );
    return r.rows;
}

async function mute(userId, templateId) {
    await db.query(
        `INSERT INTO notification_user_mutes (user_id, template_id) VALUES ($1, $2)
         ON CONFLICT DO NOTHING`,
        [userId, templateId],
    );
    return { ok: true };
}

async function unmute(userId, templateId) {
    await db.query(
        `DELETE FROM notification_user_mutes WHERE user_id=$1 AND template_id=$2`,
        [userId, templateId],
    );
    return { ok: true };
}

module.exports = { listForUser, mute, unmute };
