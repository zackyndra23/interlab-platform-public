'use strict';
const db = require('../config/database');
const { ForbiddenError, ValidationError } = require('../utils/errors');
const perms = require('./permission.service');
const activityLog = require('./activity_log.service');

const VALID_PROVIDERS = ['smtp', 'gmail', 'ses', 'postmark', 'resend'];

async function authorize(actor) {
    if (actor.role === 'superadmin' || actor.role === 'ceo') return;
    const caps = await perms.resolveCapabilities(actor.id, 'admin_rbac');
    if (!caps.has('manage_notifications') && !caps.has('full_access')) {
        throw new ForbiddenError('lacks manage_notifications capability');
    }
}

async function resolveActorEmail(actor) {
    if (actor.email) return actor.email;
    const r = await db.query(`SELECT email FROM users WHERE id=$1`, [actor.id]);
    return r.rows[0]?.email || 'system@internal';
}

async function list() {
    const r = await db.query(`SELECT * FROM notification_senders ORDER BY display_name`);
    return r.rows;
}

async function create({ actor, sender_key, display_name, from_email, reply_to_email = null, provider, provider_config_key, is_active = true }) {
    await authorize(actor);
    if (!VALID_PROVIDERS.includes(provider)) throw new ValidationError(`invalid provider: ${provider}`);
    const r = await db.query(
        `INSERT INTO notification_senders (sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active)
         VALUES ($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
        [sender_key, display_name, from_email, reply_to_email, provider, provider_config_key, is_active],
    );
    resolveActorEmail(actor).then((email) => activityLog.record({
        userId: actor.id, userEmail: email, userRole: actor.role,
        action: 'notification.sender.created',
        resourceType: 'notification_senders', resourceId: r.rows[0].id,
        detail: { sender_key, provider },
    }).catch(() => {})).catch(() => {});
    return r.rows[0];
}

async function update({ actor, id, patch }) {
    await authorize(actor);
    // Build SET clauses dynamically so that explicitly-supplied null values
    // clear nullable columns (e.g. reply_to_email) rather than being ignored
    // by COALESCE. Non-nullable columns still use COALESCE for "omit = keep".
    const values = [id]; // $1 = id
    const fields = [];

    if ('display_name' in patch) {
        fields.push(`display_name = COALESCE($${values.push(patch.display_name)}, display_name)`);
    }
    if ('from_email' in patch) {
        fields.push(`from_email = COALESCE($${values.push(patch.from_email)}, from_email)`);
    }
    // reply_to_email is nullable: explicit null must clear the column.
    if ('reply_to_email' in patch) {
        fields.push(`reply_to_email = $${values.push(patch.reply_to_email)}`);
    }
    if ('provider' in patch) {
        fields.push(`provider = COALESCE($${values.push(patch.provider)}, provider)`);
    }
    if ('provider_config_key' in patch) {
        fields.push(`provider_config_key = COALESCE($${values.push(patch.provider_config_key)}, provider_config_key)`);
    }
    if ('is_active' in patch) {
        fields.push(`is_active = COALESCE($${values.push(patch.is_active)}, is_active)`);
    }

    fields.push('updated_at = now()');
    const sql = `UPDATE notification_senders SET ${fields.join(', ')} WHERE id=$1 RETURNING *`;
    const r = await db.query(sql, values);
    if (!r.rowCount) throw new ValidationError('sender not found');
    return r.rows[0];
}

async function remove({ actor, id }) {
    await authorize(actor);
    const used = await db.query(`SELECT count(*)::int AS n FROM notification_templates WHERE sender_id=$1`, [id]);
    if (used.rows[0].n > 0) throw new ValidationError('cannot delete: sender is in use by templates');
    await db.query(`DELETE FROM notification_senders WHERE id=$1`, [id]);
    return { ok: true };
}

async function resolveByTemplateKey(templateKey) {
    const r = await db.query(
        `SELECT s.* FROM notification_templates t
           LEFT JOIN notification_senders s ON s.id = t.sender_id AND s.is_active=true
          WHERE t.template_key = $1`,
        [templateKey],
    );
    if (r.rows[0]?.id) return r.rows[0];
    // Fallback to noreply
    const fb = await db.query(`SELECT * FROM notification_senders WHERE sender_key='noreply' LIMIT 1`);
    return fb.rows[0] || null;
}

module.exports = { list, create, update, remove, resolveByTemplateKey };
