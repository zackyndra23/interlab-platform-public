'use strict';
const { SESClient, SendEmailCommand } = require('@aws-sdk/client-ses');
const env = require('../../config/env');

let client = null;
function ses() {
  if (client) return client;
  client = new SESClient({
    region: env.ses?.region || 'ap-southeast-1',
    credentials: env.ses?.accessKeyId ? {
      accessKeyId: env.ses.accessKeyId,
      secretAccessKey: env.ses.secretAccessKey,
    } : undefined,
  });
  return client;
}

async function send({ from, replyTo, to, cc, bcc, subject, html }) {
  const cmd = new SendEmailCommand({
    Source: from.name ? `"${from.name}" <${from.email}>` : from.email,
    ReplyToAddresses: replyTo ? [replyTo] : undefined,
    Destination: {
      ToAddresses: Array.isArray(to) ? to : [to],
      CcAddresses: cc ? (Array.isArray(cc) ? cc : [cc]) : undefined,
      BccAddresses: bcc ? (Array.isArray(bcc) ? bcc : [bcc]) : undefined,
    },
    Message: {
      Subject: { Data: subject, Charset: 'UTF-8' },
      Body: { Html: { Data: html, Charset: 'UTF-8' } },
    },
  });
  const r = await ses().send(cmd);
  return { messageId: r.MessageId, status: 'sent' };
}

module.exports = { send };
