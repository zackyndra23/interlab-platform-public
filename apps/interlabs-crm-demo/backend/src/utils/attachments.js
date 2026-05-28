'use strict';

const db = require('../config/database');

// Hydrate attachment metadata for a given (related_module, related_entity_id)
// pair. Detail endpoints use this so the response carries the rows the
// frontend needs to render the AttachmentList directly — no extra round-trip
// via a separate /files?entity=... lookup.
//
// The (related_module, related_entity_id) composite index
// (idx_file_attachments_entity) backs this query; the filter shape matches
// the canonical module string used by each service's attachFilesToEntity
// call, so the query hits the index exactly.
async function listAttachmentsForEntity(relatedModule, entityId, runner = db) {
    if (!entityId) return [];
    const { rows } = await runner.query(
        `SELECT id, original_filename, mime_type, extension,
                size_bytes, uploaded_at, created_at
           FROM file_attachments
          WHERE related_module    = $1
            AND related_entity_id = $2
            AND deleted_at IS NULL
          ORDER BY uploaded_at ASC`,
        [relatedModule, entityId],
    );
    return rows;
}

module.exports = { listAttachmentsForEntity };
