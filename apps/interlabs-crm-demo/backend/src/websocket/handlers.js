'use strict';

const db = require('../config/database');
const emitter = require('./emitter');

// Client → Server event dispatch per CTX_architecture §WEBSOCKET EVENT
// CATALOGUE:
//
//   chat:join_channel    { channel_id }
//   chat:send_message    { channel_id, content, topic? }
//   chat:mark_read       { channel_id, message_id }
//   po:subscribe         { po_id }          -- routed to no-op for now
//
// Contract:
//   - Each handler takes (socket, data) and may reply via socket.send().
//   - Handlers never throw upward; errors are sent back as
//     { event: '<incoming>:error', data: { message } } so the client can
//     surface them without tearing down the connection.
//   - DB access uses the shared pool. Chat operations verify channel
//     membership on every write — no trust in the socket context alone,
//     matching CTX_master_context invariant "RBAC is enforced at all
//     three layers".

function replyError(socket, originalEvent, message) {
    try {
        socket.send(JSON.stringify({
            event: `${originalEvent}:error`,
            data: { message },
            ts: new Date().toISOString(),
        }));
    } catch (_err) { /* swallow; client already gone */ }
}

// ---------------------------------------------------------------------------
// chat:join_channel
// ---------------------------------------------------------------------------
//
// Validates that the caller is a member of the channel and records the
// fact that they "opened" it (could be used later for presence). For
// now, membership verification is the primary job — failing gives the
// frontend an early signal before it tries to send a message.

async function onChatJoinChannel(socket, data) {
    const channelId = data && data.channel_id;
    if (!channelId) return replyError(socket, 'chat:join_channel', 'channel_id required');

    const { rows } = await db.query(
        `SELECT 1 FROM chat_channel_members
          WHERE channel_id = $1 AND user_id = $2
          LIMIT 1`,
        [channelId, socket.userContext.userId],
    );
    if (rows.length === 0) {
        return replyError(socket, 'chat:join_channel', 'Not a member of this channel');
    }

    // Track the last channel the socket joined so future sends can
    // cheaply attribute the source UI. Useful for multi-tab UX.
    socket.userContext.lastChannelId = channelId;

    socket.send(JSON.stringify({
        event: 'chat:joined',
        data: { channel_id: channelId },
        ts: new Date().toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// chat:send_message
// ---------------------------------------------------------------------------
//
// Inserts a chat_messages row and fans the resulting message out to
// every other channel member via sendToUser. Also bumps the sender's
// last_read_message_id so their own unread count stays at zero.

async function onChatSendMessage(socket, data) {
    const channelId = data && data.channel_id;
    const content = typeof data?.content === 'string' ? data.content.trim() : '';
    const topicId = data && data.topic_id ? data.topic_id : null;
    if (!channelId) return replyError(socket, 'chat:send_message', 'channel_id required');
    if (!content) return replyError(socket, 'chat:send_message', 'content required');
    if (content.length > 8000) {
        return replyError(socket, 'chat:send_message', 'content exceeds 8000 chars');
    }

    await db.withTransaction(async (c) => {
        const { rows: memberRows } = await c.query(
            `SELECT 1 FROM chat_channel_members
              WHERE channel_id = $1 AND user_id = $2
              LIMIT 1`,
            [channelId, socket.userContext.userId],
        );
        if (memberRows.length === 0) {
            replyError(socket, 'chat:send_message', 'Not a member of this channel');
            return;
        }

        const { rows: insertRows } = await c.query(
            `INSERT INTO chat_messages
               (channel_id, topic_id, sender_user_id, content)
             VALUES ($1, $2, $3, $4)
             RETURNING id, channel_id, topic_id, sender_user_id,
                       content, created_at`,
            [channelId, topicId, socket.userContext.userId, content],
        );
        const msg = insertRows[0];

        // Keep the sender's own read cursor at the message they just sent.
        await c.query(
            `UPDATE chat_channel_members
                SET last_read_message_id = $3
              WHERE channel_id = $1 AND user_id = $2`,
            [channelId, socket.userContext.userId, msg.id],
        );

        // Fetch sender display_name for the outbound payload so recipients
        // don't each have to join users themselves on receipt.
        const { rows: senderRows } = await c.query(
            `SELECT display_name FROM users WHERE id = $1`,
            [socket.userContext.userId],
        );
        const senderName = senderRows[0] ? senderRows[0].display_name : null;

        // Enumerate OTHER channel members — skip the sender so their own
        // `chat:message` comes back as an echo from the explicit
        // REST-list / their existing tab, not a duplicate push.
        const { rows: members } = await c.query(
            `SELECT user_id FROM chat_channel_members
              WHERE channel_id = $1 AND user_id <> $2`,
            [channelId, socket.userContext.userId],
        );

        const payload = {
            channel_id: msg.channel_id,
            message_id: msg.id,
            topic_id: msg.topic_id,
            sender_id: msg.sender_user_id,
            sender_name: senderName,
            content: msg.content,
            created_at: msg.created_at,
        };
        for (const row of members) {
            emitter.sendToUser(row.user_id, 'chat:message', payload);
        }

        // Echo back to the sender so every tab they have open updates
        // (including the one that sent it — UX expectation).
        emitter.sendToUser(socket.userContext.userId, 'chat:message', payload);
    });
}

// ---------------------------------------------------------------------------
// chat:mark_read
// ---------------------------------------------------------------------------
//
// Advances the caller's read cursor in a channel. Also emits
// chat:unread_update to all of the caller's own connected sockets so
// other tabs can decrement their badge counters.

async function onChatMarkRead(socket, data) {
    const channelId = data && data.channel_id;
    const messageId = data && data.message_id;
    if (!channelId || !messageId) {
        return replyError(socket, 'chat:mark_read', 'channel_id and message_id required');
    }

    const { rowCount } = await db.query(
        `UPDATE chat_channel_members
            SET last_read_message_id = $3
          WHERE channel_id = $1 AND user_id = $2`,
        [channelId, socket.userContext.userId, messageId],
    );
    if (rowCount === 0) {
        return replyError(socket, 'chat:mark_read', 'Not a member of this channel');
    }

    await db.query(
        `INSERT INTO chat_message_reads (message_id, user_id)
         VALUES ($1, $2)
         ON CONFLICT (message_id, user_id) DO NOTHING`,
        [messageId, socket.userContext.userId],
    );

    // Recompute unread count for the caller and push to all their tabs.
    const { rows } = await db.query(
        `SELECT count(*)::int AS c
           FROM chat_messages m
           JOIN chat_channel_members cm
             ON cm.channel_id = m.channel_id AND cm.user_id = $2
          WHERE m.channel_id = $1
            AND m.deleted_at IS NULL
            AND (cm.last_read_message_id IS NULL
                 OR m.created_at > (
                     SELECT created_at FROM chat_messages
                      WHERE id = cm.last_read_message_id))`,
        [channelId, socket.userContext.userId],
    );
    emitter.sendToUser(socket.userContext.userId, 'chat:unread_update', {
        channel_id: channelId,
        unread_count: rows[0].c,
    });
}

// ---------------------------------------------------------------------------
// po:subscribe — placeholder hook.
//
// Accepted so the client event catalogue stays in sync with the spec. No
// per-connection subscription list is maintained yet; po:status_update
// pushes are delivered via sendToRole() today, which covers every
// connected user in the relevant division.
// ---------------------------------------------------------------------------

function onPoSubscribe(socket, _data) {
    socket.send(JSON.stringify({
        event: 'po:subscribe:ack',
        data: { note: 'po:status_update is delivered via role broadcast' },
        ts: new Date().toISOString(),
    }));
}

// ---------------------------------------------------------------------------
// DISPATCH
// ---------------------------------------------------------------------------

const HANDLERS = Object.freeze({
    'chat:join_channel': onChatJoinChannel,
    'chat:send_message': onChatSendMessage,
    'chat:mark_read':    onChatMarkRead,
    'po:subscribe':      onPoSubscribe,
});

/**
 * Handle one incoming WebSocket message frame. Parses JSON, validates
 * the envelope, routes to the per-event handler. Malformed frames emit
 * a generic `error` event back to the client.
 */
async function handleIncoming(socket, rawText) {
    let parsed;
    try {
        parsed = JSON.parse(rawText);
    } catch (_err) {
        return replyError(socket, 'ws', 'invalid JSON frame');
    }
    const event = parsed && parsed.event;
    const data = parsed && parsed.data;
    if (typeof event !== 'string') {
        return replyError(socket, 'ws', 'event field required');
    }
    const handler = HANDLERS[event];
    if (!handler) {
        return replyError(socket, event, 'unknown event');
    }
    try {
        await handler(socket, data);
    } catch (err) {
        // Internal error — surface a generic message, log the detail.
        // eslint-disable-next-line no-console
        console.error('[ws] handler error', { event, err: err.message });
        replyError(socket, event, 'internal error');
    }
}

module.exports = {
    handleIncoming,
    // Exposed for tests.
    HANDLERS,
};
