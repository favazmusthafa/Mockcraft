/**
 * @module server
 * Core Hono server for Mockcraft.
 * Orchestrates fixtures, schema, proxy, AI fallback, and serves the UI.
 */

import { Hono } from 'hono';
import { serve } from '@hono/node-server';
import type { Server } from 'node:http';
import path from 'node:path';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';

import type { MockcraftConfig } from './config.js';
import { loadFixture, ensureFixturesDir } from './fixtures.js';
import { loadSchema, matchSchemaRoute, type SchemaRoute } from './schema.js';
import { generateMockResponse } from './ai.js';
import { proxyRequest } from './proxy.js';
import { initWebSocket, broadcastEvent } from './ws.js';
import { createApiRouter } from './api.js';
import { isAllowedOrigin, MAX_BODY_SIZE, safeLog, safeError } from './security.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface MockcraftServer {
    app: Hono;
    server: Server;
    config: MockcraftConfig;
    close: () => void;
}

// ─────────────────────────────────────────────────────────────
// Server factory
// ─────────────────────────────────────────────────────────────

/**
 * Create and start the Mockcraft server.
 * This is the main entry point for both CLI and programmatic use.
 */
export async function createServer(config: MockcraftConfig): Promise<MockcraftServer> {
    const app = new Hono();

    // Ensure fixtures directory exists
    ensureFixturesDir(config.fixturesDir);

    // Load OpenAPI schema if configured
    let schemaRoutes: SchemaRoute[] = [];
    if (config.schemaPath) {
        schemaRoutes = loadSchema(config.schemaPath);
    }

    // ─── Security middleware ───────────────────────────────────

    // SECURITY: Security headers on ALL responses
    app.use('*', async (c, next) => {
        await next();
        // SECURITY: X-Content-Type-Options prevents MIME sniffing
        c.res.headers.set('X-Content-Type-Options', 'nosniff');
        // SECURITY: X-Frame-Options prevents clickjacking
        c.res.headers.set('X-Frame-Options', 'DENY');
        // SECURITY: X-XSS-Protection (legacy browser support)
        c.res.headers.set('X-XSS-Protection', '1; mode=block');
        // SECURITY: Referrer-Policy
        c.res.headers.set('Referrer-Policy', 'no-referrer');
        // SECURITY: CSP for UI routes
        if (c.req.path.startsWith('/__mockcraft__')) {
            c.res.headers.set(
                'Content-Security-Policy',
                "default-src 'self'; script-src 'self' 'unsafe-inline'; style-src 'self' 'unsafe-inline'; connect-src 'self' ws://localhost:* ws://127.0.0.1:*; img-src 'self' data:;",
            );
        }
    });

    // SECURITY: CORS — locked to localhost only, no wildcards
    app.use('*', async (c, next) => {
        const origin = c.req.header('origin');

        if (origin && isAllowedOrigin(origin)) {
            c.res.headers.set('Access-Control-Allow-Origin', origin);
            c.res.headers.set(
                'Access-Control-Allow-Methods',
                'GET, POST, PUT, PATCH, DELETE, OPTIONS',
            );
            c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Accept');
            c.res.headers.set('Access-Control-Max-Age', '86400');
        }

        if (c.req.method === 'OPTIONS') {
            return new Response(null, { status: 204, headers: c.res.headers });
        }

        await next();
    });

    // SECURITY: Body size limit — 1MB max for JSON
    app.use('*', async (c, next) => {
        const contentLength = c.req.header('content-length');
        if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
            return c.json({ error: 'Request body too large (1MB limit)' }, 413);
        }
        await next();
    });

    // ─── Request logging & broadcasting ────────────────────────

    app.use('*', async (c, next) => {
        // SECURITY: Never log request bodies that may contain secrets
        if (!c.req.path.startsWith('/__mockcraft__')) {
            safeLog(`[mockcraft] ← ${c.req.method} ${c.req.path}`);

            broadcastEvent({
                type: 'request',
                method: c.req.method,
                path: c.req.path,
                timestamp: Date.now(),
            });
        }
        await next();
    });

    // ─── Internal API routes (__mockcraft__/api) ───────────────

    const apiRouter = createApiRouter(config);
    app.route('/__mockcraft__/api', apiRouter);

    // ─── UI static files ──────────────────────────────────────

    app.get('/__mockcraft__', (c) => {
        return c.redirect('/__mockcraft__/');
    });

    app.get('/__mockcraft__/*', (c) => {
        // Try to serve built UI files
        const __dirname = path.dirname(fileURLToPath(import.meta.url));
        const uiDistDir = path.resolve(__dirname, '..', 'ui-dist');

        let requestedPath = c.req.path.replace('/__mockcraft__/', '') || 'index.html';
        if (requestedPath === '' || requestedPath.endsWith('/')) {
            requestedPath = 'index.html';
        }

        const filePath = path.resolve(uiDistDir, requestedPath);

        // SECURITY: Path traversal prevention for UI files
        if (!filePath.startsWith(uiDistDir)) {
            return c.json({ error: 'Not found' }, 404);
        }

        if (fs.existsSync(filePath) && fs.statSync(filePath).isFile()) {
            const ext = path.extname(filePath);
            const contentTypes: Record<string, string> = {
                '.html': 'text/html',
                '.js': 'application/javascript',
                '.css': 'text/css',
                '.svg': 'image/svg+xml',
                '.png': 'image/png',
                '.ico': 'image/x-icon',
            };
            const contentType = contentTypes[ext] || 'application/octet-stream';
            const content = fs.readFileSync(filePath);
            return new Response(content, {
                headers: { 'Content-Type': contentType },
            });
        }

        // SPA fallback: serve index.html for unmatched routes
        const indexPath = path.resolve(uiDistDir, 'index.html');
        if (fs.existsSync(indexPath)) {
            const content = fs.readFileSync(indexPath);
            return new Response(content, {
                headers: { 'Content-Type': 'text/html' },
            });
        }

        // If no UI is built, return a placeholder
        return c.html(`
      <!DOCTYPE html>
      <html lang="en">
      <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Mockcraft Inspector</title>
        <style>
          * { margin: 0; padding: 0; box-sizing: border-box; }
          body {
            font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
            background: #0a0a0a; color: #e5e5e5;
            display: flex; align-items: center; justify-content: center;
            min-height: 100vh;
          }
          .container { text-align: center; max-width: 480px; padding: 2rem; }
          h1 { font-size: 2.5rem; margin-bottom: 0.5rem;
            background: linear-gradient(135deg, #6366f1, #a855f7, #ec4899);
            -webkit-background-clip: text; -webkit-text-fill-color: transparent; }
          p { color: #a3a3a3; line-height: 1.6; margin-top: 1rem; }
          code { background: #1a1a2e; padding: 0.2em 0.5em; border-radius: 4px;
            font-size: 0.9em; color: #a855f7; }
          .status { margin-top: 2rem; padding: 1rem; border-radius: 8px;
            background: #111827; border: 1px solid #1f2937; }
          .dot { display: inline-block; width: 8px; height: 8px; border-radius: 50%;
            background: #22c55e; margin-right: 8px; animation: pulse 2s infinite; }
          @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.5; } }
        </style>
      </head>
      <body>
        <div class="container">
          <h1>⚡ Mockcraft</h1>
          <p>Mock server is running! Build the UI for the full inspector experience.</p>
          <div class="status">
            <span class="dot"></span>
            Server active on port <code>${config.port}</code>
          </div>
          <p style="margin-top:1.5rem;font-size:0.85rem;">
            Run <code>cd ui && npm install && npm run build</code> to build the inspector UI.
          </p>
        </div>
      </body>
      </html>
    `);
    });

    // ─── Mock route resolution (fixture → schema → proxy → AI) ──

    app.all('*', async (c) => {
        const method = c.req.method;
        const url = new URL(c.req.url);
        const pathname = url.pathname;
        const query = url.search.replace(/^\?/, '') || undefined;

        // 1. Try fixture match
        const fixture = loadFixture(config.fixturesDir, method, pathname, query);
        if (fixture) {
            safeLog(`[mockcraft] → Fixture hit: ${method} ${pathname}`);
            broadcastEvent({
                type: 'response',
                method,
                path: pathname,
                status: fixture.status,
                source: 'fixture',
                timestamp: Date.now(),
            });
            return c.json(fixture.body as object, fixture.status as 200);
        }

        // 2. Try schema match
        const schemaRoute = matchSchemaRoute(schemaRoutes, method, pathname);
        if (schemaRoute?.exampleResponse) {
            safeLog(`[mockcraft] → Schema hit: ${method} ${pathname}`);
            broadcastEvent({
                type: 'response',
                method,
                path: pathname,
                status: schemaRoute.statusCode,
                source: 'schema',
                timestamp: Date.now(),
            });
            return c.json(schemaRoute.exampleResponse as object, schemaRoute.statusCode as 200);
        }

        // 3. Try proxy
        if (config.proxy?.target) {
            return proxyRequest(c, config);
        }

        // 4. Try AI fallback
        if (config.ai.provider !== 'none') {
            try {
                const aiResponse = await generateMockResponse(config, {
                    method,
                    path: pathname,
                    query,
                });

                safeLog(`[mockcraft] → AI generated: ${method} ${pathname}`);
                broadcastEvent({
                    type: 'response',
                    method,
                    path: pathname,
                    status: aiResponse.status,
                    source: 'ai',
                    timestamp: Date.now(),
                    data: { provider: aiResponse.provider, model: aiResponse.model },
                });

                return c.json(aiResponse.body as object, aiResponse.status as 200);
            } catch (err) {
                // SECURITY: Don't expose AI errors to clients
                safeError(
                    '[mockcraft] AI fallback failed:',
                    err instanceof Error ? err.message : 'Unknown',
                );
            }
        }

        // 5. No match — return 404
        broadcastEvent({
            type: 'response',
            method,
            path: pathname,
            status: 404,
            source: 'none',
            timestamp: Date.now(),
        });

        return c.json(
            {
                error: 'No mock found',
                method,
                path: pathname,
                hint: 'Create a fixture, add an OpenAPI schema, configure a proxy, or enable an AI provider.',
            },
            404,
        );
    });

    // ─── Start HTTP server ─────────────────────────────────────

    return new Promise<MockcraftServer>((resolve) => {
        const httpServer = serve(
            {
                fetch: app.fetch,
                port: config.port,
            },
            () => {
                // Initialize WebSocket on the HTTP server
                // @ts-expect-error — @hono/node-server returns a compatible HTTP server but types diverge from node:http.Server
                initWebSocket(httpServer);

                safeLog(`\n  ⚡ Mockcraft v0.1.0`);
                safeLog(`  → Mock server:  http://localhost:${config.port}`);
                safeLog(`  → Inspector UI: http://localhost:${config.port}/__mockcraft__`);
                safeLog(`  → WebSocket:    ws://localhost:${config.port}/__mockcraft__/ws`);
                if (config.ai.provider !== 'none') {
                    safeLog(`  → AI Provider:  ${config.ai.provider} (${config.ai.model})`);
                }
                if (config.proxy?.target) {
                    safeLog(`  → Proxy target: ${config.proxy.target}`);
                }
                safeLog('');

                resolve({
                    app,
                    // @ts-expect-error — @hono/node-server returns a compatible HTTP server but types diverge from node:http.Server
                    server: httpServer,
                    config,
                    close: () => {
                        httpServer.close();
                    },
                });
            },
        );
    });
}
