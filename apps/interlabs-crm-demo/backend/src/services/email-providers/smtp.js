'use strict';
const nodemailer = require('nodemailer');
const env = require('../../config/env');

let transporter = null;
function tx() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: env.smtp.host,
    port: env.smtp.port,
    secure: env.smtp.secure,
    auth: env.smtp.user ? { user: env.smtp.user, pass: env.smtp.pass } : undefined,
  });
  return transporter;
}

async function send({ from, replyTo, to, cc, bcc, subject, html }) {
  const info = await tx().sendMail({
    from: from.name ? `"${from.name}" <${from.email}>` : from.email,
    replyTo: replyTo || undefined,
    to, cc, bcc, subject, html,
  });
  return { messageId: info.messageId, status: 'sent' };
}

module.exports = { send };
