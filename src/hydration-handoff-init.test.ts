// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, createLocaleStore, useT } from './index.js';

/**
 * SRV-4 — `init({ initialTranslations })` is not a synchronous seed.
 *
 * `init()` awaits its authorization round trip (`LangsysAppAPI.validate`) BEFORE it
 * applies `initialTranslations`, so however fast that round trip is, the first client
 * render has already happened. The two tests below are a pair, and each only means
 * something beside the other:
 *
 *   1. called just before mount, init has not seeded yet → hydration mismatches;
 *   2. control: once its round trip resolves, init HAS seeded.
 *
 * Without (2), (1) cannot tell "seeds too late" from "never seeds" — and an earlier
 * revision of this file was exactly that: its control read the catalog 100 ms in while
 * a real network call was still pending, and failed. `fetch` is stubbed so the round trip
 * resolves deterministically. If init ever seeded synchronously, (1) would go red; if it
 * stopped seeding, (2) would.
 *
 * Its own file on purpose: a second `init()` in one process is a no-op, so an init case
 * sharing a file with another could pass without init ever running.
 */

const IT = { __uncategorized__: {}, UI: { Pricing: 'Prezzi' } };
const EMPTY = { __uncategorized__: {} };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const core = LangsysApp as unknown as {
    seedCatalog: (catalog: object, locale: string) => void;
    init: (config: object) => Promise<unknown>;
    t: (phrase: string, category?: string) => string;
};

const Heading = defineComponent({
    setup() {
        const t = useT();
        return () => h('h1', t.value('Pricing', 'UI'));
    },
});

beforeAll(() => {
    vi.stubGlobal(
        'fetch',
        vi.fn(
            async () =>
                new Response(
                    JSON.stringify({
                        status: true,
                        data: { key_type: 'read', write_enabled: false, auto_discovery: false },
                    }),
                    { status: 200, headers: { 'content-type': 'application/json' } }
                )
        )
    );
});
afterAll(() => vi.unstubAllGlobals());

let pendingInit: Promise<unknown> | undefined;

describe('SRV-4 — init() as a hand-off', () => {
    it('has not seeded by the first client render, so hydration mismatches', async () => {
        core.seedCatalog(IT, 'it');
        const html = await renderToString(createSSRApp(Heading));
        expect(html).toContain('Prezzi');
        core.seedCatalog(EMPTY, 'en'); // a fresh page

        const logs: string[] = [];
        const originalError = console.error;
        const originalWarn = console.warn;
        console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
        console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
        try {
            pendingInit = core
                .init({
                    projectid: 'handoff-init-test',
                    key: 'handoff-init-test',
                    UserLocaleStore: createLocaleStore('it'),
                    initialTranslations: IT,
                    initialTranslationsLocale: 'it',
                })
                .catch(() => undefined);
            const app = createSSRApp(Heading);
            app.config.warnHandler = (m) => void logs.push(String(m));
            const el = document.createElement('div');
            el.innerHTML = html;
            document.body.appendChild(el);
            app.mount(el); // synchronously after init() was called — before its round trip
            await tick();
        } finally {
            console.error = originalError;
            console.warn = originalWarn;
        }
        expect(logs.filter((l) => /hydrat|mismatch/i.test(l)).length).toBeGreaterThan(0);
    });

    it('control: once its round trip resolves, init HAS seeded the catalog', async () => {
        expect(pendingInit, 'the first test must have started init').toBeDefined();
        await pendingInit;
        expect(core.t('Pricing', 'UI')).toBe('Prezzi');
    });
});
