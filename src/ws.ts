/**
 * @module ws
 * WebSocket server for live request/response inspection in Mockcraft.
 * Broadcasts events to all connected UI clients.
 */

import { WebSocketServer, WebSocket } from 'ws';
import type { Server } from 'node:http';
import { safeLog, safeError, redact } from './security.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MockcraftEvent {
    type: 'request' | 'response' | 'fixture' | 'ai' | 'proxy' | 'error' | 'config';
    method?: string;
    path?: string;
    status?: number;
    source?: string;
    timestamp: number;
    data?: unknown;
}

// ─────────────────────────────────────────────────────────────
// WebSocket server
// ─────────────────────────────────────────────────────────────

let wss: WebSocketServer | null = null;

/**
 * Initialize the WebSocket server, attached to the HTTP server.
 */
export function initWebSocket(server: Server): WebSocketServer {
    wss = new WebSocketServer({
        server,
        path: '/__mockcraft__/ws',
        // SECURITY: Max payload 64KB for WS messages
        maxPayload: 65_536,
    });

    wss.on('connection', (ws, req) => {
        const origin = req.headers.origin || '';

        // SECURITY: Validate WebSocket origin — localhost only
        if (origin && !isLocalOrigin(origin)) {
            safeLog(`[mockcraft] WS connection rejected from origin: ${origin}`);
            ws.close(1008, 'Origin not allowed');
            return;
        }

        safeLog('[mockcraft] WS client connected');

        ws.on('error', (err) => {
            // SECURITY: Don't leak error details
            safeError('[mockcraft] WS error:', err.message);
        });

        ws.on('close', () => {
            safeLog('[mockcraft] WS client disconnected');
        });
    });

    safeLog('[mockcraft] WebSocket inspector ready at /__mockcraft__/ws');
    return wss;
}

/**
 * Broadcast an event to all connected WebSocket clients.
 * SECURITY: Never broadcast API keys, tokens, or sensitive data.
 */
export function broadcastEvent(event: MockcraftEvent): void {
    if (!wss) return;

    // SECURITY: Sanitize event data before broadcasting
    const sanitized: MockcraftEvent = {
        ...event,
        data: event.data ? sanitizeEventData(event.data) : undefined,
    };

    const message = JSON.stringify(sanitized);

    wss.clients.forEach((client) => {
        if (client.readyState === WebSocket.OPEN) {
            client.send(message);
        }
    });
}

/**
 * Get the number of connected WebSocket clients.
 */
export function getConnectedClients(): number {
    return wss?.clients.size ?? 0;
}

/**
 * Close the WebSocket server.
 */
export function closeWebSocket(): void {
    if (wss) {
        wss.close();
        wss = null;
    }
}

// ─────────────────────────────────────────────────────────────
// Helpers
// ─────────────────────────────────────────────────────────────

function isLocalOrigin(origin: string): boolean {
    try {
        const url = new URL(origin);
        return url.hostname === 'localhost' || url.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

/**
 * SECURITY: Sanitize event data to prevent leaking secrets.
 */
function sanitizeEventData(data: unknown): unknown {
    if (typeof data === 'string') {
        return redact(data);
    }
    if (typeof data === 'object' && data !== null) {
        const sanitized: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(data as Record<string, unknown>)) {
            // SECURITY: Never broadcast authorization, cookies, or API keys
            if (/(?:auth|cookie|key|token|secret)/i.test(key)) {
                sanitized[key] = '[REDACTED]';
            } else if (typeof value === 'string') {
                sanitized[key] = redact(value);
            } else {
                sanitized[key] = value;
            }
        }
        return sanitized;
    }
    return data;
}
