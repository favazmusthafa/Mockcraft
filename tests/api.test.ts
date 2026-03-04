/**
 * @module tests/api
 * Tests for the internal API router (fixture CRUD, AI regenerate, config, health).
 * Tests path traversal prevention on the fixture detail endpoint.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { createApiRouter } from '../src/api.js';
import { saveFixture, type Fixture } from '../src/fixtures.js';
import type { MockcraftConfig } from '../src/config.js';
import { Hono } from 'hono';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

function makeConfig(overrides: Partial<MockcraftConfig> = {}): MockcraftConfig {
    return {
        port: 3000,
        fixturesDir: tempDir,
        ai: {
            provider: 'none',
            model: 'llama3.2',
            temperature: 0.7,
            maxTokens: 800,
        },
        ...overrides,
    };
}

function createTestApp(config: MockcraftConfig): Hono {
    const app = new Hono();
    const api = createApiRouter(config);
    app.route('/__mockcraft__/api', api);
    return app;
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-api-'));
    vi.restoreAllMocks();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── Health ──────────────────────────────────────────────────

describe('GET /health', () => {
    it('should return status ok', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/health');
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.status).toBe('ok');
        expect(body.version).toBe('0.1.0');
    });
});

// ─── Config ──────────────────────────────────────────────────

describe('GET /config', () => {
    it('should return config without API key', async () => {
        const config = makeConfig({
            ai: {
                provider: 'grok',
                model: 'grok-beta',
                apiKey: 'super-secret-key',
                temperature: 0.7,
                maxTokens: 800,
            },
        });
        const app = createTestApp(config);
        const res = await app.request('/__mockcraft__/api/config');
        const body = await res.json();

        // SECURITY: API key must never be exposed
        expect(body.ai.hasApiKey).toBe(true);
        expect(body.ai.apiKey).toBeUndefined();
        expect(JSON.stringify(body)).not.toContain('super-secret-key');
    });

    it('should include proxy config when set', async () => {
        const config = makeConfig({
            proxy: { target: 'https://api.example.com', record: true, forwardAuth: false },
        });
        const app = createTestApp(config);
        const res = await app.request('/__mockcraft__/api/config');
        const body = await res.json();
        expect(body.proxy.target).toBe('https://api.example.com');
    });
});

// ─── List Fixtures ───────────────────────────────────────────

describe('GET /fixtures', () => {
    it('should list saved fixtures', async () => {
        const config = makeConfig();
        saveFixture(tempDir, {
            method: 'GET', path: '/api/users', status: 200,
            headers: { 'content-type': 'application/json' },
            body: { users: [] }, createdAt: new Date().toISOString(),
            source: 'manual', hash: '',
        });

        const app = createTestApp(config);
        const res = await app.request('/__mockcraft__/api/fixtures');
        const body = await res.json();
        expect(body.fixtures.length).toBe(1);
        expect(body.fixtures[0].method).toBe('GET');
    });

    it('should return empty array when no fixtures exist', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/fixtures');
        const body = await res.json();
        expect(body.fixtures).toEqual([]);
    });
});

// ─── Delete Fixture ──────────────────────────────────────────

describe('DELETE /fixtures/:filename', () => {
    it('should delete an existing fixture', async () => {
        const config = makeConfig();
        const fixture: Fixture = {
            method: 'GET', path: '/api/items', status: 200,
            headers: {}, body: {}, createdAt: '', source: 'manual', hash: '',
        };
        const filename = saveFixture(tempDir, fixture);

        const app = createTestApp(config);
        const res = await app.request(`/__mockcraft__/api/fixtures/${filename}`, { method: 'DELETE' });
        const body = await res.json();
        expect(body.success).toBe(true);
    });

    it('should return 404 for non-existent fixture', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/fixtures/nonexistent.json', { method: 'DELETE' });
        expect(res.status).toBe(404);
    });

    it('should reject non-JSON filenames', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/fixtures/evil.txt', { method: 'DELETE' });
        expect(res.status).toBe(400);
    });
});

// ─── Fixture Detail — Path Traversal Prevention ──────────────

describe('GET /fixtures/detail/*', () => {
    it('should return a fixture by filename', async () => {
        const config = makeConfig();
        const fixture: Fixture = {
            method: 'GET', path: '/api/detail-test', status: 200,
            headers: { 'content-type': 'application/json' },
            body: { detail: true }, createdAt: new Date().toISOString(),
            source: 'manual', hash: '',
        };
        const filename = saveFixture(tempDir, fixture);

        const app = createTestApp(config);
        const res = await app.request(`/__mockcraft__/api/fixtures/detail/${filename}`);
        expect(res.status).toBe(200);
        const body = await res.json();
        expect(body.body.detail).toBe(true);
    });

    it('should reject path traversal attempts', async () => {
        const app = createTestApp(makeConfig());
        // Attempt to traverse out of fixtures directory
        const res = await app.request('/__mockcraft__/api/fixtures/detail/..%2F..%2Fpackage.json');
        // Should get 400 (SecurityError) because sanitizeFilename strips unsafe chars
        expect(res.status).not.toBe(200);
    });

    it('should return 404 for non-existent fixture', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/fixtures/detail/nonexistent.json');
        expect(res.status).toBe(404);
    });

    it('should reject non-JSON filenames', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/fixtures/detail/evil.txt');
        expect(res.status).toBe(400);
    });
});

// ─── AI Regenerate ───────────────────────────────────────────

describe('POST /ai/regenerate', () => {
    it('should return 400 when method or path is missing', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/ai/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'GET' }),  // missing path
        });
        expect(res.status).toBe(400);
    });

    it('should return 400 when method/path are not strings', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/ai/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 123, path: '/api/test' }),
        });
        expect(res.status).toBe(400);
    });

    it('should return 500 when AI provider is none', async () => {
        const app = createTestApp(makeConfig({ ai: { provider: 'none', model: 'test', temperature: 0.7, maxTokens: 800 } }));
        const res = await app.request('/__mockcraft__/api/ai/regenerate', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ method: 'GET', path: '/api/test' }),
        });
        expect(res.status).toBe(500);
    });
});

// ─── AI Status ───────────────────────────────────────────────

describe('GET /ai/status', () => {
    it('should return AI provider info without API key', async () => {
        const config = makeConfig({
            ai: { provider: 'grok', model: 'grok-beta', apiKey: 'secret', temperature: 0.7, maxTokens: 800 },
        });
        const app = createTestApp(config);
        const res = await app.request('/__mockcraft__/api/ai/status');
        const body = await res.json();
        expect(body.provider).toBe('grok');
        expect(body.hasApiKey).toBe(true);
        expect(body.apiKey).toBeUndefined();
    });

    it('should report disabled when provider is none', async () => {
        const app = createTestApp(makeConfig());
        const res = await app.request('/__mockcraft__/api/ai/status');
        const body = await res.json();
        expect(body.enabled).toBe(false);
    });
});
