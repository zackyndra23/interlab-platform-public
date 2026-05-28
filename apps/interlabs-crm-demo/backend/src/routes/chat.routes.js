'use strict';
const express = require('express');
const router = express.Router();
const Joi = require('joi');
const { authMiddleware } = require('../middleware/auth.middleware');
const { validate } = require('../middleware/validator.middleware');
const db = require('../config/database');
const { success, error } = require('../utils/response');
let emitter; try { emitter = require('../websocket'); } catch (_) { emitter = null; }

router.use(authMiddleware);

async function isMember(channelId, userId) {
  const r = await db.query(`SELECT 1 FROM chat_channel_members WHERE channel_id=$1 AND user_id=$2`, [channelId, userId]);
  return r.rowCount > 0;
}

router.get('/channels', async (req, res, next) => {
  try {
    const uid = req.user.id;
    const r = await db.query(`
      SELECT c.id, c.channel_name, c.channel_type, c.topic, c.created_at,
             (SELECT count(*)::int FROM chat_channel_members m2 WHERE m2.channel_id=c.id) AS member_count,
             (SELECT count(*)::int FROM chat_messages msg
                WHERE msg.channel_id=c.id AND msg.deleted_at IS NULL
                  AND (mem.last_read_message_id IS NULL OR msg.created_at >
                       (SELECT created_at FROM chat_messages WHERE id=mem.last_read_message_id))) AS unread_count,
             lm.content AS last_message_preview, lm.created_at AS last_message_at,
             peer.display_name AS peer_name
        FROM chat_channel_members mem
        JOIN chat_channels c ON c.id=mem.channel_id AND c.deleted_at IS NULL
        LEFT JOIN LATERAL (SELECT content, created_at FROM chat_messages WHERE channel_id=c.id AND deleted_at IS NULL ORDER BY created_at DESC LIMIT 1) lm ON true
        LEFT JOIN LATERAL (SELECT u.display_name FROM chat_channel_members m3 JOIN users u ON u.id=m3.user_id
                            WHERE m3.channel_id=c.id AND m3.user_id<>$1 LIMIT 1) peer ON true
       WHERE mem.user_id=$1
       ORDER BY lm.created_at DESC NULLS LAST, c.created_at DESC`, [uid]);
    const rows = r.rows.map((c) => ({
      id: c.id,
      channel_key: c.id,
      channel_type: c.channel_type === 'dm' ? 'direct' : c.channel_type === 'group' ? 'topic' : c.channel_type,
      title: c.channel_type === 'dm' ? (c.peer_name || 'Direct Message') : (c.channel_name || c.topic || 'Channel'),
      description: c.topic || null,
      role_scope: null,
      member_count: c.member_count,
      unread_count: c.unread_count,
      last_message_preview: c.last_message_preview || null,
      last_message_at: c.last_message_at || null,
      created_at: c.created_at,
    }));
    res.json(success(rows));
  } catch (e) { next(e); }
});

router.get('/channels/:id/messages',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }),
             query: Joi.object({ before: Joi.string().optional(), limit: Joi.number().integer().min(1).max(100).default(50) }) }),
  async (req, res, next) => {
    try {
      if (!(await isMember(req.params.id, req.user.id))) return res.status(403).json(error('Not a channel member', 'forbidden'));
      const limit = Number(req.query.limit) || 50;
      const params = [req.params.id];
      let beforeClause = '';
      if (req.query.before) { params.push(req.query.before); beforeClause = `AND m.created_at < (SELECT created_at FROM chat_messages WHERE id=$${params.length})`; }
      params.push(limit);
      const r = await db.query(`
        SELECT m.id, m.channel_id, m.topic_id, m.sender_user_id, m.content, m.created_at,
               u.display_name AS sender_name, u.avatar_url AS sender_avatar_url
          FROM chat_messages m LEFT JOIN users u ON u.id=m.sender_user_id
         WHERE m.channel_id=$1 AND m.deleted_at IS NULL ${beforeClause}
         ORDER BY m.created_at DESC LIMIT $${params.length}`, params);
      res.json(success(r.rows));
    } catch (e) { next(e); }
  });

router.post('/channels/:id/messages',
  validate({ params: Joi.object({ id: Joi.string().uuid().required() }),
             body: Joi.object({ content: Joi.string().min(1).max(5000).required(), topic_id: Joi.string().uuid().allow(null).optional() }) }),
  async (req, res, next) => {
    try {
      if (!(await isMember(req.params.id, req.user.id))) return res.status(403).json(error('Not a channel member', 'forbidden'));
      const ins = await db.query(
        `INSERT INTO chat_messages (channel_id, topic_id, sender_user_id, content)
         VALUES ($1,$2,$3,$4) RETURNING id, channel_id, topic_id, sender_user_id, content, created_at`,
        [req.params.id, req.body.topic_id || null, req.user.id, req.body.content]);
      const row = { ...ins.rows[0], sender_name: req.user.display_name || null, sender_avatar_url: null };
      try {
        const others = await db.query(`SELECT user_id FROM chat_channel_members WHERE channel_id=$1 AND user_id<>$2`, [req.params.id, req.user.id]);
        if (emitter && emitter.sendToUsers) emitter.sendToUsers(others.rows.map(o => o.user_id), 'chat:message',
          { channel_id: row.channel_id, message_id: row.id, topic_id: row.topic_id, sender_id: row.sender_user_id, sender_name: row.sender_name, content: row.content, created_at: row.created_at });
      } catch (_) { /* WS optional */ }
      res.json(success(row));
    } catch (e) { next(e); }
  });

module.exports = router;
