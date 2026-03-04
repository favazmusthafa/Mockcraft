#!/usr/bin/env node

/**
 * @module cli
 * CLI entry point for Mockcraft.
 * Commands: init, serve (default), generate
 */

import { Command } from 'commander';
import { loadConfig, mergeCliOverrides } from './config.js';
import { createServer } from './server.js';
import { generateMockResponse } from './ai.js';
import { ensureFixturesDir } from './fixtures.js';
import { safeLog } from './security.js';
import fs from 'node:fs';
import path from 'node:path';

const program = new Command();

program
    .name('mockcraft')
    .description('⚡ The smartest local mock server — AI-powered fixtures, proxy recording, and a beautiful inspector.')
    .version('0.1.0');

// ─── Default: Start server ───────────────────────────────────

program
    .option('-p, --port <port>', 'Port to run the server on', '3000')
    .option('--proxy <url>', 'Proxy target URL')
    .action(async (options) => {
        try {
            const config = await loadConfig();
            const merged = mergeCliOverrides(config, {
                port: options.port ? parseInt(options.port, 10) : undefined,
                proxy: options.proxy,
            });

            await createServer(merged);

            // Open browser if not in CI
            if (!process.env['CI']) {
                const url = `http://localhost:${merged.port}/__mockcraft__`;
                safeLog(`[mockcraft] Opening inspector: ${url}`);
                try {
                    const { exec } = await import('node:child_process');
                    const openCmd = process.platform === 'win32'
                        ? `start ${url}`
                        : process.platform === 'darwin'
                            ? `open ${url}`
                            : `xdg-open ${url}`;
                    exec(openCmd);
                } catch {
                    // Browser open is best-effort
                }
            }
        } catch (err) {
            // SECURITY: Don't leak stack traces
            console.error('[mockcraft] Failed to start:', err instanceof Error ? err.message : 'Unknown error');
            process.exit(1);
        }
    });

// ─── Init command ────────────────────────────────────────────

program
    .command('init')
    .description('Initialize a new Mockcraft project with config and fixtures directory')
    .action(async () => {
        const configPath = path.resolve('mockcraft.config.ts');
        const jsonConfigPath = path.resolve('mockcraft.config.json');

        if (fs.existsSync(configPath) || fs.existsSync(jsonConfigPath)) {
            console.log('[mockcraft] Config file already exists. Skipping init.');
            return;
        }

        // Create config file
        const configContent = `// Mockcraft configuration
// Docs: https://github.com/your-username/mockcraft

export default {
  port: 3000,
  fixturesDir: './fixtures',
  // Uncomment to load an OpenAPI schema:
  // schemaPath: './openapi.json',

  // Proxy configuration (optional):
  // proxy: {
  //   target: 'https://api.example.com',
  //   record: true,
  //   forwardAuth: false,
  // },

  // AI provider configuration:
  ai: {
    provider: 'none' as const,  // 'ollama' | 'grok' | 'claude' | 'none'
    model: 'llama3.2',
    baseUrl: 'http://localhost:11434',
    temperature: 0.7,
    maxTokens: 800,
  },
};
`;

        // SECURITY: Write config with UTF-8
        fs.writeFileSync(configPath, configContent, 'utf-8');
        ensureFixturesDir('./fixtures');

        console.log('');
        console.log('  ⚡ Mockcraft initialized!');
        console.log('');
        console.log('  Created:');
        console.log('    → mockcraft.config.ts');
        console.log('    → fixtures/');
        console.log('');
        console.log('  Next steps:');
        console.log('    1. Edit mockcraft.config.ts to configure your mock server');
        console.log('    2. Run `npx mockcraft` to start');
        console.log('');
    });

// ─── Generate command ────────────────────────────────────────

program
    .command('generate')
    .description('Generate mock API fixtures using AI')
    .requiredOption('--prompt <prompt>', 'Describe the API to generate')
    .option('--provider <provider>', 'AI provider: ollama, grok, or claude', 'ollama')
    .action(async (options) => {
        try {
            const config = await loadConfig();

            // Override AI provider from CLI
            const provider = options.provider as 'ollama' | 'grok' | 'claude';
            config.ai.provider = provider;

            // SECURITY: Load API keys from env only
            if (provider === 'grok') {
                config.ai.apiKey = process.env['GROK_API_KEY'];
                config.ai.baseUrl = config.ai.baseUrl || 'https://api.x.ai';
            } else if (provider === 'claude') {
                config.ai.apiKey = process.env['ANTHROPIC_API_KEY'];
                config.ai.baseUrl = config.ai.baseUrl || 'https://api.anthropic.com';
            } else if (provider === 'ollama') {
                config.ai.baseUrl = config.ai.baseUrl || 'http://localhost:11434';
            }

            console.log('');
            console.log(`  ⚡ Generating API mocks with ${provider}...`);
            console.log(`  Prompt: "${options.prompt}"`);
            console.log('');

            // Generate a few common endpoints based on the prompt
            const endpoints = [
                { method: 'GET', path: '/api/items' },
                { method: 'GET', path: '/api/items/1' },
                { method: 'POST', path: '/api/items' },
                { method: 'PUT', path: '/api/items/1' },
                { method: 'DELETE', path: '/api/items/1' },
            ];

            for (const endpoint of endpoints) {
                try {
                    console.log(`  Generating ${endpoint.method} ${endpoint.path}...`);
                    await generateMockResponse(config, {
                        method: endpoint.method,
                        path: endpoint.path,
                        body: endpoint.method === 'POST' ? { prompt: options.prompt } : undefined,
                    });
                    console.log(`  ✓ ${endpoint.method} ${endpoint.path}`);
                } catch (err) {
                    console.error(`  ✗ ${endpoint.method} ${endpoint.path}: ${err instanceof Error ? err.message : 'Failed'}`);
                }
            }

            console.log('');
            console.log('  Done! Run `npx mockcraft` to start serving your generated mocks.');
            console.log('');
        } catch (err) {
            console.error('[mockcraft] Generate failed:', err instanceof Error ? err.message : 'Unknown error');
            process.exit(1);
        }
    });

program.parse();
