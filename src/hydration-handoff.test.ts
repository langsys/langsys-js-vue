// @vitest-environment jsdom
import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, onMounted } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, createLocaleStore, useT } from './index.js';

/**
 * SRV-4, the binding's half — hand the client the catalog the server rendered with.
 *
 * The spec splits this rule. The core's half is exposing a synchronous seed; the
 * binding's half is that calling it before hydration makes the first client render
 * byte-identical to the served HTML, and that the hydration-mismatch control is
 * observable at all — which only a binding can show, since a core has no renderer.
 *
 * Every case runs the real thing: `vue/server-renderer` produces the served bytes, and
 * `createSSRApp().mount()` hydrates them in a DOM, with Vue's own mismatch warnings
 * captured. The positive control is load-bearing: without it, a test asserting "no
 * mismatch" passes against a framework that never warns about anything.
 *
 * `init({ initialTranslations })` is covered in `hydration-handoff-init.test.ts`, in its
 * own file on purpose — a second `init()` in the same process is a no-op, so an init
 * case sharing this file could pass vacuously.
 */

const IT = { __uncategorized__: {}, UI: { Pricing: 'Prezzi' } };
const EMPTY = { __uncategorized__: {} };
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const core = LangsysApp as unknown as {
    seedCatalog: (catalog: object, locale: string) => void;
    init: (config: object) => Promise<unknown>;
};

const Heading = defineComponent({
    setup() {
        const t = useT();
        return () => h('h1', t.value('Pricing', 'UI'));
    },
});

async function serve(seeded: boolean, component = Heading): Promise<string> {
    core.seedCatalog(seeded ? IT : EMPTY, seeded ? 'it' : 'en');
    return renderToString(createSSRApp(component));
}

async function hydrate(html: string, beforeMount: () => void, component = Heading) {
    core.seedCatalog(EMPTY, 'en'); // a fresh page: nothing seeded yet
    const logs: string[] = [];
    const originalError = console.error;
    const originalWarn = console.warn;
    console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
    try {
        beforeMount();
        const app = createSSRApp(component);
        app.config.warnHandler = (m) => void logs.push(String(m));
        const el = document.createElement('div');
        el.innerHTML = html;
        document.body.appendChild(el);
        app.mount(el);
        await tick();
        return { text: el.textContent, mismatch: logs.filter((l) => /hydrat|mismatch/i.test(l)) };
    } finally {
        console.error = originalError;
        console.warn = originalWarn;
    }
}

describe('SRV-4 — the hydration hand-off', () => {
    it('seeded synchronously before mount, the first client render IS the served HTML', async () => {
        const html = await serve(true);
        expect(html).toContain('Prezzi');

        const client = await hydrate(html, () => core.seedCatalog(IT, 'it'));
        expect(client.mismatch).toEqual([]);
        expect(client.text).toBe('Prezzi');
    });

    it('control: the same served HTML hydrated by an unseeded client mismatches', async () => {
        const html = await serve(true);
        const client = await hydrate(html, () => undefined);
        expect(client.mismatch.length).toBeGreaterThan(0);
        expect(client.text).toBe('Pricing');
    });

    it("the seed is the core's own synchronous method, reached through the binding", () => {
        expect(typeof core.seedCatalog).toBe('function');
        expect((core.seedCatalog as unknown as { name: string }).name).toBe('bound seedCatalog');
        expect(core.seedCatalog(EMPTY, 'en')).toBeUndefined(); // not a promise — nothing to await
    });

    it('the hand-off README-SSR used to teach (init in onMounted) served base language', async () => {
        // It avoided a mismatch by never translating the served bytes: onMounted does not
        // run on the server, so the catalog is empty when the server renders. The docs
        // claimed "better SEO" and "no flash of untranslated content" for this pattern.
        const InitOnMount = defineComponent({
            setup() {
                const t = useT();
                onMounted(() => {
                    void core
                        .init({
                            projectid: 'handoff-test',
                            key: 'handoff-test',
                            UserLocaleStore: createLocaleStore('it'),
                            initialTranslations: IT,
                            initialTranslationsLocale: 'it',
                        })
                        .catch(() => undefined);
                });
                return () => h('h1', t.value('Pricing', 'UI'));
            },
        });
        const html = await serve(false, InitOnMount);
        expect(html).toContain('Pricing');
        expect(html).not.toContain('Prezzi');

        const client = await hydrate(html, () => undefined, InitOnMount);
        expect(client.mismatch).toEqual([]);
    });
});
