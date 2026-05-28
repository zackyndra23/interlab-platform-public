'use strict';

const crypto = require('crypto');
const path = require('path');

const db = require('../config/database');
const env = require('../config/env');
const minio = require('../config/minio');
const { NotFoundError, BadRequestError } = require('../utils/errors');

// File service layer — MinIO upload, file_attachments row management, and
// presigned-URL generation for download. Mirrors IMPL_backend §PHASE B5
// `file.service.js`:
//
//   uploadFile(buffer, originalName, mimeType, module, entityId, uploadedBy)
//     → file_attachment record + MinIO upload
//   getPresignedUrl(fileId, userId)
//     → presigned URL (15 min expiry)
//   deleteFile(fileId, userId)
//   getFilesByEntity(module, entityId)
//
// Storage layout matches CTX_architecture §MINIO BUCKET STRATEGY:
//   attachments/{module}/{entity_id}/{file_id}_{original_filename}
//
// `related_entity_id` is nullable on upload — Multi-file uploads begin before
// a draft row has an id, so we persist with NULL. Each module service's
// `attachFilesToEntity` hook then UPDATEs `related_module` + `related_entity_id`
// once the entity row is known.

function isValidExtension(ext) {
    const allowed = [
        '.pdf', '.doc', '.docx', '.xls', '.xlsx', '.csv',
        '.jpg', '.jpeg', '.png', '.webp', '.zip',
    ];
    return allowed.includes(ext.toLowerCase());
}

function sanitizeFilename(name) {
    // Strip path separators and control characters. We keep the rest as-is
    // for human readability — the storage path uses a uuid prefix so two
    // users uploading the same filename don't collide.
    return name.replace(/[\\/\x00-\x1f]/g, '_').slice(0, 255);
}

function buildStoragePath(relatedModule, entityId, fileId, originalFilename) {
    const safeName = sanitizeFilename(originalFilename);
    const moduleSegment = (relatedModule || 'unscoped').replace(/[^a-zA-Z0-9._-]/g, '_');
    const entitySegment = entityId || 'pending';
    return `${moduleSegment}/${entitySegment}/${fileId}_${safeName}`;
}

/**
 * Upload a file to MinIO and persist its metadata row.
 *
 * Returns the file_attachments row shape consumed by MultiFileUpload:
 *   { id, original_filename, mime_type, size_bytes, created_at, ... }
 *
 * Optional params for PO stage-trigger integration:
 *   poDocumentTypeId — links the file to a po_document_types row. When set
 *     alongside relatedModule='purchase_orders', a post-insert hook fires
 *     applyTrigger to potentially advance the PO stage.
 */
async function uploadFile({
    buffer,
    originalFilename,
    mimeType,
    sizeBytes,
    relatedModule,
    relatedEntityId = null,
    uploadedBy,
    poDocumentTypeId = null,
}) {
    if (!buffer || buffer.length === 0) {
        throw new BadRequestError('Uploaded file is empty');
    }
    const maxBytes = env.uploads.maxFileSizeMb * 1024 * 1024;
    if (buffer.length > maxBytes) {
        throw new BadRequestError(
            `File exceeds ${env.uploads.maxFileSizeMb}MB limit`,
        );
    }

    const extension = path.extname(originalFilename);
    if (!isValidExtension(extension)) {
        throw new BadRequestError(
            `File type '${extension || 'unknown'}' is not allowed`,
        );
    }

    const fileId = crypto.randomUUID();
    const bucket = minio.bucketAttachments;
    const storagePath = buildStoragePath(
        relatedModule, relatedEntityId, fileId, originalFilename,
    );

    // Push the bytes to MinIO first. On success we insert the metadata row;
    // on failure the DB stays clean so retries don't leak orphan rows.
    const client = minio.getClient();
    await client.putObject(bucket, storagePath, buffer, buffer.length, {
        'Content-Type': mimeType || 'application/octet-stream',
    });

    const { rows } = await db.query(
        `INSERT INTO file_attachments
           (id, original_filename, mime_type, extension,
            uploaded_by, related_module, related_entity_id,
            storage_bucket, storage_path, size_bytes, po_document_type_id)
         VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10,$11)
         RETURNING id, original_filename, mime_type, extension,
                   uploaded_by, uploaded_at, related_module, related_entity_id,
                   size_bytes, created_at, po_document_type_id`,
        [
            fileId, sanitizeFilename(originalFilename), mimeType || null,
            extension || null, uploadedBy, relatedModule, relatedEntityId,
            bucket, storagePath, sizeBytes ?? buffer.length, poDocumentTypeId || null,
        ],
    );
    const fileRow = rows[0];

    // Post-insert hook: trigger PO stage advance if applicable.
    // Fire-and-forget: stage trigger failures must not roll back the upload.
    if (poDocumentTypeId && relatedModule === 'purchase_orders' && relatedEntityId) {
        try {
            // Look up the uploader's role to pass a proper actor context.
            const userRes = await db.query(
                `SELECT role FROM users WHERE id=$1 AND deleted_at IS NULL`,
                [uploadedBy],
            );
            const actorRole = userRes.rows[0]?.role || 'unknown';
            const poDoc = require('./po_document.service');
            await poDoc.applyTrigger({
                poId: relatedEntityId,
                docTypeId: poDocumentTypeId,
                actor: { id: uploadedBy, role: actorRole },
            });
        } catch (err) {
            // Stage trigger failures should not roll back the file upload itself;
            // log and continue. Caller can call applyTrigger explicitly if needed.
            // eslint-disable-next-line no-console
            console.warn('[file.service] po stage trigger failed:', err.message);
        }
    }

    return fileRow;
}

async function requireFile(fileId) {
    const { rows } = await db.query(
        `SELECT * FROM file_attachments
          WHERE id = $1 AND deleted_at IS NULL`,
        [fileId],
    );
    if (rows.length === 0) throw new NotFoundError(`file_attachments ${fileId} not found`);
    return rows[0];
}

/**
 * Generate a short-lived download URL for the file. Uploader is the
 * authenticated user — currently we do not enforce an additional owner
 * check because attachments are scoped to an entity that the caller already
 * has to have permission to read at its own endpoint. If finer-grained
 * access control is needed later, plumb the owning entity's RBAC check in
 * here.
 */
async function getPresignedUrl(fileId /* , userId */) {
    const file = await requireFile(fileId);
    // Sign against the browser-facing host so the emitted URL is dialable
    // from outside the Docker network. Falls back to the internal client
    // when MINIO_PUBLIC_URL is unset (local dev).
    const client = minio.getPublicClient();
    const expirySeconds = env.uploads.presignedDownloadSeconds;
    const url = await client.presignedGetObject(
        file.storage_bucket, file.storage_path, expirySeconds,
    );
    return { url, expires_in: expirySeconds };
}

async function deleteFile(fileId, actorUserId) {
    const file = await requireFile(fileId);
    // Soft-delete the metadata row so historical audit queries still resolve
    // the filename. The bytes stay in MinIO; a background janitor can
    // reclaim them later without racing request handlers.
    await db.query(
        `UPDATE file_attachments
            SET deleted_at = now()
          WHERE id = $1`,
        [file.id],
    );
    return { id: file.id, deleted_by: actorUserId };
}

async function getFilesByEntity(relatedModule, entityId) {
    const { rows } = await db.query(
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

module.exports = {
    uploadFile,
    getPresignedUrl,
    deleteFile,
    getFilesByEntity,
    // exposed for unit tests
    buildStoragePath,
    sanitizeFilename,
    isValidExtension,
};
