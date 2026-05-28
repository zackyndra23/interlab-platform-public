'use strict';

const nodemailer = require('nodemailer');
const settings = require('./app_settings.service');
const db = require('../config/database');
const factory = require('./email-providers/factory');

async function buildTransport() {
    const cfg = await settings.getAll();
    const e = cfg.email || {};

    const base = {
        host: e.smtp_host,
        port: Number(e.smtp_port) || 587,
        secure: e.encryption === 'ssl',
        requireTLS: e.encryption === 'tls',
        auth: (e.smtp_username && e.smtp_password)
            ? { user: e.smtp_username, pass: e.smtp_password }
            : undefined,
    };

    if (e.protocol === 'sendmail') return nodemailer.createTransport({ sendmail: true });
    if (e.protocol === 'mail')     return nodemailer.createTransport({ sendmail: true });
    if (e.protocol === 'gmail_oauth') {
        return nodemailer.createTransport({
            service: 'gmail',
            auth: { user: e.smtp_username, pass: e.smtp_password },
        });
    }
    if (e.protocol === 'ms_oauth') {
        return nodemailer.createTransport({
            host: 'smtp.office365.com',
            port: 587,
            secure: false,
            requireTLS: true,
            auth: { user: e.smtp_username, pass: e.smtp_password },
        });
    }
    return nodemailer.createTransport(base);
}

async function sendTest(toAddress) {
    const cfg = await settings.getAll();
    const transport = await buildTransport();
    const info = await transport.sendMail({
        from: cfg.email.from_email || cfg.email.smtp_username,
        to: toAddress,
        subject: 'Test email from Interlabs CRM',
        html: `${cfg.email.predefined_header || ''}
               <p>This is a test email confirming your SMTP settings work.</p>
               <p>Signature:</p><p>${cfg.email.signature || ''}</p>
               ${cfg.email.predefined_footer || ''}`,
    });
    return {
        messageId: info.messageId,
        accepted: info.accepted,
        rejected: info.rejected,
    };
}

async function enqueue({ to, cc, bcc, subject, bodyHtml, hasAttachment = false }) {
    const { rows } = await db.query(
        `INSERT INTO email_queue
           (to_address, cc_address, bcc_address, subject, body_html, has_attachment)
         VALUES ($1, $2, $3, $4, $5, $6)
         RETURNING id`,
        [to, cc || null, bcc || null, subject, bodyHtml, hasAttachment],
    );
    return rows[0].id;
}

async function listQueue({ page = 1, limit = 25 } = {}) {
    const offset = (page - 1) * limit;
    const [countRes, dataRes] = await Promise.all([
        db.query('SELECT COUNT(*) FROM email_queue'),
        db.query(
            `SELECT id, to_address, subject, status, attempts, last_error, created_at, sent_at
               FROM email_queue
              ORDER BY created_at DESC
              LIMIT $1 OFFSET $2`,
            [limit, offset],
        ),
    ]);
    return {
        data: dataRes.rows,
        total: parseInt(countRes.rows[0].count, 10),
        page,
        limit,
    };
}

// Deliver an email immediately via the configured provider.
// Routes through factory so the provider can be swapped without touching
// call sites. F5 will upgrade resolveDefaultSender to read notification_senders.
async function deliver({ to, cc, bcc, subject, html }) {
    const sender = await factory.resolveDefaultSender();
    return factory.sendViaSender(sender, { to, cc, bcc, subject, html });
}

module.exports = { buildTransport, sendTest, enqueue, listQueue, deliver };
