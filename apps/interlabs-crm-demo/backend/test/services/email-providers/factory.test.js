'use strict';
const factory = require('../../../src/services/email-providers/factory');

describe('email provider factory', () => {
  it('resolves SMTP adapter when sender.provider=smtp', async () => {
    const original = factory.adapters.smtp.send;
    factory.adapters.smtp.send = async () => ({ messageId: 'fake', status: 'sent' });
    try {
      const sender = { sender_key: 'x', display_name: 'X', from_email: 'a@b.c', reply_to_email: null, provider: 'smtp' };
      const r = await factory.sendViaSender(sender, { to: 'd@e.f', subject: 's', html: '<p>x</p>' });
      expect(r.messageId).toBe('fake');
    } finally {
      factory.adapters.smtp.send = original;
    }
  });

  it('throws on unknown provider', async () => {
    const sender = { sender_key: 'x', display_name: 'X', from_email: 'a@b.c', reply_to_email: null, provider: 'lolnope' };
    await expect(factory.sendViaSender(sender, { to: 'd', subject: 's', html: 'h' })).rejects.toThrow();
  });

  it('postmark stub throws not-implemented', async () => {
    const sender = { sender_key: 'x', display_name: 'X', from_email: 'a@b.c', reply_to_email: null, provider: 'postmark' };
    await expect(factory.sendViaSender(sender, { to: 'd', subject: 's', html: 'h' })).rejects.toThrow(/not implemented/i);
  });

  it('resolveDefaultSender returns config-shaped object', async () => {
    const s = await factory.resolveDefaultSender();
    expect(s.provider).toBeDefined();
    expect(s.from_email).toBeDefined();
    expect(s.display_name).toBeDefined();
  });
});
