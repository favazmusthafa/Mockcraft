/**
 * @module tests/security
 * Tests for security helpers: redaction, SSRF, path traversal, rate limiting, sanitization.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import {
    redact,
    redactObject,
    validateUrl,
    isPathInside,
    sanitizeFilename,
    createRateLimiter,
    isAllowedOrigin,
    hashRequest,
    validateBodySize,
    stripSensitiveHeaders,
    SecurityError,
    safePath,
} from '../src/security.js';
import path from 'node:path';
import os from 'node:os';
import fs from 'node:fs';

// ─── Redaction ───────────────────────────────────────────────

describe('redact()', () => {
    it('should redact Bearer tokens', () => {
        expect(redact('Authorization: Bearer sk-1234567890abcdef')).toContain('[REDACTED]');
        expect(redact('Authorization: Bearer sk-1234567890abcdef')).not.toContain('sk-1234567890abcdef');
    });

    it('should redact API keys with known prefixes', () => {
        expect(redact('key is sk-abc1234567890')).toContain('[REDACTED]');
        expect(redact('key is xai-abc1234567890')).toContain('[REDACTED]');
    });

    it('should not redact normal text', () => {
        expect(redact('hello world')).toBe('hello world');
    });
});

describe('redactObject()', () => {
    it('should redact sensitive keys', () => {
        const result = redactObject({
            apiKey: 'secret-123',
            name: 'test',
            authorization: 'Bearer token',
        });
        expect(result.apiKey).toBe('[REDACTED]');
        expect(result.authorization).toBe('[REDACTED]');
        expect(result.name).toBe('test');
    });
});

// ─── SSRF Validation ─────────────────────────────────────────

describe('validateUrl()', () => {
    it('should accept localhost HTTP for ollama', () => {
        expect(validateUrl('http://localhost:11434', 'ollama').valid).toBe(true);
        expect(validateUrl('http://127.0.0.1:11434', 'ollama').valid).toBe(true);
    });

    it('should reject non-localhost for ollama', () => {
        expect(validateUrl('http://evil.com:11434', 'ollama').valid).toBe(false);
        expect(validateUrl('https://localhost:11434', 'ollama').valid).toBe(false);
    });

    it('should accept HTTPS for remote providers', () => {
        expect(validateUrl('https://api.x.ai', 'grok').valid).toBe(true);
        expect(validateUrl('https://api.anthropic.com', 'claude').valid).toBe(true);
    });

    it('should reject HTTP for remote providers', () => {
        expect(validateUrl('http://api.x.ai', 'grok').valid).toBe(false);
        expect(validateUrl('http://api.anthropic.com', 'claude').valid).toBe(false);
    });

    it('should reject invalid URLs', () => {
        expect(validateUrl('not-a-url', 'ollama').valid).toBe(false);
    });
});

// ─── Path Traversal Prevention ───────────────────────────────

describe('isPathInside()', () => {
    it('should return true for child paths', () => {
        expect(isPathInside('/a/b/c', '/a/b')).toBe(true);
        expect(isPathInside('/a/b', '/a/b')).toBe(true);
    });

    it('should return false for parent/sibling paths', () => {
        expect(isPathInside('/a/b', '/a/b/c')).toBe(false);
        expect(isPathInside('/x/y', '/a/b')).toBe(false);
    });
});

describe('safePath()', () => {
    let tempDir: string;

    beforeEach(() => {
        tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-test-'));
    });

    it('should resolve valid relative paths', () => {
        const result = safePath('test.json', tempDir);
        expect(result).toBe(path.resolve(tempDir, 'test.json'));
    });

    it('should reject path traversal with ../', () => {
        expect(() => safePath('../etc/passwd', tempDir)).toThrow(SecurityError);
    });

    it('should reject absolute paths', () => {
        expect(() => safePath('/etc/passwd', tempDir)).toThrow(SecurityError);
    });
});

// ─── Filename Sanitization ───────────────────────────────────

describe('sanitizeFilename()', () => {
    it('should strip unsafe characters', () => {
        expect(sanitizeFilename('test<>:"/\\|?*.json')).not.toContain('<');
        expect(sanitizeFilename('test<>:"/\\|?*.json')).not.toContain('>');
    });

    it('should handle Windows reserved names', () => {
        expect(sanitizeFilename('CON')).toBe('_CON');
        expect(sanitizeFilename('nul')).toBe('_nul');
    });

    it('should limit filename length', () => {
        const long = 'a'.repeat(300);
        expect(sanitizeFilename(long).length).toBeLessThanOrEqual(200);
    });

    it('should return "unnamed" for empty input', () => {
        expect(sanitizeFilename('')).toBe('unnamed');
        expect(sanitizeFilename('...')).toBe('unnamed');
    });
});

// ─── Rate Limiting ───────────────────────────────────────────

describe('createRateLimiter()', () => {
    it('should allow requests within limit', () => {
        const limiter = createRateLimiter(3, 60_000);
        expect(limiter.check('test').allowed).toBe(true);
        expect(limiter.check('test').allowed).toBe(true);
        expect(limiter.check('test').allowed).toBe(true);
    });

    it('should block requests over limit', () => {
        const limiter = createRateLimiter(2, 60_000);
        limiter.check('test');
        limiter.check('test');
        expect(limiter.check('test').allowed).toBe(false);
    });

    it('should track keys independently', () => {
        const limiter = createRateLimiter(1, 60_000);
        expect(limiter.check('a').allowed).toBe(true);
        expect(limiter.check('b').allowed).toBe(true);
        expect(limiter.check('a').allowed).toBe(false);
    });

    it('should reset correctly', () => {
        const limiter = createRateLimiter(1, 60_000);
        limiter.check('test');
        limiter.reset();
        expect(limiter.check('test').allowed).toBe(true);
    });
});

// ─── CORS ────────────────────────────────────────────────────

describe('isAllowedOrigin()', () => {
    it('should allow localhost origins', () => {
        expect(isAllowedOrigin('http://localhost:3000')).toBe(true);
        expect(isAllowedOrigin('http://127.0.0.1:3000')).toBe(true);
        expect(isAllowedOrigin('http://localhost:8080')).toBe(true);
    });

    it('should reject non-localhost origins', () => {
        expect(isAllowedOrigin('http://evil.com')).toBe(false);
        expect(isAllowedOrigin('https://example.com')).toBe(false);
        expect(isAllowedOrigin(undefined)).toBe(false);
    });
});

// ─── Request Hashing ─────────────────────────────────────────

describe('hashRequest()', () => {
    it('should produce consistent hashes', () => {
        const h1 = hashRequest('GET', '/api/users', 'page=1');
        const h2 = hashRequest('GET', '/api/users', 'page=1');
        expect(h1).toBe(h2);
    });

    it('should differ by method', () => {
        const h1 = hashRequest('GET', '/api/users');
        const h2 = hashRequest('POST', '/api/users');
        expect(h1).not.toBe(h2);
    });

    it('should normalize query parameter order', () => {
        const h1 = hashRequest('GET', '/api/users', 'a=1&b=2');
        const h2 = hashRequest('GET', '/api/users', 'b=2&a=1');
        expect(h1).toBe(h2);
    });
});

// ─── Body Size Validation ────────────────────────────────────

describe('validateBodySize()', () => {
    it('should accept bodies under 1MB', () => {
        expect(validateBodySize('hello')).toBe(true);
    });

    it('should reject bodies over 1MB', () => {
        const big = 'x'.repeat(1_048_577);
        expect(validateBodySize(big)).toBe(false);
    });
});

// ─── Header Stripping ───────────────────────────────────────

describe('stripSensitiveHeaders()', () => {
    it('should strip auth and cookie headers', () => {
        const headers = new Headers({
            'authorization': 'Bearer token',
            'cookie': 'session=abc',
            'content-type': 'application/json',
        });

        const stripped = stripSensitiveHeaders(headers);
        expect(stripped).toContain('authorization');
        expect(stripped).toContain('cookie');
        expect(headers.has('authorization')).toBe(false);
        expect(headers.has('cookie')).toBe(false);
        expect(headers.has('content-type')).toBe(true);
    });
});
