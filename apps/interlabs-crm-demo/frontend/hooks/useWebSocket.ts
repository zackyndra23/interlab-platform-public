'use client';

import { useEffect, useRef } from 'react';

import { websocket } from '@/lib/websocket';

/**
 * Subscribe a component to a single WebSocket event. The handler is
 * cleaned up on unmount.
 *
 * Implementation note: the websocket client only needs one registration
 * per subscription, so we bind a *stable* wrapper and route incoming
 * payloads through a ref that always holds the latest handler closure.
 * This way callers can write handlers that close over React state
 * (`activeId`, `result`, `tab`, …) without stale-closure bugs and without
 * having to memoise the handler themselves.
 */
export function useWebSocket<T = unknown>(
    eventName: string,
    handler: (payload: T) => void,
): void {
    const handlerRef = useRef(handler);

    // Keep the ref aimed at the most recent closure. No deps: this runs
    // after every render, which is what we want.
    useEffect(() => {
        handlerRef.current = handler;
    });

    useEffect(() => {
        const stable = (payload: T): void => { handlerRef.current(payload); };
        const off = websocket.on<T>(eventName, stable);
        return off;
    }, [eventName]);
}
