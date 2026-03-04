/**
 * @module schema
 * OpenAPI 3.x schema parser for Mockcraft.
 * Extracts routes and example responses from an OpenAPI spec.
 */

import fs from 'node:fs';
import path from 'node:path';
import { safeLog } from './security.js';

// ─────────────────────────────────────────────────────────────
// Types
// ─────────────────────────────────────────────────────────────

export interface SchemaRoute {
    method: string;
    path: string;
    operationId?: string;
    summary?: string;
    exampleResponse?: unknown;
    statusCode: number;
    contentType: string;
}

interface OpenAPISpec {
    openapi?: string;
    paths?: Record<string, Record<string, OpenAPIOperation>>;
}

interface OpenAPIOperation {
    operationId?: string;
    summary?: string;
    responses?: Record<string, OpenAPIResponse>;
}

interface OpenAPIResponse {
    description?: string;
    content?: Record<string, { schema?: unknown; example?: unknown; examples?: Record<string, { value?: unknown }> }>;
}

// ─────────────────────────────────────────────────────────────
// Schema loader
// ─────────────────────────────────────────────────────────────

const HTTP_METHODS = new Set(['get', 'post', 'put', 'patch', 'delete', 'head', 'options']);

/**
 * Load and parse an OpenAPI 3.x spec from a JSON file.
 * Returns extracted routes with example responses.
 */
export function loadSchema(schemaPath: string, cwd: string = process.cwd()): SchemaRoute[] {
    const resolved = path.resolve(cwd, schemaPath);

    // SECURITY: Validate file exists and is readable (no path traversal here — user-supplied config path)
    if (!fs.existsSync(resolved)) {
        safeLog(`[mockcraft] Schema file not found: ${schemaPath}`);
        return [];
    }

    try {
        const content = fs.readFileSync(resolved, 'utf-8');

        // SECURITY: Validate file size before parsing
        if (Buffer.byteLength(content, 'utf-8') > 10_485_760) { // 10MB limit for schemas
            console.error('[mockcraft] Schema file exceeds 10MB limit');
            return [];
        }

        const spec: OpenAPISpec = JSON.parse(content);
        return extractRoutes(spec);
    } catch (err) {
        // SECURITY: Never leak file paths in error messages to consumers
        console.error('[mockcraft] Failed to parse OpenAPI schema');
        return [];
    }
}

/**
 * Extract routes from a parsed OpenAPI spec.
 */
function extractRoutes(spec: OpenAPISpec): SchemaRoute[] {
    const routes: SchemaRoute[] = [];

    if (!spec.paths || typeof spec.paths !== 'object') {
        return routes;
    }

    for (const [routePath, methods] of Object.entries(spec.paths)) {
        if (typeof methods !== 'object' || methods === null) continue;

        for (const [method, operation] of Object.entries(methods)) {
            if (!HTTP_METHODS.has(method.toLowerCase())) continue;
            if (typeof operation !== 'object' || operation === null) continue;

            const op = operation as OpenAPIOperation;
            const route = extractRouteFromOperation(routePath, method.toUpperCase(), op);
            if (route) {
                routes.push(route);
            }
        }
    }

    safeLog(`[mockcraft] Loaded ${routes.length} routes from OpenAPI schema`);
    return routes;
}

/**
 * Extract a single route from an OpenAPI operation.
 */
function extractRouteFromOperation(
    routePath: string,
    method: string,
    operation: OpenAPIOperation
): SchemaRoute | null {
    // Find the first successful response (2xx)
    const responses = operation.responses ?? {};
    let statusCode = 200;
    let exampleResponse: unknown = undefined;
    let contentType = 'application/json';

    for (const [code, response] of Object.entries(responses)) {
        const numCode = parseInt(code, 10);
        if (numCode >= 200 && numCode < 300) {
            statusCode = numCode;

            if (response.content) {
                for (const [ct, mediaType] of Object.entries(response.content)) {
                    contentType = ct;
                    if (mediaType.example) {
                        exampleResponse = mediaType.example;
                        break;
                    }
                    if (mediaType.examples) {
                        const firstExample = Object.values(mediaType.examples)[0];
                        if (firstExample?.value) {
                            exampleResponse = firstExample.value;
                            break;
                        }
                    }
                }
            }
            break;
        }
    }

    return {
        method,
        path: routePath,
        operationId: operation.operationId,
        summary: operation.summary,
        exampleResponse,
        statusCode,
        contentType,
    };
}

/**
 * Match an incoming request against loaded schema routes.
 * Supports OpenAPI path parameters like /users/{id}.
 */
export function matchSchemaRoute(
    routes: SchemaRoute[],
    method: string,
    pathname: string
): SchemaRoute | undefined {
    // Exact match first
    const exact = routes.find(
        r => r.method === method.toUpperCase() && r.path === pathname
    );
    if (exact) return exact;

    // Path parameter matching: /users/{id} → /users/123
    for (const route of routes) {
        if (route.method !== method.toUpperCase()) continue;

        const routeParts = route.path.split('/');
        const pathParts = pathname.split('/');

        if (routeParts.length !== pathParts.length) continue;

        let match = true;
        for (let i = 0; i < routeParts.length; i++) {
            if (routeParts[i].startsWith('{') && routeParts[i].endsWith('}')) {
                continue; // Path parameter — matches anything
            }
            if (routeParts[i] !== pathParts[i]) {
                match = false;
                break;
            }
        }

        if (match) return route;
    }

    return undefined;
}
