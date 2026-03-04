/**
 * @module fixtures
 * Fixture management for Mockcraft.
 * Handles reading, writing, and matching mock response fixtures.
 */

import fs from 'node:fs';
import path from 'node:path';
import {
    hashRequest,
    safePath,
    sanitizeFilename,
    safeLog,
    safeError,
    SecurityError,
} from './security.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface Fixture {
    /** HTTP method */
    method: string;
    /** URL pathname */
    path: string;
    /** Query string (optional) */
    query?: string;
    /** HTTP status code */
    status: number;
    /** Response headers */
    headers: Record<string, string>;
    /** Response body */
    body: unknown;
    /** Timestamp of creation */
    createdAt: string;
    /** Source: 'manual' | 'proxy' | 'ai' */
    source: 'manual' | 'proxy' | 'ai';
    /** Hash key for lookup */
    hash: string;
}

// ─────────────────────────────────────────────────────────────
// Fixture directory management
// ─────────────────────────────────────────────────────────────

/**
 * Ensure the fixtures directory exists.
 */
export function ensureFixturesDir(fixturesDir: string): void {
    const resolved = path.resolve(fixturesDir);
    if (!fs.existsSync(resolved)) {
        // SECURITY: Create with restricted permissions
        fs.mkdirSync(resolved, { recursive: true, mode: 0o755 });
        safeLog(`[mockcraft] Created fixtures directory: ${resolved}`);
    }
}

// ─────────────────────────────────────────────────────────────
// Fixture I/O
// ─────────────────────────────────────────────────────────────

/**
 * Generate a fixture filename from method + path + query.
 */
export function fixtureFilename(method: string, pathname: string, query?: string): string {
    const hash = hashRequest(method, pathname, query);
    // SECURITY: Sanitize all parts of the filename
    const safePart = sanitizeFilename(
        `${method.toLowerCase()}_${pathname.replace(/\//g, '_').replace(/^_/, '')}`,
    );
    return `${safePart}_${hash}.json`;
}

/**
 * Save a fixture to disk.
 */
export function saveFixture(fixturesDir: string, fixture: Fixture): string {
    ensureFixturesDir(fixturesDir);
    const filename = fixtureFilename(fixture.method, fixture.path, fixture.query);

    // SECURITY: Path traversal prevention — validate resolved path is inside fixtures dir
    const filePath = safePath(filename, path.resolve(fixturesDir));

    // SECURITY: Write with UTF-8 encoding, no special permissions
    const content = JSON.stringify(fixture, null, 2);
    fs.writeFileSync(filePath, content, 'utf-8');
    safeLog(`[mockcraft] Saved fixture: ${filename}`);

    return filename;
}

/**
 * Load a fixture by method + path + query.
 * Returns null if not found.
 */
export function loadFixture(
    fixturesDir: string,
    method: string,
    pathname: string,
    query?: string,
): Fixture | null {
    const filename = fixtureFilename(method, pathname, query);
    const resolved = path.resolve(fixturesDir);

    // SECURITY: Validate path is inside fixtures dir
    const filePath = safePath(filename, resolved);

    if (!fs.existsSync(filePath)) {
        return null;
    }

    try {
        const content = fs.readFileSync(filePath, 'utf-8');
        // SECURITY: Validate file size before parsing
        if (Buffer.byteLength(content, 'utf-8') > 1_048_576) {
            safeError('[mockcraft] Fixture file exceeds 1MB limit');
            return null;
        }
        return JSON.parse(content) as Fixture;
    } catch {
        // SECURITY: Never leak file paths in errors
        safeError('[mockcraft] Failed to read fixture');
        return null;
    }
}

/**
 * Delete a fixture by its filename.
 */
export function deleteFixture(fixturesDir: string, filename: string): boolean {
    try {
        // SECURITY: Path traversal prevention
        const filePath = safePath(filename, path.resolve(fixturesDir));
        if (fs.existsSync(filePath)) {
            fs.unlinkSync(filePath);
            safeLog(`[mockcraft] Deleted fixture: ${filename}`);
            return true;
        }
        return false;
    } catch (err) {
        if (err instanceof SecurityError) {
            safeError('[mockcraft] Security violation: attempted path traversal on delete');
        }
        return false;
    }
}

/**
 * List all fixtures in the directory.
 * Returns metadata only (not full file contents for performance).
 */
export function listFixtures(fixturesDir: string): {
    filename: string;
    method: string;
    path: string;
    source: string;
    createdAt: string;
}[] {
    const resolved = path.resolve(fixturesDir);

    if (!fs.existsSync(resolved)) {
        return [];
    }

    const files = fs.readdirSync(resolved).filter((f) => f.endsWith('.json'));
    const fixtures: {
        filename: string;
        method: string;
        path: string;
        source: string;
        createdAt: string;
    }[] = [];

    for (const file of files) {
        try {
            // SECURITY: Validate each file path
            const filePath = safePath(file, resolved);
            const content = fs.readFileSync(filePath, 'utf-8');

            // SECURITY: Skip oversized files
            if (Buffer.byteLength(content, 'utf-8') > 1_048_576) continue;

            const fixture = JSON.parse(content) as Fixture;
            fixtures.push({
                filename: file,
                method: fixture.method || 'UNKNOWN',
                path: fixture.path || '/',
                source: fixture.source || 'manual',
                createdAt: fixture.createdAt || '',
            });
        } catch {
            // Skip malformed fixtures silently
        }
    }

    return fixtures;
}
