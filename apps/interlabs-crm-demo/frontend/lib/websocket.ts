import { env } from './env';
import { getAccessToken } from './auth';

/**
 * WebSocket singleton — one connection per browser tab shared across every
 * component that needs realtime events.
 *
 * Contract:
 *   - connect()    — idempotent; safe to call on every login or mount
 *   - disconnect() — called on logout so the next user doesn't inherit
 *                    the previous user's JWT-bound socket
 *   - on(event, handler) / off(event, handler) — per-event subscription.
 *     The handler receives the `data` payload only (server envelope is
 *     unwrapped here).
 *
 * Reconnect: exponential backoff (1s, 2s, 4s, 8s, 16s) up to 5 retries,
 * then stops. If the auth token is missing we never attempt to connect.
 *
 * Event shape (matches backend `websocket/emitter.js`):
 *   { event: 'notification:new', data: {...}, ts: '...' }
 */

type Handler<T = unknown> = (payload: T) => void;

class WebSocketClient {
    private socket: WebSocket | null = null;
    private handlers = new Map<string, Set<Handler>>();
    private reconnectAttempt = 0;
    private reconnectTimer: ReturnType<typeof setTimeout> | null = null;
    private manualDisconnect = false;
    private readonly maxReconnects = 5;

    connect(): void {
        if (typeof window === 'undefined') return;
        if (this.socket
            && (this.socket.readyState === WebSocket.OPEN
                || this.socket.readyState === WebSocket.CONNECTING)) {
            return;
        }
        const token = getAccessToken();
        if (!token) return; // nothing to auth with; caller must login first

        this.manualDisconnect = false;

        // Browser WebSocket can't set custom headers, so the token rides
        // in the query string per the backend handshake contract.
        const url = `${env.wsUrl}?token=${encodeURIComponent(token)}`;
        try {
            this.socket = new WebSocket(url);
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[ws] construct failed', err);
            this.scheduleReconnect();
            return;
        }

        this.socket.addEventListener('open', () => {
            this.reconnectAttempt = 0;
        });

        this.socket.addEventListener('message', (event) => {
            this.dispatch(event.data);
        });

        this.socket.addEventListener('close', () => {
            this.socket = null;
            if (!this.manualDisconnect) this.scheduleReconnect();
        });

        this.socket.addEventListener('error', () => {
            // The close event follows; reconnect is scheduled there.
        });
    }

    disconnect(): void {
        this.manualDisconnect = true;
        if (this.reconnectTimer) {
            clearTimeout(this.reconnectTimer);
            this.reconnectTimer = null;
        }
        if (this.socket) {
            try { this.socket.close(1000, 'client logout'); } catch { /* ignore */ }
            this.socket = null;
        }
        this.reconnectAttempt = 0;
    }

    on<T = unknown>(eventName: string, handler: Handler<T>): () => void {
        let set = this.handlers.get(eventName);
        if (!set) {
            set = new Set();
            this.handlers.set(eventName, set);
        }
        set.add(handler as Handler);
        return () => this.off(eventName, handler);
    }

    off<T = unknown>(eventName: string, handler: Handler<T>): void {
        const set = this.handlers.get(eventName);
        if (!set) return;
        set.delete(handler as Handler);
        if (set.size === 0) this.handlers.delete(eventName);
    }

    /** Send a JSON envelope to the server. Used for chat:send_message etc. */
    send(eventName: string, data: unknown): void {
        if (!this.socket || this.socket.readyState !== WebSocket.OPEN) return;
        try {
            this.socket.send(JSON.stringify({ event: eventName, data }));
        } catch (err) {
            // eslint-disable-next-line no-console
            console.error('[ws] send failed', err);
        }
    }

    isConnected(): boolean {
        return !!this.socket && this.socket.readyState === WebSocket.OPEN;
    }

    private dispatch(raw: unknown): void {
        let parsed: { event?: string; data?: unknown } | null = null;
        try {
            parsed = typeof raw === 'string' ? JSON.parse(raw) : null;
        } catch {
            return;
        }
        const eventName = parsed?.event;
        if (!eventName) return;
        const set = this.handlers.get(eventName);
        if (!set) return;
        for (const handler of set) {
            try { handler(parsed.data); }
            catch (err) {
                // eslint-disable-next-line no-console
                console.error(`[ws] handler threw for ${eventName}`, err);
            }
        }
    }

    private scheduleReconnect(): void {
        if (this.manualDisconnect) return;
        if (this.reconnectAttempt >= this.maxReconnects) return;
        const delay = Math.min(16_000, 1_000 * 2 ** this.reconnectAttempt);
        this.reconnectAttempt += 1;
        this.reconnectTimer = setTimeout(() => {
            this.reconnectTimer = null;
            this.connect();
        }, delay);
    }
}

export const websocket = new WebSocketClient();
