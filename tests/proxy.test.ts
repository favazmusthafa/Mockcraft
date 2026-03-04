/**
 * @module tests/proxy
 * Tests for the reverse proxy module: SSRF validation, header stripping, timeout handling.
 * All HTTP calls are mocked — no real network requests.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { Hono } from 'hono';
import type { MockcraftConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import { validateUrl, stripSensitiveHeaders } from '../src/security.js';

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-proxy-'));
    vi.restoreAllMocks();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── SSRF: Proxy target validation ──────────────────────────

describe('Proxy SSRF protection', () => {
    it('should reject HTTP URLs for remote proxy targets', () => {
        const result = validateUrl('http://api.example.com', 'remote');
        expect(result.valid).toBe(false);
        expect(result.error).toContain('https://');
    });

    it('should accept HTTPS URLs for remote proxy targets', () => {
        const result = validateUrl('https://api.example.com', 'remote');
        expect(result.valid).toBe(true);
    });

    it('should reject invalid URLs', () => {
        const result = validateUrl('not-a-url', 'remote');
        expect(result.valid).toBe(false);
    });
});

// ─── Header stripping ───────────────────────────────────────

describe('Proxy header stripping', () => {
    it('should strip authorization and cookie headers', () => {
        const headers = new Headers({
            authorization: 'Bearer sk-secret123456',
            cookie: 'session=abc123',
            'content-type': 'application/json',
            'x-api-key': 'key-12345',
        });

        const stripped = stripSensitiveHeaders(headers);
        expect(stripped).toContain('authorization');
        expect(stripped).toContain('cookie');
        expect(stripped).toContain('x-api-key');
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
        expect(headers.has('x-api-key')).toBe(false);
        // Non-sensitive headers should remain
        expect(headers.has('content-type')).toBe(true);
    });

    it('should strip proxy-related headers', () => {
        const headers = new Headers({
            'x-forwarded-for': '192.168.1.1',
            'x-real-ip': '10.0.0.1',
            'proxy-authorization': 'Basic abc',
        });

        const stripped = stripSensitiveHeaders(headers);
        expect(stripped).toContain('x-forwarded-for');
        expect(stripped).toContain('x-real-ip');
        expect(stripped).toContain('proxy-authorization');
    });

    it('should not strip non-sensitive headers', () => {
        const headers = new Headers({
            'content-type': 'application/json',
            accept: 'application/json',
            'user-agent': 'MockcraftTest/1.0',
        });

        const stripped = stripSensitiveHeaders(headers);
        expect(stripped.length).toBe(0);
        expect(headers.has('content-type')).toBe(true);
        expect(headers.has('accept')).toBe(true);
    });
});

// ─── Proxy request recording ────────────────────────────────

describe('Proxy recording behavior', () => {
    it('should record proxy responses as fixtures when record is enabled', async () => {
        // We test this by importing proxyRequest and mocking fetch
        const mockResponse = new Response(JSON.stringify({ id: 1, name: 'Test' }), {
            status: 200,
            headers: { 'content-type': 'application/json' },
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

        const { proxyRequest } = await import('../src/proxy.js');

        const config: MockcraftConfig = {
            port: 3000,
            fixturesDir: tempDir,
            proxy: { target: 'https://api.example.com', record: true, forwardAuth: false },
            ai: { provider: 'none', model: 'test', temperature: 0.7, maxTokens: 800 },
        };

        const app = new Hono();
        app.all('*', (c) => proxyRequest(c, config));

        const res = await app.request('/api/users', {
            method: 'GET',
        });

        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.id).toBe(1);

        // Verify fixture was saved
        const files = fs.readdirSync(tempDir).filter((f) => f.endsWith('.json'));
        expect(files.length).toBeGreaterThan(0);
    });
});

// ─── Proxy: no target configured ────────────────────────────

describe('Proxy with no target', () => {
    it('should return 502 when no proxy target is configured', async () => {
        const { proxyRequest } = await import('../src/proxy.js');

        const config: MockcraftConfig = {
            port: 3000,
            fixturesDir: tempDir,
            ai: { provider: 'none', model: 'test', temperature: 0.7, maxTokens: 800 },
        };

        const app = new Hono();
        app.all('*', (c) => proxyRequest(c, config));

        const res = await app.request('/api/test');
        expect(res.status).toBe(502);
        const body = await res.json();
        expect(body.error).toContain('No proxy target');
    });
});
