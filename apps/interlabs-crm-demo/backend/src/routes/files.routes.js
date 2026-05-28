'use strict';

const express = require('express');
const multer = require('multer');

const env = require('../config/env');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const { success } = require('../utils/response');
const { BadRequestError } = require('../utils/errors');
const fileService = require('../services/file.service');
const v = require('../validators/file.validators');

const router = express.Router();

// ============================================================================
// Files API — the single upload/preview/download endpoint used by every
// module's MultiFileUpload + AttachmentList. Auth-only (no per-feature RBAC):
// authorization is enforced on the entity-side binding endpoint that consumes
// `attachment_ids`, so the upload itself is a module-agnostic primitive.
// ============================================================================

router.use(authMiddleware);

// Multer: memory storage keeps small files in-process (CTX_master_context
// allows pdf/doc/.../zip ≤ 25 MB). For much larger uploads, swap to
// `multer.diskStorage` + a streamed putObject.
const upload = multer({
    storage: multer.memoryStorage(),
    limits: {
        fileSize: env.uploads.maxFileSizeMb * 1024 * 1024,
        files: 1,
    },
});

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// POST /api/files/upload
//   Multipart form:
//     file               — the binary payload (single)
//     related_module     — e.g. 'sales.purchase_orders' (required)
//     related_entity_id  — uuid; optional (the bind hook can set it later)
router.post(
    '/upload',
    upload.single('file'),
    validate({ body: v.fileUploadBody }),
    asyncHandler(async (req, res) => {
        if (!req.file) throw new BadRequestError("Missing 'file' field");
        const row = await fileService.uploadFile({
            buffer: req.file.buffer,
            originalFilename: req.file.originalname,
            mimeType: req.file.mimetype,
            sizeBytes: req.file.size,
            relatedModule: req.body.related_module,
            relatedEntityId: req.body.related_entity_id || null,
            uploadedBy: req.user.id,
            // Plumb po_document_type_id so the post-insert hook can trigger
            // PO stage advances when a document type maps to a stage transition.
            poDocumentTypeId: req.body.po_document_type_id || null,
        });
        res.status(201).json(success(row));
    }),
);

// GET /api/files/:id/presigned-url
//   Returns { url, expires_in } — short-lived MinIO presigned GET.
router.get(
    '/:id/presigned-url',
    validate({ params: v.fileIdParam }),
    asyncHandler(async (req, res) => {
        const data = await fileService.getPresignedUrl(req.params.id, req.user.id);
        res.json(success(data));
    }),
);

// DELETE /api/files/:id
//   Soft-delete the metadata row. Bytes remain in MinIO for janitor cleanup.
router.delete(
    '/:id',
    validate({ params: v.fileIdParam }),
    asyncHandler(async (req, res) => {
        await fileService.deleteFile(req.params.id, req.user.id);
        res.json(success({ id: req.params.id, deleted: true }));
    }),
);

// Multer surfaces its own Error subclass for limit violations. Translate
// those to a BadRequestError so the envelope stays uniform across the API.
router.use((err, _req, _res, next) => {
    if (err && err.name === 'MulterError') {
        return next(new BadRequestError(`Upload rejected: ${err.message}`));
    }
    return next(err);
});

module.exports = router;
