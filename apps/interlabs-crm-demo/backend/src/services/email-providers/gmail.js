'use strict';
// Gmail SMTP via app password — same wire protocol as smtp.js but pinned host.
const nodemailer = require('nodemailer');
const env = require('../../config/env');

let transporter = null;
function tx() {
  if (transporter) return transporter;
  transporter = nodemailer.createTransport({
    host: 'smtp.gmail.com',
    port: 465,
    secure: true,
    auth: { user: env.gmail?.user, pass: env.gmail?.appPassword },
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
