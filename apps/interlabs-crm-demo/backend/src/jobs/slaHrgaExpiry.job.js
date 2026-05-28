'use strict';

const db = require('../config/database');
const notificationService = require('../services/notification.service');

// Background job: MOD_hrga §COMPLIANCE & EXPIRY MONITORING + §SLA Rule 5.
//
// Runs daily (08:00 local per the spec). Scans hrga_legal_documents and:
//
//   1. If today >= expiry_date (and not already expired)
//        → document_status = 'Expired'
//          compliance_flag = 'expired'
//          expired_at      = now()
//          emit hrga.document.expired
//
//   2. Else if expiry_date - today <= 30 days AND compliance_flag != 'expiring_soon_30'
//        → document_status = 'Expiring Soon'
//          compliance_flag = 'expiring_soon_30'
//          emit hrga.document.expiring_30
//
//   3. Else if expiry_date - today <= 90 days AND compliance_flag = 'ok'
//        → document_status = 'Expiring Soon'
//          compliance_flag = 'expiring_soon_90'
//          emit hrga.document.expiring_90
//
// Idempotency: each tier sets a distinct compliance_flag value and the
// matching UPDATE filters by the *previous* flag, so the same document
// can't re-emit the same tier notification on subsequent runs. An
// expiry_date that is revised forward (e.g. document renewed in-place
// via supersede / update) resets compliance_flag to 'ok' so the 90d/30d
// tiers fire again when appropriate.
//
// Archived / Superseded documents are skipped entirely.

const TIER_EXPIRED = 'expired';
const TIER_30 = 'expiring_soon_30';
const TIER_90 = 'expiring_soon_90';

async function findExpired(client) {
    const { rows } = await client.query(
        `SELECT id, legal_document_record_number, document_name,
                document_category, expiry_date, pic_user_id,
                compliance_flag, document_status
           FROM hrga_legal_documents
          WHERE deleted_at IS NULL
            AND document_status NOT IN ('Archived','Superseded','Expired')
            AND expiry_date IS NOT NULL
            AND expiry_date <= CURRENT_DATE
          FOR UPDATE SKIP LOCKED`,
    );
    return rows;
}

async function findExpiring30(client) {
    const { rows } = await client.query(
        `SELECT id, legal_document_record_number, document_name,
                document_category, expiry_date, pic_user_id,
                compliance_flag
           FROM hrga_legal_documents
          WHERE deleted_at IS NULL
            AND document_status NOT IN ('Archived','Superseded','Expired')
            AND expiry_date IS NOT NULL
            AND expiry_date >  CURRENT_DATE
            AND expiry_date <= CURRENT_DATE + INTERVAL '30 days'
            AND compliance_flag <> 'expiring_soon_30'
          FOR UPDATE SKIP LOCKED`,
    );
    return rows;
}

async function findExpiring90(client) {
    const { rows } = await client.query(
        `SELECT id, legal_document_record_number, document_name,
                document_category, expiry_date, pic_user_id,
                compliance_flag
           FROM hrga_legal_documents
          WHERE deleted_at IS NULL
            AND document_status NOT IN ('Archived','Superseded','Expired')
            AND expiry_date IS NOT NULL
            AND expiry_date >  CURRENT_DATE + INTERVAL '30 days'
            AND expiry_date <= CURRENT_DATE + INTERVAL '90 days'
            AND compliance_flag = 'ok'
          FOR UPDATE SKIP LOCKED`,
    );
    return rows;
}

function daysUntil(expiryDate) {
    if (!expiryDate) return null;
    const today = new Date();
    const exp = expiryDate instanceof Date ? expiryDate : new Date(expiryDate);
    const diff = Math.round((exp.getTime() - today.getTime()) / (24 * 60 * 60 * 1000));
    return diff;
}

function docLabel(doc) {
    return doc.legal_document_record_number || doc.document_name || doc.id;
}

async function flagExpired(client, doc) {
    await client.query(
        `UPDATE hrga_legal_documents
            SET document_status = 'Expired',
                compliance_flag = 'expired',
                expired_at      = COALESCE(expired_at, now()),
                updated_at      = now()
          WHERE id = $1`,
        [doc.id],
    );
    const iso = doc.expiry_date instanceof Date
        ? doc.expiry_date.toISOString().slice(0, 10)
        : String(doc.expiry_date).slice(0, 10);
    await notificationService.emit(client, {
        templateKey: 'hrga.document.expired',
        title: `Document expired: ${docLabel(doc)}`,
        message: `${doc.document_name || docLabel(doc)} expired on ${iso}.`,
        module: 'hrga',
        entityType: 'hrga_legal_documents',
        entityId: doc.id,
        extraRecipientUserIds: doc.pic_user_id ? [doc.pic_user_id] : [],
        extraRoles: ['hrga', 'superadmin', 'ceo'],
    });
}

async function flagExpiring(client, doc, tier) {
    await client.query(
        `UPDATE hrga_legal_documents
            SET document_status = 'Expiring Soon',
                compliance_flag = $2,
                updated_at      = now()
          WHERE id = $1`,
        [doc.id, tier],
    );
    const days = daysUntil(doc.expiry_date);
    const templateKey = tier === TIER_30
        ? 'hrga.document.expiring_30'
        : 'hrga.document.expiring_90';
    const window = tier === TIER_30 ? '30 days' : '90 days';
    await notificationService.emit(client, {
        templateKey,
        title: `Document expiring in ≤${window}: ${docLabel(doc)}`,
        message: `${doc.document_name || docLabel(doc)} expires in ${days} day(s).`,
        module: 'hrga',
        entityType: 'hrga_legal_documents',
        entityId: doc.id,
        extraRecipientUserIds: doc.pic_user_id ? [doc.pic_user_id] : [],
        extraRoles: ['hrga', 'superadmin', 'ceo'],
    });
}

/**
 * Scan hrga_legal_documents and fire expiry notifications.
 *
 * Order of operations matters: we process TIER_EXPIRED first so a document
 * that crossed from 30d → expired in a single run gets the 'expired' event
 * (not a duplicate expiring_30). TIER_30 is processed before TIER_90 for
 * the same reason — a document in the 30d window shouldn't receive the
 * 90d event after already being flagged for 30d.
 *
 * @returns {Promise<{scanned:number, expired:number, expiring30:number, expiring90:number}>}
 */
async function run() {
    return db.withTransaction(async (c) => {
        const expired = await findExpired(c);
        for (const doc of expired) {
            await flagExpired(c, doc);
        }

        const expiring30 = await findExpiring30(c);
        for (const doc of expiring30) {
            await flagExpiring(c, doc, TIER_30);
        }

        const expiring90 = await findExpiring90(c);
        for (const doc of expiring90) {
            await flagExpiring(c, doc, TIER_90);
        }

        return {
            scanned: expired.length + expiring30.length + expiring90.length,
            expired: expired.length,
            expiring30: expiring30.length,
            expiring90: expiring90.length,
        };
    });
}

module.exports = {
    run,
    TIER_EXPIRED,
    TIER_30,
    TIER_90,
};
