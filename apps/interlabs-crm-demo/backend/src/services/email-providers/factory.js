'use strict';
const env = require('../../config/env');

// Each adapter exports: send({from, replyTo, to, cc, bcc, subject, html}) → {messageId, status}
const adapters = {
  smtp:     require('./smtp'),
  gmail:    require('./gmail'),
  ses:      require('./ses'),
  postmark: require('./postmark'),
  resend:   require('./resend'),
};

// TODO(Phase 3): adapters currently read credentials from process.env.
// sender.provider_config_key is reserved for per-sender credential routing
// via app_settings; not yet wired. Documented in spec §6.

// Resolve sender row (placeholder until F5 lands the notification_senders table).
// Falls back to env-based default sender.
async function resolveDefaultSender() {
  return {
    sender_key: 'default',
    display_name: env.email?.fromName || 'Interlab Notifications',
    from_email: env.email?.fromAddress || 'noreply@example.com',
    reply_to_email: env.email?.replyTo || null,
    provider: env.email?.provider || 'smtp',
  };
}

async function sendViaSender(sender, payload) {
  const adapter = adapters[sender.provider];
  if (!adapter) throw new Error(`unknown email provider: ${sender.provider}`);
  return adapter.send({
    from: { email: sender.from_email, name: sender.display_name },
    replyTo: sender.reply_to_email || null,
    ...payload,
  });
}

module.exports = { resolveDefaultSender, sendViaSender, adapters };
