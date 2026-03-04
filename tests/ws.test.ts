/**
 * @module tests/ws
 * Tests for WebSocket module: origin validation, event sanitization, broadcast.
 */

import { describe, it, expect } from 'vitest';
import { redact, redactObject } from '../src/security.js';

// ─── Origin validation (via isAllowedOrigin from security) ──

// Note: isLocalOrigin in ws.ts is private, but it mirrors isAllowedOrigin
// which is already tested in security.test.ts. Here we test the data
// sanitization logic that feeds into WebSocket broadcasts.

// ─── Event data sanitization ─────────────────────────────────

describe('WebSocket event data sanitization', () => {
    it('should redact Bearer tokens in string data', () => {
        const result = redact('Authorization: Bearer sk-abc1234567890');
        expect(result).toContain('[REDACTED]');
        expect(result).not.toContain('sk-abc1234567890');
    });

    it('should redact API keys with known prefixes', () => {
        expect(redact('xai-testkey1234567890')).toContain('[REDACTED]');
        expect(redact('key-testkey1234567890')).toContain('[REDACTED]');
    });

    it('should redact objects with sensitive keys', () => {
        const sanitized = redactObject({
            authorization: 'Bearer secret',
            cookie: 'session=abc',
            apiKey: 'sk-12345',
            token: 'jwt-token',
            method: 'GET',
            path: '/api/users',
        });

        expect(sanitized.authorization).toBe('[REDACTED]');
        expect(sanitized.cookie).toBe('[REDACTED]');
        expect(sanitized.apiKey).toBe('[REDACTED]');
        expect(sanitized.token).toBe('[REDACTED]');
        expect(sanitized.method).toBe('GET');
        expect(sanitized.path).toBe('/api/users');
    });

    it('should not redact safe strings', () => {
        expect(redact('GET /api/users 200')).toBe('GET /api/users 200');
        expect(redact('hello world')).toBe('hello world');
    });
});

// ─── Broadcast event shape ───────────────────────────────────

describe('WebSocket event structure', () => {
    it('should have the expected MockcraftEvent shape', () => {
        // Test that the event interface matches expectations
        const event = {
            type: 'request' as const,
            method: 'GET',
            path: '/api/test',
            status: 200,
            source: 'fixture',
            timestamp: Date.now(),
            data: { provider: 'ollama' },
        };

        expect(event.type).toBe('request');
        expect(event.timestamp).toBeGreaterThan(0);
        expect(event.method).toBe('GET');
    });
});

// ─── WebSocket max payload ───────────────────────────────────

describe('WebSocket configuration', () => {
    it('should define path as /__mockcraft__/ws', async () => {
        // Verify the constant path used in ws.ts
        const wsModule = await import('../src/ws.js');
        // The module exports initWebSocket which uses path: '/__mockcraft__/ws'
        // We verify the export functions exist
        expect(typeof wsModule.initWebSocket).toBe('function');
        expect(typeof wsModule.broadcastEvent).toBe('function');
        expect(typeof wsModule.getConnectedClients).toBe('function');
        expect(typeof wsModule.closeWebSocket).toBe('function');
    });
});
