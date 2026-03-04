/**
 * @module ai
 * AI provider integration for Mockcraft.
 * Supports Ollama (local), Grok (xAI), and Claude (Anthropic).
 * All calls are rate-limited, timeout-protected, and SSRF-validated.
 */

import { validateUrl, createRateLimiter, safeLog, safeError } from './security.js';
import { saveFixture, type Fixture } from './fixtures.js';
import type { MockcraftConfig } from './config.js';

// ─────────────────────────────────────────────────────────────
// SECURITY: Rate limiter for AI calls — 10 calls/min per endpoint
// ─────────────────────────────────────────────────────────────
const aiRateLimiter = createRateLimiter(10, 60_000);

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface AIRequestContext {
    method: string;
    path: string;
    query?: string;
    headers?: Record<string, string>;
    body?: unknown;
}

export interface AIResponse {
    status: number;
    headers: Record<string, string>;
    body: unknown;
    provider: string;
    model: string;
    cached: boolean;
}

// ─────────────────────────────────────────────────────────────
// System prompt for AI providers
// ─────────────────────────────────────────────────────────────

function buildSystemPrompt(ctx: AIRequestContext): string {
    return `You are a mock API server. Generate a realistic JSON response for the following HTTP request.

REQUEST:
- Method: ${ctx.method}
- Path: ${ctx.path}
${ctx.query ? `- Query: ${ctx.query}` : ''}
${ctx.body ? `- Body: ${JSON.stringify(ctx.body).substring(0, 500)}` : ''}

RULES:
1. Return ONLY valid JSON — no markdown, no explanation, no code fences.
2. Generate realistic, diverse data (names, emails, dates, IDs).
3. Use appropriate HTTP status codes (200 for GET, 201 for POST, etc.).
4. Include pagination metadata for list endpoints.
5. Match RESTful conventions.

Respond with a JSON object in this exact format:
{
  "status": 200,
  "headers": { "content-type": "application/json" },
  "body": { ... your realistic mock data ... }
}`;
}

// ─────────────────────────────────────────────────────────────
// Provider implementations
// ─────────────────────────────────────────────────────────────

/**
 * Call Ollama local LLM via /api/chat endpoint.
 */
async function callOllama(
    config: MockcraftConfig['ai'],
    systemPrompt: string,
): Promise<AIResponse> {
    const baseUrl = config.baseUrl || 'http://localhost:11434';

    // SECURITY: SSRF — validate Ollama URL is localhost only
    const urlCheck = validateUrl(baseUrl, 'ollama');
    if (!urlCheck.valid) {
        throw new Error(`SSRF protection: ${urlCheck.error}`);
    }

    const controller = new AbortController();
    // SECURITY: 10s timeout to prevent hanging connections
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${baseUrl}/api/chat`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
                model: config.model || 'llama3.2',
                messages: [{ role: 'user', content: systemPrompt }],
                stream: false,
                options: {
                    temperature: config.temperature ?? 0.7,
                    num_predict: config.maxTokens ?? 800,
                },
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Ollama error: ${response.status} ${response.statusText}`);
        }

        const data = (await response.json()) as { message?: { content?: string } };
        const content = data.message?.content || '{}';
        return parseAIResponse(content, 'ollama', config.model || 'llama3.2');
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Call Grok (xAI) via OpenAI-compatible API.
 */
async function callGrok(config: MockcraftConfig['ai'], systemPrompt: string): Promise<AIResponse> {
    const baseUrl = config.baseUrl || 'https://api.x.ai';

    // SECURITY: SSRF — validate remote URL uses HTTPS
    const urlCheck = validateUrl(baseUrl, 'grok');
    if (!urlCheck.valid) {
        throw new Error(`SSRF protection: ${urlCheck.error}`);
    }

    // SECURITY: API key loaded from env only, never logged
    const apiKey = config.apiKey;
    if (!apiKey) {
        throw new Error('GROK_API_KEY not set. Set it via environment variable.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${baseUrl}/v1/chat/completions`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                Authorization: `Bearer ${apiKey}`, // SECURITY: Key used transiently, not stored
            },
            body: JSON.stringify({
                model: config.model || 'grok-beta',
                messages: [
                    {
                        role: 'system',
                        content: 'You are a mock API server. Return only valid JSON.',
                    },
                    { role: 'user', content: systemPrompt },
                ],
                temperature: config.temperature ?? 0.7,
                max_tokens: config.maxTokens ?? 800,
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Grok API error: ${response.status}`);
        }

        const data = (await response.json()) as { choices?: { message?: { content?: string } }[] };
        const content = data.choices?.[0]?.message?.content || '{}';
        return parseAIResponse(content, 'grok', config.model || 'grok-beta');
    } finally {
        clearTimeout(timeout);
    }
}

/**
 * Call Claude (Anthropic) via Messages API.
 */
async function callClaude(
    config: MockcraftConfig['ai'],
    systemPrompt: string,
): Promise<AIResponse> {
    const baseUrl = config.baseUrl || 'https://api.anthropic.com';

    // SECURITY: SSRF — validate remote URL uses HTTPS
    const urlCheck = validateUrl(baseUrl, 'claude');
    if (!urlCheck.valid) {
        throw new Error(`SSRF protection: ${urlCheck.error}`);
    }

    // SECURITY: API key loaded from env only
    const apiKey = config.apiKey;
    if (!apiKey) {
        throw new Error('ANTHROPIC_API_KEY not set. Set it via environment variable.');
    }

    const controller = new AbortController();
    const timeout = setTimeout(() => controller.abort(), 10_000);

    try {
        const response = await fetch(`${baseUrl}/v1/messages`, {
            method: 'POST',
            headers: {
                'Content-Type': 'application/json',
                'x-api-key': apiKey, // SECURITY: Key used transiently
                'anthropic-version': '2023-06-01',
            },
            body: JSON.stringify({
                model: config.model || 'claude-3-5-sonnet-20241022',
                max_tokens: config.maxTokens ?? 800,
                system: 'You are a mock API server. Return only valid JSON.',
                messages: [{ role: 'user', content: systemPrompt }],
            }),
            signal: controller.signal,
        });

        if (!response.ok) {
            throw new Error(`Claude API error: ${response.status}`);
        }

        const data = (await response.json()) as { content?: { text?: string }[] };
        const content = data.content?.[0]?.text || '{}';
        return parseAIResponse(content, 'claude', config.model || 'claude-3-5-sonnet-20241022');
    } finally {
        clearTimeout(timeout);
    }
}

// ─────────────────────────────────────────────────────────────
// Response parsing
// ─────────────────────────────────────────────────────────────

/**
 * Parse AI text response into structured AIResponse.
 * Handles cases where AI returns markdown-wrapped JSON.
 */
function parseAIResponse(content: string, provider: string, model: string): AIResponse {
    // Strip markdown code fences if present
    let cleaned = content.trim();
    if (cleaned.startsWith('```')) {
        cleaned = cleaned.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
    }

    try {
        const parsed = JSON.parse(cleaned);

        // If the AI returned our expected format
        if (parsed.status && parsed.body !== undefined) {
            return {
                status: typeof parsed.status === 'number' ? parsed.status : 200,
                headers: parsed.headers || { 'content-type': 'application/json' },
                body: parsed.body,
                provider,
                model,
                cached: false,
            };
        }

        // Otherwise treat entire response as body
        return {
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: parsed,
            provider,
            model,
            cached: false,
        };
    } catch {
        // If JSON parsing fails, return as text
        return {
            status: 200,
            headers: { 'content-type': 'text/plain' },
            body: cleaned,
            provider,
            model,
            cached: false,
        };
    }
}

// ─────────────────────────────────────────────────────────────
// Main AI entry point
// ─────────────────────────────────────────────────────────────

/**
 * Generate a mock response using the configured AI provider.
 * Includes rate limiting, retries (1), and auto-save as fixture.
 */
export async function generateMockResponse(
    config: MockcraftConfig,
    ctx: AIRequestContext,
): Promise<AIResponse> {
    const aiConfig = config.ai;

    if (aiConfig.provider === 'none') {
        throw new Error(
            'AI provider is set to "none". Configure an AI provider in mockcraft.config.',
        );
    }

    // SECURITY: Rate limiting — 10 AI calls/min per endpoint
    const rateLimitKey = `${ctx.method}:${ctx.path}`;
    const rateCheck = aiRateLimiter.check(rateLimitKey);
    if (!rateCheck.allowed) {
        throw new Error(
            `Rate limit exceeded for ${ctx.method} ${ctx.path}. ` +
                `Try again in ${Math.ceil(rateCheck.resetIn / 1000)}s.`,
        );
    }

    const systemPrompt = buildSystemPrompt(ctx);

    // SECURITY: Log AI call without exposing secrets
    safeLog(
        `[mockcraft] AI call → ${aiConfig.provider}/${aiConfig.model} for ${ctx.method} ${ctx.path}`,
    );

    let lastError: Error | undefined;

    // Retry logic: 1 retry on failure
    for (let attempt = 0; attempt < 2; attempt++) {
        try {
            let response: AIResponse;

            switch (aiConfig.provider) {
                case 'ollama':
                    response = await callOllama(aiConfig, systemPrompt);
                    break;
                case 'grok':
                    response = await callGrok(aiConfig, systemPrompt);
                    break;
                case 'claude':
                    response = await callClaude(aiConfig, systemPrompt);
                    break;
                default:
                    throw new Error(`Unknown AI provider: ${aiConfig.provider}`);
            }

            // Auto-save AI response as fixture
            try {
                const fixture: Fixture = {
                    method: ctx.method,
                    path: ctx.path,
                    query: ctx.query,
                    status: response.status,
                    headers: response.headers,
                    body: response.body,
                    createdAt: new Date().toISOString(),
                    source: 'ai',
                    hash: '',
                };
                saveFixture(config.fixturesDir, fixture);
            } catch (saveErr) {
                // SECURITY: Don't leak save errors to callers
                safeError('[mockcraft] Failed to auto-save AI fixture');
            }

            return response;
        } catch (err) {
            lastError = err instanceof Error ? err : new Error(String(err));
            if (attempt === 0) {
                safeLog(`[mockcraft] AI call failed (attempt 1), retrying...`);
                await new Promise((r) => setTimeout(r, 1000)); // 1s backoff
            }
        }
    }

    throw lastError || new Error('AI generation failed after retries');
}

/**
 * Reset the AI rate limiter (for testing).
 */
export function resetAIRateLimiter(): void {
    aiRateLimiter.reset();
}
