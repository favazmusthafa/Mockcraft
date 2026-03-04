/**
 * @module tests/fixtures
 * Tests for fixture management: save, load, list, delete, hash-based naming.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
    saveFixture,
    loadFixture,
    listFixtures,
    deleteFixture,
    fixtureFilename,
    ensureFixturesDir,
    type Fixture,
} from '../src/fixtures.js';
import fs from 'node:fs';
import path from 'node:path';
import os from 'node:os';

let tempDir: string;

beforeEach(() => {
    tempDir = fs.mkdtempSync(path.join(os.tmpdir(), 'mockcraft-fixtures-'));
});

afterEach(() => {
    fs.rmSync(tempDir, { recursive: true, force: true });
});

// ─── Fixture Filename Generation ─────────────────────────────

describe('fixtureFilename()', () => {
    it('should generate a filename with method, path, and hash', () => {
        const name = fixtureFilename('GET', '/api/users');
        expect(name).toMatch(/^get_api_users_[a-f0-9]{16}\.json$/);
    });

    it('should generate different names for different methods', () => {
        const get = fixtureFilename('GET', '/api/users');
        const post = fixtureFilename('POST', '/api/users');
        expect(get).not.toBe(post);
    });

    it('should include query in hash', () => {
        const without = fixtureFilename('GET', '/api/users');
        const with_ = fixtureFilename('GET', '/api/users', 'page=1');
        expect(without).not.toBe(with_);
    });
});

// ─── Save & Load ─────────────────────────────────────────────

describe('saveFixture() & loadFixture()', () => {
    it('should save and load a fixture', () => {
        const fixture: Fixture = {
            method: 'GET',
            path: '/api/users',
            status: 200,
            headers: { 'content-type': 'application/json' },
            body: { users: [{ id: 1, name: 'Alice' }] },
            createdAt: new Date().toISOString(),
            source: 'manual',
            hash: '',
        };

        saveFixture(tempDir, fixture);
        const loaded = loadFixture(tempDir, 'GET', '/api/users');
        expect(loaded).not.toBeNull();
        expect(loaded?.status).toBe(200);
        expect(loaded?.body).toEqual({ users: [{ id: 1, name: 'Alice' }] });
    });

    it('should return null for missing fixtures', () => {
        const loaded = loadFixture(tempDir, 'GET', '/nonexistent');
        expect(loaded).toBeNull();
    });
});

// ─── List ────────────────────────────────────────────────────

describe('listFixtures()', () => {
    it('should list all fixtures', () => {
        saveFixture(tempDir, {
            method: 'GET', path: '/api/a', status: 200,
            headers: {}, body: {}, createdAt: '', source: 'manual', hash: '',
        });
        saveFixture(tempDir, {
            method: 'POST', path: '/api/b', status: 201,
            headers: {}, body: {}, createdAt: '', source: 'ai', hash: '',
        });

        const list = listFixtures(tempDir);
        expect(list.length).toBe(2);
    });

    it('should return empty array for non-existent directory', () => {
        const list = listFixtures('/nonexistent');
        expect(list).toEqual([]);
    });
});

// ─── Delete ──────────────────────────────────────────────────

describe('deleteFixture()', () => {
    it('should delete an existing fixture', () => {
        const fixture: Fixture = {
            method: 'DELETE', path: '/api/item/1', status: 200,
            headers: {}, body: {}, createdAt: '', source: 'manual', hash: '',
        };

        const filename = saveFixture(tempDir, fixture);
        expect(deleteFixture(tempDir, filename)).toBe(true);
        expect(loadFixture(tempDir, 'DELETE', '/api/item/1')).toBeNull();
    });

    it('should return false for non-existent fixture', () => {
        expect(deleteFixture(tempDir, 'nonexistent.json')).toBe(false);
    });

    it('should block path traversal on delete', () => {
        expect(deleteFixture(tempDir, '../../../etc/passwd')).toBe(false);
    });
});

// ─── Ensure Dir ──────────────────────────────────────────────

describe('ensureFixturesDir()', () => {
    it('should create directory if it does not exist', () => {
        const newDir = path.join(tempDir, 'new-fixtures');
        expect(fs.existsSync(newDir)).toBe(false);
        ensureFixturesDir(newDir);
        expect(fs.existsSync(newDir)).toBe(true);
    });

    it('should not throw if directory exists', () => {
        expect(() => ensureFixturesDir(tempDir)).not.toThrow();
    });
});
