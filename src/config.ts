/**
 * @module config
 * Configuration loader for Mockcraft.
 * Supports mockcraft.config.ts (preferred) with .json fallback.
 */

import path from 'node:path';
import fs from 'node:fs';
import { z } from 'zod';
import { validateUrl, safeLog, safeError } from './security.js';

// ─────────────────────────────────────────────────────────────
// SECURITY: Config schema validated with Zod — no arbitrary data
// ─────────────────────────────────────────────────────────────

const AIProviderSchema = z.enum(['ollama', 'grok', 'claude', 'none']).default('none');

const AIConfigSchema = z
    .object({
        provider: AIProviderSchema,
        baseUrl: z.string().url().optional(),
        model: z.string().default('llama3.2'),
        apiKey: z.string().optional(),
        temperature: z.number().min(0).max(2).default(0.7),
        maxTokens: z.number().int().min(1).max(4096).default(800),
    })
    .default({});

const ProxyConfigSchema = z
    .object({
        target: z.string().url(),
        record: z.boolean().default(true),
        forwardAuth: z.boolean().default(false),
    })
    .optional();

export const MockcraftConfigSchema = z.object({
    port: z.number().int().min(1).max(65535).default(3000),
    schemaPath: z.string().optional(),
    fixturesDir: z.string().default('./fixtures'),
    proxy: ProxyConfigSchema,
    ai: AIConfigSchema,
});

export type MockcraftConfig = z.infer<typeof MockcraftConfigSchema>;

/** Default configuration when no config file exists */
export const DEFAULT_CONFIG: MockcraftConfig = {
    port: 3000,
    fixturesDir: './fixtures',
    ai: {
        provider: 'none',
        model: 'llama3.2',
        temperature: 0.7,
        maxTokens: 800,
    },
};

// ─────────────────────────────────────────────────────────────
// Config loader
// ─────────────────────────────────────────────────────────────

/**
 * Load configuration from mockcraft.config.ts, then .json, then defaults.
 * @param cwd Working directory to search for config files
 */
export async function loadConfig(cwd: string = process.cwd()): Promise<MockcraftConfig> {
    const tsConfigPath = path.resolve(cwd, 'mockcraft.config.ts');
    const jsonConfigPath = path.resolve(cwd, 'mockcraft.config.json');

    let rawConfig: unknown = undefined;

    // SECURITY: Only dynamic import() allowed — for the single config file
    // No eval, no new Function, no vm
    if (fs.existsSync(tsConfigPath)) {
        try {
            const configModule = await import(tsConfigPath);
            rawConfig = configModule.default ?? configModule;
            safeLog('[mockcraft] Loaded config from mockcraft.config.ts');
        } catch (err) {
            safeError('[mockcraft] Error loading mockcraft.config.ts — falling back to JSON');
        }
    }

    if (rawConfig === undefined && fs.existsSync(jsonConfigPath)) {
        try {
            const content = fs.readFileSync(jsonConfigPath, 'utf-8');
            // SECURITY: Validate body size before parsing
            if (Buffer.byteLength(content, 'utf-8') > 1_048_576) {
                throw new Error('Config file exceeds 1MB limit');
            }
            rawConfig = JSON.parse(content);
            safeLog('[mockcraft] Loaded config from mockcraft.config.json');
        } catch (err) {
            safeError('[mockcraft] Error loading mockcraft.config.json — using defaults');
        }
    }

    if (rawConfig === undefined) {
        safeLog('[mockcraft] No config file found — using defaults');
        return { ...DEFAULT_CONFIG };
    }

    // SECURITY: Validate shape strictly with Zod
    const result = MockcraftConfigSchema.safeParse(rawConfig);
    if (!result.success) {
        safeError(
            '[mockcraft] Invalid config:',
            JSON.stringify(result.error.flatten().fieldErrors),
        );
        throw new Error('Invalid mockcraft configuration. Check the errors above.');
    }

    const config = result.data;

    // SECURITY: Validate AI provider URLs for SSRF
    if (config.ai.provider !== 'none' && config.ai.baseUrl) {
        const providerType = config.ai.provider === 'ollama' ? 'ollama' : 'remote';
        const urlCheck = validateUrl(config.ai.baseUrl, providerType);
        if (!urlCheck.valid) {
            throw new Error(`SSRF protection: ${urlCheck.error}`);
        }
    }

    // SECURITY: Load API keys ONLY from env, never from config file
    if (config.ai.provider === 'grok') {
        config.ai.apiKey = process.env['GROK_API_KEY'];
        if (!config.ai.apiKey) {
            console.warn('[mockcraft] Warning: GROK_API_KEY not set in environment');
        }
        if (!config.ai.baseUrl) {
            config.ai.baseUrl = 'https://api.x.ai';
        }
    } else if (config.ai.provider === 'claude') {
        config.ai.apiKey = process.env['ANTHROPIC_API_KEY'];
        if (!config.ai.apiKey) {
            console.warn('[mockcraft] Warning: ANTHROPIC_API_KEY not set in environment');
        }
        if (!config.ai.baseUrl) {
            config.ai.baseUrl = 'https://api.anthropic.com';
        }
    } else if (config.ai.provider === 'ollama') {
        if (!config.ai.baseUrl) {
            config.ai.baseUrl = 'http://localhost:11434';
        }
    }

    return config;
}

/**
 * Merge CLI overrides into a config object.
 */
export function mergeCliOverrides(
    config: MockcraftConfig,
    overrides: { port?: number; proxy?: string },
): MockcraftConfig {
    const merged = { ...config };

    if (overrides.port) {
        merged.port = overrides.port;
    }

    if (overrides.proxy) {
        merged.proxy = {
            target: overrides.proxy,
            record: true,
            forwardAuth: false,
        };
    }

    return merged;
}
