// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { LangsysApp, createLocaleStore } from './index.js';

/**
 * WIRE-5 — the API base is redirectable to a test double without patching the artifact.
 *
 * The base SDK takes `apiUrl` in `init()` and applies it before authorizing. This
 * binding overrides `init` (to adapt `UserLocaleStore` and `writeGrant`), and an override
 * is exactly where a config key can be lost on the way through — so this asserts the
 * behaviour through the binding's own `init`, observed at the network boundary rather
 * than read off the config object.
 *
 * Its own file: a second `init()` in one process is a no-op.
 */

const DOUBLE = 'http://double.langsys.test/api';
const requested: string[] = [];
const headersOf = new Map<string, Record<string, string>>();

beforeAll(() => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown, init?: { headers?: Record<string, string> }) => {
            const url = String(input instanceof Request ? input.url : input);
            requested.push(url);
            headersOf.set(url, { ...(init?.headers ?? {}) });
            return new Response(
                JSON.stringify({
                    status: true,
                    data: { key_type: 'read', write_enabled: false, auto_discovery: false },
                }),
                { status: 200, headers: { 'content-type': 'application/json' } }
            );
        })
    );
});
afterAll(() => vi.unstubAllGlobals());

describe('WIRE-5 — apiUrl passed through the binding reaches the double', () => {
    it("sends init's requests to the configured apiUrl, and none to the default host", async () => {
        await (LangsysApp as unknown as { init: (c: object) => Promise<unknown> })
            .init({ projectid: 'wire5', key: 'wire5', UserLocaleStore: createLocaleStore('en'), apiUrl: DOUBLE })
            .catch(() => undefined);

        // Control: without at least one request, "every request went to the double" is vacuous.
        expect(requested.length, 'init issued no request at all').toBeGreaterThan(0);
        expect(requested.filter((u) => !u.startsWith(DOUBLE))).toEqual([]);
        expect(requested.some((u) => u.includes('api.langsys.dev'))).toBe(false);
    });
});

/**
 * ICU-5: a binding sends what its core sends, so a catalog request made through this binding's
 * `init` carries the capability. Read at the network boundary, as above.
 */
describe('ICU-5 — the catalog request declares ICU rendering', () => {
    it('the catalog request carries X-Langsys-Capabilities: icu', async () => {
        const deadline = Date.now() + 5_000;
        while (!requested.some((u) => u.includes('/translations?')) && Date.now() < deadline)
            await new Promise((r) => setTimeout(r, 25));
        const catalog = requested.filter((u) => u.includes('/translations?'));
        // Control: the session fetched a catalog at all.
        expect(catalog.length, 'no catalog request was made').toBeGreaterThan(0);
        for (const url of catalog) expect(headersOf.get(url)?.['X-Langsys-Capabilities']).toBe('icu');
    });
});
