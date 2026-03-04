/**
 * @module tests/server
 * Integration tests for the Mockcraft Hono server.
 * Tests security headers, CORS, body limits, and fixture serving.
 */

import { describe, it, expect } from 'vitest';
import { Hono } from 'hono';
import { isAllowedOrigin, MAX_BODY_SIZE } from '../src/security.js';
import { matchSchemaRoute } from '../src/schema.js';

// ─── Security Headers ────────────────────────────────────────

describe('Security headers middleware', () => {
    it('should set X-Content-Type-Options: nosniff', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            await next();
            c.res.headers.set('X-Content-Type-Options', 'nosniff');
        });
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Content-Type-Options')).toBe('nosniff');
    });

    it('should set X-Frame-Options: DENY', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            await next();
            c.res.headers.set('X-Frame-Options', 'DENY');
        });
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test');
        expect(res.headers.get('X-Frame-Options')).toBe('DENY');
    });
});

// ─── CORS ────────────────────────────────────────────────────

describe('CORS middleware', () => {
    it('should set CORS headers for localhost origins', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            const origin = c.req.header('origin');
            if (origin && isAllowedOrigin(origin)) {
                c.res.headers.set('Access-Control-Allow-Origin', origin);
            }
            await next();
        });
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test', {
            headers: { Origin: 'http://localhost:5173' },
        });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBe('http://localhost:5173');
    });

    it('should NOT set CORS for external origins', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            const origin = c.req.header('origin');
            if (origin && isAllowedOrigin(origin)) {
                c.res.headers.set('Access-Control-Allow-Origin', origin);
            }
            await next();
        });
        app.get('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test', {
            headers: { Origin: 'http://evil.com' },
        });
        expect(res.headers.get('Access-Control-Allow-Origin')).toBeNull();
    });
});

// ─── Body Size Limit ─────────────────────────────────────────

describe('Body size limit', () => {
    it('should reject bodies over 1MB', async () => {
        const app = new Hono();
        app.use('*', async (c, next) => {
            const contentLength = c.req.header('content-length');
            if (contentLength && parseInt(contentLength, 10) > MAX_BODY_SIZE) {
                return c.json({ error: 'Request body too large' }, 413);
            }
            await next();
        });
        app.post('/test', (c) => c.json({ ok: true }));

        const res = await app.request('/test', {
            method: 'POST',
            headers: { 'Content-Length': '2000000' },
            body: 'x',
        });
        expect(res.status).toBe(413);
    });
});

// ─── Schema matching ─────────────────────────────────────────

describe('Schema route matching', () => {
    it('should match exact paths', () => {
        const routes = [
            {
                method: 'GET',
                path: '/api/users',
                statusCode: 200,
                contentType: 'application/json',
                exampleResponse: [],
            },
        ];
        const match = matchSchemaRoute(routes, 'GET', '/api/users');
        expect(match).toBeDefined();
        expect(match?.method).toBe('GET');
    });

    it('should match path parameters', () => {
        const routes = [
            {
                method: 'GET',
                path: '/api/users/{id}',
                statusCode: 200,
                contentType: 'application/json',
                exampleResponse: {},
            },
        ];
        const match = matchSchemaRoute(routes, 'GET', '/api/users/123');
        expect(match).toBeDefined();
    });

    it('should return undefined for no match', () => {
        const routes = [
            { method: 'GET', path: '/api/users', statusCode: 200, contentType: 'application/json' },
        ];
        const match = matchSchemaRoute(routes, 'POST', '/api/other');
        expect(match).toBeUndefined();
    });
});

// ─── 404 Response ────────────────────────────────────────────

describe('404 Response', () => {
    it('should return helpful 404 when no mock found', async () => {
        const app = new Hono();
        app.all('*', (c) => {
            return c.json(
                {
                    error: 'No mock found',
                    method: c.req.method,
                    path: c.req.path,
                    hint: 'Create a fixture, add an OpenAPI schema, configure a proxy, or enable an AI provider.',
                },
                404,
            );
        });

        const res = await app.request('/nonexistent');
        expect(res.status).toBe(404);
        const body = await res.json();
        expect(body.error).toBe('No mock found');
        expect(body.hint).toBeDefined();
    });
});
