/**
 * @module tests/config
 * Tests for configuration loading and validation.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { loadConfig, MockcraftConfigSchema, DEFAULT_CONFIG } from '../src/config.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-config-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── Default config ──────────────────────────────────────────

describe('loadConfig() defaults', () => {
    it('should return default config when no files exist', async () => {
        const config = await loadConfig(tempDir);
        expect(config.port).toBe(3000);
        expect(config.fixturesDir).toBe('./fixtures');
        expect(config.ai.provider).toBe('none');
    });
});

// ─── JSON config ─────────────────────────────────────────────

describe('loadConfig() with JSON', () => {
    it('should load a valid JSON config', async () => {
        const validConfig = {
            port: 4000,
            fixturesDir: './mocks',
            ai: { provider: 'ollama', model: 'llama3.2', baseUrl: 'http://localhost:11434' },
        };

        fs.writeFileSync(
            path.join(tempDir, 'mockcraft.config.json'),
            JSON.stringify(validConfig),
            'utf-8'
        );

        const config = await loadConfig(tempDir);
        expect(config.port).toBe(4000);
        expect(config.fixturesDir).toBe('./mocks');
        expect(config.ai.provider).toBe('ollama');
    });

    it('should throw on invalid port', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'mockcraft.config.json'),
            JSON.stringify({ port: 99999 }),
            'utf-8'
        );

        await expect(loadConfig(tempDir)).rejects.toThrow();
    });
});

// ─── Zod schema validation ──────────────────────────────────

describe('MockcraftConfigSchema', () => {
    it('should accept valid config', () => {
        const result = MockcraftConfigSchema.safeParse({
            port: 3000,
            fixturesDir: './fixtures',
            ai: { provider: 'ollama' },
        });
        expect(result.success).toBe(true);
    });

    it('should reject invalid port', () => {
        const result = MockcraftConfigSchema.safeParse({ port: -1 });
        expect(result.success).toBe(false);
    });

    it('should reject port above 65535', () => {
        const result = MockcraftConfigSchema.safeParse({ port: 70000 });
        expect(result.success).toBe(false);
    });

    it('should apply defaults', () => {
        const result = MockcraftConfigSchema.safeParse({});
        expect(result.success).toBe(true);
        if (result.success) {
            expect(result.data.port).toBe(3000);
            expect(result.data.fixturesDir).toBe('./fixtures');
            expect(result.data.ai.provider).toBe('none');
        }
    });

    it('should reject invalid AI provider', () => {
        const result = MockcraftConfigSchema.safeParse({
            ai: { provider: 'invalid' },
        });
        expect(result.success).toBe(false);
    });
});

// ─── SSRF validation in config ───────────────────────────────

describe('loadConfig() SSRF protection', () => {
    it('should reject non-localhost Ollama URL', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'mockcraft.config.json'),
            JSON.stringify({
                ai: { provider: 'ollama', baseUrl: 'http://evil.com:11434' },
            }),
            'utf-8'
        );

        await expect(loadConfig(tempDir)).rejects.toThrow(/SSRF/);
    });

    it('should reject HTTP for remote providers', async () => {
        fs.writeFileSync(
            path.join(tempDir, 'mockcraft.config.json'),
            JSON.stringify({
                ai: { provider: 'grok', baseUrl: 'http://api.x.ai' },
            }),
            'utf-8'
        );

        await expect(loadConfig(tempDir)).rejects.toThrow(/SSRF/);
    });
});
