/**
 * @module api
 * Internal API routes for the Mockcraft UI dashboard.
 * All routes are under /__mockcraft__/api/*
 */

import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import { listFixtures, deleteFixture } from './fixtures.js';
import { generateMockResponse } from './ai.js';
import { getConnectedClients } from './ws.js';
import type { MockcraftConfig } from './config.js';
import { createRateLimiter, sanitizeFilename, safePath, SecurityError } from './security.js';

// ─────────────────────────────────────────────────────────────
// SECURITY: Rate limiter for API endpoints
// ─────────────────────────────────────────────────────────────
const apiRateLimiter = createRateLimiter(30, 60_000);

/**
 * Create the internal API router for the Mockcraft dashboard.
 */
export function createApiRouter(config: MockcraftConfig): Hono {
    const api = new Hono();

    // ─── Health ──────────────────────────────────────────────
    api.get('/health', (c) => {
        return c.json({
            status: 'ok',
            version: '0.1.0',
            wsClients: getConnectedClients(),
        });
    });

    // ─── Config (safe subset) ────────────────────────────────
    api.get('/config', (c) => {
        // SECURITY: Never expose API keys or sensitive data
        return c.json({
            port: config.port,
            fixturesDir: config.fixturesDir,
            schemaPath: config.schemaPath || null,
            proxy: config.proxy
                ? {
                      target: config.proxy.target,
                      record: config.proxy.record,
                      forwardAuth: config.proxy.forwardAuth,
                  }
                : null,
            ai: {
                provider: config.ai.provider,
                model: config.ai.model,
                temperature: config.ai.temperature,
                maxTokens: config.ai.maxTokens,
                // SECURITY: API key is NEVER returned — only presence indicator
                hasApiKey: !!config.ai.apiKey,
                baseUrl: config.ai.provider === 'ollama' ? config.ai.baseUrl : undefined,
            },
        });
    });

    // ─── List fixtures ───────────────────────────────────────
    api.get('/fixtures', (c) => {
        try {
            const fixtures = listFixtures(config.fixturesDir);
            return c.json({ fixtures });
        } catch {
            return c.json({ error: 'Failed to list fixtures' }, 500);
        }
    });

    // ─── Get single fixture ──────────────────────────────────
    api.get('/fixtures/detail/*', (c) => {
        // Extract everything after /fixtures/detail/
        const filename = decodeURIComponent(
            c.req.path.replace('/__mockcraft__/api/fixtures/detail/', ''),
        );
        const safeFilename = sanitizeFilename(filename);

        if (!safeFilename.endsWith('.json')) {
            return c.json({ error: 'Invalid fixture filename' }, 400);
        }

        try {
            // SECURITY: Path traversal prevention — validate resolved path is inside fixtures dir
            const filePath = safePath(safeFilename, path.resolve(config.fixturesDir));

            if (!fs.existsSync(filePath)) {
                return c.json({ error: 'Fixture not found' }, 404);
            }

            const content = fs.readFileSync(filePath, 'utf-8');
            return c.json(JSON.parse(content));
        } catch (err) {
            if (err instanceof SecurityError) {
                return c.json({ error: 'Invalid fixture path' }, 400);
            }
            return c.json({ error: 'Failed to read fixture' }, 500);
        }
    });

    // ─── Delete fixture ──────────────────────────────────────
    api.delete('/fixtures/:filename', (c) => {
        const filename = c.req.param('filename');
        // SECURITY: Sanitize filename to prevent path traversal
        const safeFilename = sanitizeFilename(filename);

        if (!safeFilename.endsWith('.json')) {
            return c.json({ error: 'Invalid fixture filename' }, 400);
        }

        const deleted = deleteFixture(config.fixturesDir, safeFilename);
        if (deleted) {
            return c.json({ success: true });
        }
        return c.json({ error: 'Fixture not found' }, 404);
    });

    // ─── Regenerate with AI ──────────────────────────────────
    api.post('/ai/regenerate', async (c) => {
        // SECURITY: Rate limit AI requests
        const rateCheck = apiRateLimiter.check('ai-regenerate');
        if (!rateCheck.allowed) {
            return c.json(
                {
                    error: 'Rate limit exceeded',
                    retryAfter: Math.ceil(rateCheck.resetIn / 1000),
                },
                429,
            );
        }

        try {
            const body = await c.req.json();

            // SECURITY: Validate input
            if (!body.method || !body.path) {
                return c.json({ error: 'method and path are required' }, 400);
            }

            if (typeof body.method !== 'string' || typeof body.path !== 'string') {
                return c.json({ error: 'method and path must be strings' }, 400);
            }

            const response = await generateMockResponse(config, {
                method: body.method,
                path: body.path,
                query: body.query,
            });

            return c.json({
                success: true,
                response: {
                    status: response.status,
                    body: response.body,
                    provider: response.provider,
                    model: response.model,
                },
            });
        } catch (err) {
            // SECURITY: Don't leak internal error details
            const message = err instanceof Error ? err.message : 'AI generation failed';
            return c.json({ error: message }, 500);
        }
    });

    // ─── AI Status ───────────────────────────────────────────
    api.get('/ai/status', (c) => {
        return c.json({
            provider: config.ai.provider,
            model: config.ai.model,
            enabled: config.ai.provider !== 'none',
            // SECURITY: Never expose API key — only availability
            hasApiKey: !!config.ai.apiKey,
        });
    });

    return api;
}
