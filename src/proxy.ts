/**
 * @module proxy
 * Reverse proxy with recording for Mockcraft.
 * Forwards requests to a target API and optionally records responses as fixtures.
 */

import type { Context } from 'hono';
import {
    stripSensitiveHeaders,
    safeLog,
    validateUrl,
} from './security.js';
import { saveFixture, type Fixture } from './fixtures.js';
import type { MockcraftConfig } from './config.js';
import { broadcastEvent } from './ws.js';

// ─────────────────────────────────────────────────────────────
// Proxy handler
// ─────────────────────────────────────────────────────────────

/**
 * Forward a request to the proxy target and optionally record the response.
 */
export async function proxyRequest(
    c: Context,
    config: MockcraftConfig
): Promise<Response> {
    if (!config.proxy?.target) {
        return c.json(
            { error: 'No proxy target configured' },
            502
        );
    }

    const target = config.proxy.target;

    // SECURITY: Validate proxy target URL
    const urlCheck = validateUrl(target, 'remote');
    if (!urlCheck.valid) {
        console.error(`[mockcraft] SSRF protection: proxy target rejected — ${urlCheck.error}`);
        return c.json({ error: 'Invalid proxy target' }, 502);
    }

    const url = new URL(c.req.path, target);
    url.search = new URL(c.req.url).search;

    // Clone headers
    const headers = new Headers();
    c.req.raw.headers.forEach((value, key) => {
        headers.set(key, value);
    });

    // SECURITY: Strip sensitive headers unless forwardAuth is enabled
    if (!config.proxy.forwardAuth) {
        const stripped = stripSensitiveHeaders(headers);
        if (stripped.length > 0) {
            safeLog(`[mockcraft] ⚠️ Stripped headers from proxy request: ${stripped.join(', ')}`);
        }
    }

    // Remove host header to avoid conflicts
    headers.delete('host');

    const controller = new AbortController();
    // SECURITY: 30s timeout for proxy requests
    const timeout = setTimeout(() => controller.abort(), 30_000);

    try {
        safeLog(`[mockcraft] Proxy → ${c.req.method} ${url.toString()}`);

        const proxyResponse = await fetch(url.toString(), {
            method: c.req.method,
            headers,
            body: ['GET', 'HEAD'].includes(c.req.method) ? undefined : c.req.raw.body,
            signal: controller.signal,
            // eslint-disable-next-line @typescript-eslint/no-explicit-any
            duplex: 'half' as any,
        });

        // Read response body
        const responseBody = await proxyResponse.text();

        // Record response as fixture if enabled
        if (config.proxy.record) {
            try {
                let parsedBody: unknown;
                try {
                    parsedBody = JSON.parse(responseBody);
                } catch {
                    parsedBody = responseBody;
                }

                const fixture: Fixture = {
                    method: c.req.method,
                    path: c.req.path,
                    query: new URL(c.req.url).search.replace(/^\?/, '') || undefined,
                    status: proxyResponse.status,
                    headers: { 'content-type': proxyResponse.headers.get('content-type') || 'application/json' },
                    body: parsedBody,
                    createdAt: new Date().toISOString(),
                    source: 'proxy',
                    hash: '',
                };

                saveFixture(config.fixturesDir, fixture);
                safeLog(`[mockcraft] Recorded proxy response for ${c.req.method} ${c.req.path}`);
            } catch {
                // SECURITY: Don't leak save errors
                console.error('[mockcraft] Failed to record proxy response');
            }
        }

        // Broadcast to WebSocket inspector
        broadcastEvent({
            type: 'response',
            method: c.req.method,
            path: c.req.path,
            status: proxyResponse.status,
            source: 'proxy',
            timestamp: Date.now(),
        });

        // Build response with original headers
        const responseHeaders = new Headers();
        proxyResponse.headers.forEach((value, key) => {
            // SECURITY: Don't forward hop-by-hop headers
            if (!['transfer-encoding', 'connection', 'keep-alive'].includes(key.toLowerCase())) {
                responseHeaders.set(key, value);
            }
        });

        return new Response(responseBody, {
            status: proxyResponse.status,
            statusText: proxyResponse.statusText,
            headers: responseHeaders,
        });
    } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') {
            safeLog(`[mockcraft] Proxy timeout for ${c.req.method} ${url.toString()}`);
            return c.json({ error: 'Proxy request timed out' }, 504);
        }

        // SECURITY: Never leak internal error details
        console.error('[mockcraft] Proxy error:', err instanceof Error ? err.message : 'Unknown error');
        return c.json({ error: 'Proxy request failed' }, 502);
    } finally {
        clearTimeout(timeout);
    }
}
