'use client';

import {
    useCallback, useEffect, useMemo, useRef, useState,
} from 'react';
import { Hash, MessageSquare, Search, Send, User } from 'lucide-react';
import { toast } from 'sonner';

import { Button } from '@/components/ui/Button';
import { Input } from '@/components/ui/Input';
import { useAuth } from '@/hooks/useAuth';
import { useWebSocket } from '@/hooks/useWebSocket';
import { chatApi } from '@/lib/global-api';
import { websocket } from '@/lib/websocket';
import { cn, formatDate, relativeTime } from '@/lib/utils';
import type {
    ChatChannel, ChatMessage, ChatMessagePush, ChatUnreadUpdatePush,
} from '@/lib/global-types';

/**
 * /chat — two-column layout per IMPL_frontend §F5.
 *
 * Left: searchable channel list (role channels + direct messages).
 * Right: message thread for the active channel with sticky composer.
 *
 * Realtime: subscribes to `chat:message` and `chat:unread_update`. New
 * messages append to the active thread and bump the channel-list badge
 * when they arrive for an inactive channel. Sends go over the WebSocket
 * via `chat:send_message` (REST `chatApi.sendMessage` is the fallback
 * when the socket is offline).
 */
export default function ChatPage() {
    const { user } = useAuth();
    const [channels, setChannels] = useState<ChatChannel[]>([]);
    const [activeId, setActiveId] = useState<string | null>(null);
    const [messages, setMessages] = useState<ChatMessage[]>([]);
    const [draft, setDraft] = useState('');
    const [search, setSearch] = useState('');
    const [loadingChannels, setLoadingChannels] = useState(true);
    const [loadingMessages, setLoadingMessages] = useState(false);
    const [sending, setSending] = useState(false);
    const messagesEndRef = useRef<HTMLDivElement>(null);

    // ---- channel list -----------------------------------------------------

    const loadChannels = useCallback(async (): Promise<void> => {
        setLoadingChannels(true);
        try {
            const res = await chatApi.listChannels();
            setChannels(res.rows);
            if (!activeId && res.rows.length > 0) {
                setActiveId(res.rows[0].id);
            }
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Failed to load channels');
        } finally {
            setLoadingChannels(false);
        }
    }, [activeId]);

    useEffect(() => { loadChannels(); /* once */ }, []); // eslint-disable-line react-hooks/exhaustive-deps

    const filteredChannels = useMemo(() => {
        const q = search.trim().toLowerCase();
        if (!q) return channels;
        return channels.filter((c) =>
            c.title.toLowerCase().includes(q)
            || (c.description?.toLowerCase().includes(q) ?? false),
        );
    }, [channels, search]);

    const activeChannel = useMemo(
        () => channels.find((c) => c.id === activeId) ?? null,
        [channels, activeId],
    );

    // ---- thread load / scroll --------------------------------------------

    const loadMessages = useCallback(async (channelId: string): Promise<void> => {
        setLoadingMessages(true);
        try {
            const res = await chatApi.listMessages(channelId, { limit: 100 });
            // Backend returns newest-first; reverse for chronological display.
            setMessages([...res.rows].reverse());
        } catch (err) {
            setMessages([]);
            toast.error(err instanceof Error ? err.message : 'Failed to load messages');
        } finally {
            setLoadingMessages(false);
        }
    }, []);

    useEffect(() => {
        if (!activeId) return;
        loadMessages(activeId);
        // Tell the server we've focused this channel so presence /
        // membership checks can short-circuit on subsequent sends.
        websocket.send('chat:join_channel', { channel_id: activeId });
        // Reset the channel's unread badge optimistically.
        setChannels((prev) => prev.map((c) =>
            c.id === activeId ? { ...c, unread_count: 0 } : c,
        ));
    }, [activeId, loadMessages]);

    // Scroll to bottom whenever the message list changes.
    useEffect(() => {
        messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
    }, [messages.length]);

    // ---- realtime ---------------------------------------------------------

    useWebSocket<ChatMessagePush>('chat:message', (push) => {
        const incoming: ChatMessage = {
            id: push.message_id,
            channel_id: push.channel_id,
            topic_id: push.topic_id,
            sender_user_id: push.sender_id,
            sender_name: push.sender_name,
            sender_avatar_url: null,
            content: push.content,
            created_at: push.created_at,
        };
        if (push.channel_id === activeId) {
            setMessages((prev) => [...prev, incoming]);
            // Mark the latest message as read so the badge stays at zero.
            websocket.send('chat:mark_read', {
                channel_id: push.channel_id,
                message_id: push.message_id,
            });
        } else {
            // Inactive channel — bump its unread badge + last-message preview.
            setChannels((prev) => prev.map((c) =>
                c.id === push.channel_id
                    ? {
                        ...c,
                        unread_count: c.unread_count + 1,
                        last_message_preview: push.content.slice(0, 80),
                        last_message_at: push.created_at,
                    }
                    : c,
            ));
        }
    });

    useWebSocket<ChatUnreadUpdatePush>('chat:unread_update', (push) => {
        setChannels((prev) => prev.map((c) =>
            c.id === push.channel_id
                ? { ...c, unread_count: push.unread_count }
                : c,
        ));
    });

    // ---- send -------------------------------------------------------------

    async function send(): Promise<void> {
        if (!activeId || !draft.trim() || sending) return;
        const content = draft.trim();
        setSending(true);

        if (websocket.isConnected()) {
            // Optimistic local append; the echo from the server (handlers.js
            // sends the message back to the sender too) will dedupe on id.
            websocket.send('chat:send_message', {
                channel_id: activeId,
                content,
            });
            setDraft('');
            setSending(false);
            return;
        }

        // Fallback REST path — used when the socket is reconnecting.
        try {
            const created = await chatApi.sendMessage(activeId, content);
            setMessages((prev) => [...prev, created]);
            setDraft('');
        } catch (err) {
            toast.error(err instanceof Error ? err.message : 'Send failed');
        } finally {
            setSending(false);
        }
    }

    function handleKey(e: React.KeyboardEvent<HTMLTextAreaElement>): void {
        if (e.key === 'Enter' && !e.shiftKey) {
            e.preventDefault();
            send();
        }
    }

    // ---- render -----------------------------------------------------------

    return (
        <div className="flex h-[calc(100vh-7rem)] gap-3 overflow-hidden">
            {/* CHANNEL LIST */}
            <aside className="flex w-72 shrink-0 flex-col rounded-md border border-border bg-card">
                <div className="border-b border-border p-2">
                    <div className="relative">
                        <Search
                            size={14}
                            className="absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground"
                        />
                        <Input
                            value={search}
                            onChange={(e) => setSearch(e.target.value)}
                            placeholder="Search channels…"
                            className="pl-8"
                        />
                    </div>
                </div>
                <div className="flex-1 overflow-y-auto">
                    {loadingChannels ? (
                        <p className="p-4 text-sm text-muted-foreground">Loading…</p>
                    ) : filteredChannels.length === 0 ? (
                        <p className="p-4 text-sm text-muted-foreground">No channels.</p>
                    ) : (
                        <ul className="divide-y divide-border">
                            {filteredChannels.map((c) => (
                                <li key={c.id}>
                                    <button
                                        type="button"
                                        onClick={() => setActiveId(c.id)}
                                        className={cn(
                                            'flex w-full items-start gap-2 px-3 py-2 text-left text-sm',
                                            'hover:bg-accent',
                                            c.id === activeId && 'bg-accent font-medium',
                                        )}
                                    >
                                        <ChannelIcon type={c.channel_type} />
                                        <div className="min-w-0 flex-1">
                                            <div className="flex items-center justify-between">
                                                <span className="truncate">{c.title}</span>
                                                {c.unread_count > 0 && (
                                                    <span className="ml-2 inline-flex h-4 min-w-4 items-center justify-center rounded-full bg-destructive px-1 text-[10px] font-semibold text-destructive-foreground">
                                                        {c.unread_count > 99 ? '99+' : c.unread_count}
                                                    </span>
                                                )}
                                            </div>
                                            {c.last_message_preview && (
                                                <p className="truncate text-xs text-muted-foreground">
                                                    {c.last_message_preview}
                                                </p>
                                            )}
                                        </div>
                                    </button>
                                </li>
                            ))}
                        </ul>
                    )}
                </div>
            </aside>

            {/* THREAD */}
            <section className="flex min-w-0 flex-1 flex-col rounded-md border border-border bg-card">
                {!activeChannel ? (
                    <div className="flex flex-1 items-center justify-center text-sm text-muted-foreground">
                        <MessageSquare size={16} className="mr-2" />
                        Select a channel to start chatting.
                    </div>
                ) : (
                    <>
                        <header className="flex items-center justify-between border-b border-border px-4 py-2">
                            <div className="flex items-center gap-2">
                                <ChannelIcon type={activeChannel.channel_type} />
                                <div>
                                    <p className="text-sm font-semibold">{activeChannel.title}</p>
                                    {activeChannel.description && (
                                        <p className="text-xs text-muted-foreground">
                                            {activeChannel.description}
                                        </p>
                                    )}
                                </div>
                            </div>
                            <span className="text-xs text-muted-foreground">
                                {activeChannel.member_count} member{activeChannel.member_count === 1 ? '' : 's'}
                            </span>
                        </header>

                        <div className="flex-1 overflow-y-auto p-4">
                            {loadingMessages ? (
                                <p className="text-sm text-muted-foreground">Loading…</p>
                            ) : messages.length === 0 ? (
                                <p className="text-sm text-muted-foreground">
                                    No messages yet. Be the first to say hi.
                                </p>
                            ) : (
                                <ul className="space-y-3">
                                    {messages.map((m, idx) => {
                                        const prev = idx > 0 ? messages[idx - 1] : null;
                                        const showHeader = !prev
                                            || prev.sender_user_id !== m.sender_user_id
                                            || hoursBetween(prev.created_at, m.created_at) >= 1;
                                        const isMe = !!user && m.sender_user_id === user.id;
                                        return (
                                            <li key={m.id} className="space-y-0.5">
                                                {showHeader && (
                                                    <div className="flex items-center gap-2">
                                                        <span className="text-sm font-semibold">
                                                            {isMe ? 'You' : (m.sender_name || 'Unknown')}
                                                        </span>
                                                        <span className="text-[10px] text-muted-foreground">
                                                            {formatDate(m.created_at, { withTime: true })}
                                                            {' · '}
                                                            {relativeTime(m.created_at)}
                                                        </span>
                                                    </div>
                                                )}
                                                <p className="whitespace-pre-wrap text-sm text-foreground">
                                                    {m.content}
                                                </p>
                                            </li>
                                        );
                                    })}
                                </ul>
                            )}
                            <div ref={messagesEndRef} />
                        </div>

                        <div className="border-t border-border p-3">
                            <div className="flex items-end gap-2">
                                <textarea
                                    rows={2}
                                    value={draft}
                                    placeholder={`Message ${activeChannel.title}…`}
                                    onChange={(e) => setDraft(e.target.value)}
                                    onKeyDown={handleKey}
                                    className="flex-1 resize-none rounded-md border border-input bg-background px-3 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                                />
                                <Button
                                    type="button"
                                    onClick={send}
                                    disabled={!draft.trim() || sending}
                                    size="sm"
                                >
                                    <Send size={14} />
                                    Send
                                </Button>
                            </div>
                            <p className="mt-1 text-[10px] text-muted-foreground">
                                Enter to send · Shift+Enter for newline
                            </p>
                        </div>
                    </>
                )}
            </section>
        </div>
    );
}

function ChannelIcon({ type }: { type: ChatChannel['channel_type'] }) {
    if (type === 'direct') return <User size={14} className="mt-0.5 shrink-0" />;
    if (type === 'topic') return <MessageSquare size={14} className="mt-0.5 shrink-0" />;
    return <Hash size={14} className="mt-0.5 shrink-0" />;
}

function hoursBetween(a: string, b: string): number {
    const da = new Date(a).getTime();
    const db = new Date(b).getTime();
    if (Number.isNaN(da) || Number.isNaN(db)) return 0;
    return Math.abs(db - da) / (60 * 60 * 1000);
}
