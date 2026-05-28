'use strict';

const express = require('express');
const multer = require('multer');
const { authMiddleware } = require('../middleware/auth.middleware');
const { rbacGuard } = require('../middleware/rbac.middleware');
const { success, error } = require('../utils/response');
const settings = require('../services/app_settings.service');
const emailSvc = require('../services/email.service');
const minio = require('../config/minio');
const activityLog = require('../services/activity_log.service');

const router = express.Router();
const readGuard  = rbacGuard('system_settings', 'view_own');
const writeGuard = rbacGuard('system_settings', 'full_access');

const LOGO_PRESIGN_SECONDS = 60 * 60 * 24;

function asyncHandler(fn) {
    return (req, res, next) => Promise.resolve(fn(req, res, next)).catch(next);
}

// Logo paths are stored as `{bucketAvatars}:{storagePath}` so GET can resolve
// to a fresh presigned URL without needing a separate public bucket/policy.
// The project convention is private buckets + presigned URLs (see CLAUDE.md
// "MinIO buckets are private; access only via presigned URLs").
async function resolveLogoUrl(stored) {
    if (!stored || typeof stored !== 'string') return '';
    const sep = stored.indexOf(':');
    if (sep === -1) return stored;
    const bucket = stored.slice(0, sep);
    const key = stored.slice(sep + 1);
    if (!bucket || !key) return '';
    try {
        const client = minio.getPublicClient();
        return await client.presignedGetObject(bucket, key, LOGO_PRESIGN_SECONDS);
    } catch (_err) {
        return '';
    }
}

// GET all settings (all roles allowed).
router.get('/', authMiddleware, readGuard, asyncHandler(async (_req, res) => {
    const all = await settings.getAll();
    if (all.email && all.email.smtp_password) {
        all.email.smtp_password = '••••••••';
    }
    if (all.general && all.general.logo_url) {
        all.general.logo_url = await resolveLogoUrl(all.general.logo_url);
    }
    res.json(success(all));
}));

// PUT update settings (superadmin + CEO only).
router.put('/', authMiddleware, writeGuard, asyncHandler(async (req, res) => {
    const body = req.body || {};
    const entries = [];
    for (const group of ['general', 'email']) {
        if (body[group] && typeof body[group] === 'object') {
            for (const [k, v] of Object.entries(body[group])) {
                if (group === 'email' && k === 'smtp_password' && v === '••••••••') continue;
                // Never let the client overwrite the stored logo path through PUT;
                // logo_url changes must go through the /logo upload endpoint.
                if (group === 'general' && k === 'logo_url') continue;
                entries.push([`${group}.${k}`, v]);
            }
        }
    }
    await settings.setMany(entries, req.user.id);
    activityLog.record({
        userId: req.user.id,
        userEmail: req.user.email,
        userRole: req.user.role,
        action: 'edit',
        resourceType: 'system_settings',
        detail: { keys: entries.map((e) => e[0]) },
    });
    res.json(success({ updated: entries.length }));
}));

// POST upload logo (superadmin + CEO only).
const upload = multer({
    storage: multer.memoryStorage(),
    limits: { fileSize: 2 * 1024 * 1024 },
});
router.post(
    '/logo',
    authMiddleware,
    writeGuard,
    upload.single('logo'),
    asyncHandler(async (req, res) => {
        if (!req.file) return res.status(400).json(error('No file uploaded', 'bad_request'));
        const client = minio.getClient();
        const bucket = minio.bucketAvatars;
        const safeName = req.file.originalname.replace(/[^a-zA-Z0-9.]/g, '_');
        const key = `settings/logos/logo-${Date.now()}-${safeName}`;
        await client.putObject(
            bucket,
            key,
            req.file.buffer,
            req.file.size,
            { 'Content-Type': req.file.mimetype },
        );
        const stored = `${bucket}:${key}`;
        await settings.set('general.logo_url', stored, req.user.id);
        activityLog.record({
            userId: req.user.id,
            userEmail: req.user.email,
            userRole: req.user.role,
            action: 'edit',
            resourceType: 'system_settings',
            detail: { keys: ['general.logo_url'] },
        });
        const url = await resolveLogoUrl(stored);
        res.json(success({ url }));
    }),
);

// POST test email (superadmin + CEO only).
router.post('/test-email', authMiddleware, writeGuard, asyncHandler(async (req, res) => {
    const { to } = req.body || {};
    if (!to) return res.status(400).json(error('Recipient email required', 'bad_request'));
    try {
        const result = await emailSvc.sendTest(to);
        res.json(success(result));
    } catch (err) {
        res.status(400).json(error(err.message || 'SMTP send failed', 'smtp_error'));
    }
}));

// GET email queue (superadmin + CEO only — sensitive data).
router.get('/email-queue', authMiddleware, writeGuard, asyncHandler(async (req, res) => {
    const { page, limit } = req.query;
    const result = await emailSvc.listQueue({
        page: page ? parseInt(page, 10) : 1,
        limit: limit ? Math.min(parseInt(limit, 10), 100) : 25,
    });
    res.json(success(result));
}));

module.exports = router;
