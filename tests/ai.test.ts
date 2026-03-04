/**
 * @module tests/ai
 * Tests for AI provider integration (mocked HTTP, rate limits, SSRF).
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { generateMockResponse, resetAIRateLimiter } from '../src/ai.js';
import type { MockcraftConfig } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

function makeConfig(overrides: Partial<MockcraftConfig['ai']> = {}): MockcraftConfig {
    return {
        port: 3000,
        fixturesDir: tempDir,
        ai: {
            provider: 'ollama',
            model: 'llama3.2',
            baseUrl: 'http://localhost:11434',
            temperature: 0.7,
            maxTokens: 800,
            ...overrides,
        },
    };
}

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-ai-'));
    resetAIRateLimiter();
    vi.restoreAllMocks();
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── Provider: none ──────────────────────────────────────────

describe('AI provider: none', () => {
    it('should throw when provider is none', async () => {
        const config = makeConfig({ provider: 'none' });
        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/test' })
        ).rejects.toThrow(/provider.*none/i);
    });
});

// ─── SSRF Protection ────────────────────────────────────────

describe('AI SSRF protection', () => {
    it('should reject non-localhost URL for ollama', async () => {
        const config = makeConfig({
            provider: 'ollama',
            baseUrl: 'http://evil.com:11434',
        });

        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/test' })
        ).rejects.toThrow(/SSRF/);
    });

    it('should reject HTTP URL for grok', async () => {
        const config = makeConfig({
            provider: 'grok',
            baseUrl: 'http://api.x.ai',
            apiKey: 'test-key',
        });

        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/test' })
        ).rejects.toThrow(/SSRF/);
    });
});

// ─── API Key Validation ─────────────────────────────────────

describe('AI API key validation', () => {
    it('should throw when grok API key is missing', async () => {
        const config = makeConfig({ provider: 'grok', baseUrl: 'https://api.x.ai' });
        delete config.ai.apiKey;

        // Mock fetch to not make real requests
        vi.stubGlobal('fetch', vi.fn());

        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/test' })
        ).rejects.toThrow(/GROK_API_KEY/);
    });

    it('should throw when claude API key is missing', async () => {
        const config = makeConfig({ provider: 'claude', baseUrl: 'https://api.anthropic.com' });
        delete config.ai.apiKey;

        vi.stubGlobal('fetch', vi.fn());

        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/test' })
        ).rejects.toThrow(/ANTHROPIC_API_KEY/);
    });
});

// ─── Rate Limiting ───────────────────────────────────────────

describe('AI rate limiting', () => {
    it('should enforce rate limits', async () => {
        const config = makeConfig({ provider: 'ollama' });

        // Mock fetch to simulate successful Ollama response
        const mockResponse = {
            ok: true,
            json: () => Promise.resolve({
                message: { content: '{"status":200,"body":{"ok":true}}' },
            }),
        };
        vi.stubGlobal('fetch', vi.fn().mockResolvedValue(mockResponse));

        // Make 10 calls (should all succeed)
        for (let i = 0; i < 10; i++) {
            await generateMockResponse(config, { method: 'GET', path: '/api/ratelimit' });
        }

        // 11th call should be rate limited
        await expect(
            generateMockResponse(config, { method: 'GET', path: '/api/ratelimit' })
        ).rejects.toThrow(/Rate limit/);
    });
});

// ─── Successful Ollama Call ──────────────────────────────────

describe('AI Ollama integration (mocked)', () => {
    it('should parse a successful Ollama response', async () => {
        const config = makeConfig({ provider: 'ollama' });

        const mockBody = JSON.stringify({
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { users: [{ id: 1, name: 'Alice' }] },
        });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({ message: { content: mockBody } }),
        }));

        const result = await generateMockResponse(config, {
            method: 'GET',
            path: '/api/users',
        });

        expect(result.status).toBe(200);
        expect(result.provider).toBe('ollama');
        expect(result.body).toEqual({ users: [{ id: 1, name: 'Alice' }] });
    });

    it('should auto-save AI response as fixture', async () => {
        const config = makeConfig({ provider: 'ollama' });

        vi.stubGlobal('fetch', vi.fn().mockResolvedValue({
            ok: true,
            json: () => Promise.resolve({
                message: { content: '{"status":200,"body":{"saved":true}}' },
            }),
        }));

        await generateMockResponse(config, { method: 'GET', path: '/api/saved' });

        // Check fixture was saved
        const files = fs.readdirSync(tempDir);
        expect(files.length).toBeGreaterThan(0);
        expect(files[0]).toMatch(/\.json$/);
    });
});
