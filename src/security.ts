/**
 * @module security
 * Shared security helpers for Mockcraft.
 * Every function here is used across the codebase to enforce hardening rules.
 */

import { createHash } from 'node:crypto';
import path from 'node:path';
import fs from 'node:fs';

// ─────────────────────────────────────────────────────────────
// SECURITY: Redaction — never leak API keys, tokens, or secrets
// ─────────────────────────────────────────────────────────────

const SENSITIVE_PATTERNS = /(?:api[_-]?key|token|secret|password|authorization|cookie)/i;

/**
 * Redact sensitive values from a string for safe logging.
 * Replaces anything that looks like an API key/token with [REDACTED].
 */
export function redact(input: string): string {
    // SECURITY: Redact bearer tokens, API keys, and long hex/base64 strings
    return input
        .replace(/Bearer\s+\S+/gi, 'Bearer [REDACTED]')
        .replace(/(?:sk-|xai-|key-|pat-)[a-zA-Z0-9_-]{10,}/g, '[REDACTED]')
        .replace(/([A-Za-z0-9+/=]{40,})/g, '[REDACTED]');
}

/**
 * Redact values from an object for logging. Returns a shallow copy.
 */
export function redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(obj)) {
        if (SENSITIVE_PATTERNS.test(key)) {
            result[key] = '[REDACTED]';
        } else if (typeof value === 'string') {
            result[key] = redact(value);
        } else {
            result[key] = value;
        }
    }
    return result;
}

/**
 * Safe console.log that redacts secrets.
 */
export function safeLog(message: string, ...args: unknown[]): void {
    // SECURITY: Never log raw secrets
    console.log(redact(message), ...args.map(a =>
        typeof a === 'string' ? redact(a) : a
    ));
}

/**
 * Safe console.error that redacts secrets.
 */
export function safeError(message: string, ...args: unknown[]): void {
    // SECURITY: Never log raw secrets in error output
    console.error(redact(message), ...args.map(a =>
        typeof a === 'string' ? redact(a) : a
    ));
}

// ─────────────────────────────────────────────────────────────
// SECURITY: URL validation — SSRF protection
// ─────────────────────────────────────────────────────────────

/**
 * Validates a URL for SSRF protection.
 * - Local providers (ollama): must be http://localhost:* or http://127.0.0.1:*
 * - Remote providers (grok, claude): must be https://
 */
export function validateUrl(url: string, provider: 'ollama' | 'grok' | 'claude' | 'local' | 'remote'): {
    valid: boolean;
    error?: string;
} {
    try {
        const parsed = new URL(url);

        if (provider === 'ollama' || provider === 'local') {
            // SECURITY: SSRF — local providers must bind to localhost only
            const isLocalhost = parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
            const isHttp = parsed.protocol === 'http:';
            if (!isLocalhost || !isHttp) {
                return {
                    valid: false,
                    error: `Local provider URL must be http://localhost:* or http://127.0.0.1:* — got ${parsed.origin}`,
                };
            }
        } else {
            // SECURITY: SSRF — remote providers must use HTTPS
            if (parsed.protocol !== 'https:') {
                return {
                    valid: false,
                    error: `Remote provider URL must use https:// — got ${parsed.protocol}`,
                };
            }
        }

        return { valid: true };
    } catch {
        return { valid: false, error: `Invalid URL: ${url}` };
    }
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Path traversal prevention
// ─────────────────────────────────────────────────────────────

/**
 * Check if `childPath` is inside `parentPath` (resolved, real paths).
 * Prevents path traversal attacks (../ etc.)
 */
export function isPathInside(childPath: string, parentPath: string): boolean {
    // SECURITY: Resolve to absolute, then verify containment
    const resolvedChild = path.resolve(childPath);
    const resolvedParent = path.resolve(parentPath);

    // Normalize separators for cross-platform
    const normalizedChild = resolvedChild.toLowerCase() + path.sep;
    const normalizedParent = resolvedParent.toLowerCase() + path.sep;

    return normalizedChild.startsWith(normalizedParent) || resolvedChild.toLowerCase() === resolvedParent.toLowerCase();
}

/**
 * Resolve and validate a path, ensuring it stays within the allowed root.
 * Throws on path traversal attempts.
 */
export function safePath(requestedPath: string, allowedRoot: string): string {
    // SECURITY: Reject absolute paths and obvious traversal
    if (path.isAbsolute(requestedPath)) {
        throw new SecurityError('Absolute paths are not allowed');
    }

    if (requestedPath.includes('..')) {
        throw new SecurityError('Path traversal detected: ".." is not allowed');
    }

    const resolved = path.resolve(allowedRoot, requestedPath);

    if (!isPathInside(resolved, allowedRoot)) {
        throw new SecurityError('Path traversal: resolved path is outside allowed root');
    }

    // SECURITY: Verify real path matches (symlink protection)
    try {
        const realRoot = fs.realpathSync(allowedRoot);
        if (fs.existsSync(resolved)) {
            const realResolved = fs.realpathSync(resolved);
            if (!isPathInside(realResolved, realRoot)) {
                throw new SecurityError('Path traversal via symlink detected');
            }
        }
    } catch (err) {
        if (err instanceof SecurityError) throw err;
        // Root may not exist yet — that's OK for new fixtures dirs
    }

    return resolved;
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Filename sanitization
// ─────────────────────────────────────────────────────────────

// SECURITY: Characters not allowed in fixture filenames
const UNSAFE_FILENAME_RE = /[<>:"/\\|?*\x00-\x1f]/g;
const RESERVED_NAMES = new Set([
    'con', 'prn', 'aux', 'nul',
    'com1', 'com2', 'com3', 'com4', 'com5', 'com6', 'com7', 'com8', 'com9',
    'lpt1', 'lpt2', 'lpt3', 'lpt4', 'lpt5', 'lpt6', 'lpt7', 'lpt8', 'lpt9',
]);

/**
 * Sanitize a filename to prevent injection attacks.
 * Strips unsafe characters, prevents reserved Windows names, limits length.
 */
export function sanitizeFilename(name: string): string {
    // SECURITY: Strip all unsafe characters, limit length
    let sanitized = name
        .replace(UNSAFE_FILENAME_RE, '_')
        .replace(/\.+/g, '.')        // collapse dots
        .replace(/^\.+|\.+$/g, '')   // strip leading/trailing dots
        .trim();

    // SECURITY: Block Windows reserved device names
    if (RESERVED_NAMES.has(sanitized.toLowerCase())) {
        sanitized = `_${sanitized}`;
    }

    // Limit length to 200 chars
    if (sanitized.length > 200) {
        sanitized = sanitized.substring(0, 200);
    }

    // Fallback if empty after sanitization
    if (!sanitized) {
        sanitized = 'unnamed';
    }

    return sanitized;
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Rate limiting — in-memory, per-endpoint
// ─────────────────────────────────────────────────────────────

interface RateLimitEntry {
    count: number;
    resetAt: number;
}

/**
 * Create a simple in-memory rate limiter.
 * @param maxCalls Maximum calls per window
 * @param windowMs Window duration in milliseconds
 */
export function createRateLimiter(maxCalls: number = 10, windowMs: number = 60_000) {
    // SECURITY: In-memory rate limiter to prevent AI API abuse
    const store = new Map<string, RateLimitEntry>();

    return {
        /**
         * Check if a request is allowed. Returns true if within limits.
         */
        check(key: string): { allowed: boolean; remaining: number; resetIn: number } {
            const now = Date.now();
            const entry = store.get(key);

            if (!entry || now > entry.resetAt) {
                store.set(key, { count: 1, resetAt: now + windowMs });
                return { allowed: true, remaining: maxCalls - 1, resetIn: windowMs };
            }

            if (entry.count >= maxCalls) {
                return { allowed: false, remaining: 0, resetIn: entry.resetAt - now };
            }

            entry.count++;
            return { allowed: true, remaining: maxCalls - entry.count, resetIn: entry.resetAt - now };
        },

        /** Reset all entries (useful for testing) */
        reset(): void {
            store.clear();
        },
    };
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Request hashing — for fixture keys
// ─────────────────────────────────────────────────────────────

/**
 * Generate a deterministic hash key for a request (method + path + sorted query).
 */
export function hashRequest(method: string, pathname: string, query?: string): string {
    const normalizedQuery = query
        ? query.split('&').sort().join('&')
        : '';
    const raw = `${method.toUpperCase()}:${pathname}:${normalizedQuery}`;
    return createHash('sha256').update(raw).digest('hex').substring(0, 16);
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Input validation helpers
// ─────────────────────────────────────────────────────────────

/** Maximum allowed JSON body size (1MB) */
export const MAX_BODY_SIZE = 1_048_576;

/**
 * Validate that a JSON body is within size limits.
 */
export function validateBodySize(body: string | Buffer): boolean {
    const size = typeof body === 'string' ? Buffer.byteLength(body, 'utf-8') : body.length;
    return size <= MAX_BODY_SIZE;
}

// ─────────────────────────────────────────────────────────────
// SECURITY: CORS origin validation
// ─────────────────────────────────────────────────────────────

/**
 * Check if an origin is allowed (localhost/127.0.0.1 only, no wildcards).
 */
export function isAllowedOrigin(origin: string | undefined): boolean {
    if (!origin) return false;
    try {
        const parsed = new URL(origin);
        // SECURITY: CORS locked to localhost only — no wildcard
        return parsed.hostname === 'localhost' || parsed.hostname === '127.0.0.1';
    } catch {
        return false;
    }
}

// ─────────────────────────────────────────────────────────────
// SECURITY: Sensitive header stripping for proxy
// ─────────────────────────────────────────────────────────────

export const SENSITIVE_HEADERS = [
    'authorization',
    'cookie',
    'set-cookie',
    'x-forwarded-for',
    'x-real-ip',
    'proxy-authorization',
    'x-api-key',
    'x-auth-token',
] as const;

/**
 * Strip sensitive headers from a Headers object in-place.
 * Returns list of stripped header names for logging.
 */
export function stripSensitiveHeaders(headers: Headers): string[] {
    // SECURITY: Strip auth/cookie headers unless forwardAuth is enabled
    const stripped: string[] = [];
    for (const name of SENSITIVE_HEADERS) {
        if (headers.has(name)) {
            headers.delete(name);
            stripped.push(name);
        }
    }
    return stripped;
}

// ─────────────────────────────────────────────────────────────
// Custom error class
// ─────────────────────────────────────────────────────────────

export class SecurityError extends Error {
    constructor(message: string) {
        super(message);
        this.name = 'SecurityError';
    }
}
