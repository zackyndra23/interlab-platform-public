'use strict';
const db = require('../config/database');
const po = require('./po.service');

const STAGES = [
    'Registered','Processed','Production','Shipped','Customs','Arrived',
    'Inspected','Delivery','Installation','BAST','Invoice',
];

async function listDocumentTypes() {
    const r = await db.query(`
        SELECT id, doc_key, doc_name, triggers_stage, required_for_stage,
               uploader_role_keys, is_active, created_at, updated_at
          FROM po_document_types ORDER BY doc_name`);
    return r.rows;
}

async function getDocumentTypeById(id) {
    const r = await db.query(`SELECT * FROM po_document_types WHERE id=$1`, [id]);
    return r.rows[0] || null;
}

/**
 * Apply the stage-trigger associated with an uploaded document.
 *
 * Called from file.service.js POST-INSERT hook when a file_attachments row
 * has po_document_type_id set AND related_module='purchase_orders'.
 *
 * Returns { applied: boolean, fromStatus?, toStatus? }.
 *
 * Idempotent: if the PO is already at-or-past triggers_stage, returns
 * { applied: false } without raising.
 *
 * @param {object} params
 * @param {string} params.poId
 * @param {string} params.docTypeId
 * @param {{ id: string, role: string }} params.actor
 */
async function applyTrigger({ poId, docTypeId, actor }) {
    const dt = await getDocumentTypeById(docTypeId);
    if (!dt || !dt.is_active || !dt.triggers_stage) {
        return { applied: false, reason: 'doc type does not trigger a stage' };
    }
    const cur = await db.query(
        `SELECT current_status FROM purchase_orders WHERE id=$1`,
        [poId],
    );
    if (!cur.rowCount) return { applied: false, reason: 'PO not found' };
    const fromStatus = cur.rows[0].current_status;
    const fromIdx = STAGES.indexOf(fromStatus);
    const toIdx = STAGES.indexOf(dt.triggers_stage);
    if (toIdx <= fromIdx) {
        // PO already at or past the trigger stage — no-op (idempotent).
        return { applied: false, reason: 'already at or past trigger stage', fromStatus };
    }

    // Use po.service.advanceStatus (existing forward-transition primitive).
    const client = await db.pool.connect();
    try {
        await client.query('BEGIN');
        await po.advanceStatus(client, {
            poId,
            newStatus: dt.triggers_stage,
            actorUserId: actor.id,
            actorRole: actor.role,
            note: `Auto-advanced via ${dt.doc_name} upload`,
        });
        await client.query('COMMIT');
        return { applied: true, fromStatus, toStatus: dt.triggers_stage };
    } catch (e) {
        await client.query('ROLLBACK').catch(() => {});
        throw e;
    } finally {
        client.release();
    }
}

module.exports = { listDocumentTypes, getDocumentTypeById, applyTrigger };
