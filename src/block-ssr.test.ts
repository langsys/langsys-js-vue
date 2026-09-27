// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, Phrase, Translate } from './index.js';

/**
 * SRV-1, SRV-5, MARK-1 — `<Translate>` and `<Phrase>` render through the core's DOM-free block
 * path (`renderBlock`), the same way on the server and in the browser.
 *
 * Each case serves real bytes with `vue/server-renderer`, then hydrates them in a DOM seeded with
 * the same catalog and captures Vue's own mismatch warnings.
 */

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);

const IT = {
    __uncategorized__: {},
    UI: {
        Pricing: 'Prezzi',
        'Hello, {name}': 'Ciao, {name}',
        'Hello {m0o}world{m0c} again': '{m0o}mondo{m0c} ciao di nuovo',
    },
};

const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    seed({ __uncategorized__: {} }, 'en');
});

/** Serve `app`, then hydrate the bytes; return both, and the hydration warnings. */
async function serveAndHydrate(app: () => Component) {
    seed(IT, 'it');
    const served = await renderToString(createSSRApp(app()));
    const warnings: string[] = [];
    const el = document.createElement('div');
    el.innerHTML = served;
    document.body.appendChild(el);
    const client = createSSRApp(app());
    client.config.warnHandler = (m) => void warnings.push(String(m));
    const error = console.error;
    console.error = (...a: unknown[]) => void warnings.push(a.map(String).join(' '));
    try {
        client.mount(el);
        await new Promise((r) => setTimeout(r, 20));
    } finally {
        console.error = error;
    }
    cleanups.push(() => {
        client.unmount();
        el.remove();
    });
    return { served, el, mismatches: warnings.filter((w) => /hydrat|mismatch/i.test(w)) };
}

describe('<Translate> through renderBlock', () => {
    it('serves the translation, stamped with its id and marked resolved; hydration matches', async () => {
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({ render: () => h(Translate, { category: 'UI' }, () => [h('p', 'Pricing')]) })
        );
        expect(served).toMatch(/^<translate data-ls-contentblock="[0-9a-f]{32}" data-ls-resolved="it"><p>Prezzi<\/p>/);
        expect(el.innerHTML).toBe(served);
        expect(mismatches).toEqual([]);
    });

    it('fills params on the server and in the browser alike', async () => {
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({
                render: () => h(Translate, { category: 'UI', params: { name: 'Sara' } }, () => 'Hello, %name%'),
            })
        );
        expect(served).toContain('>Ciao, Sara</translate>');
        expect(el.innerHTML).toBe(served);
        expect(mismatches).toEqual([]);
    });

    it('a block the catalog lacks is served as source, stamped, and not marked resolved', async () => {
        const { served } = await serveAndHydrate(() =>
            defineComponent({
                render: () => h(Translate, { category: 'UI' }, () => [h('p', 'Not yet'), h('p', 'translated')]),
            })
        );
        expect(served).toMatch(/^<translate data-ls-contentblock="[0-9a-f]{32}"><p>Not yet<\/p><p>translated<\/p>/);
        expect(served).not.toContain('data-ls-resolved');
    });

    it('a component in the slot falls back: source served, only an explicit id stamped', async () => {
        const Child = defineComponent({ render: () => h('span', 'Pricing') });
        const { served } = await serveAndHydrate(() =>
            defineComponent({
                render: () =>
                    h('div', [
                        h(Translate, { category: 'UI', custom_id: 'explicit-9' }, () => [h(Child)]),
                        h(Translate, { category: 'UI' }, () => [h(Child)]),
                    ]),
            })
        );
        expect(served).toBe(
            '<div><translate data-ls-contentblock="explicit-9"><span>Pricing</span></translate><translate><span>Pricing</span></translate></div>'
        );
    });
});

describe('<Phrase> through renderBlock', () => {
    it('serves a rich phrase with its markup moved; the moved element keeps its handler after hydration', async () => {
        let clicks = 0;
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({
                render: () =>
                    h(Phrase, { category: 'UI' }, () => [
                        'Hello ',
                        h('b', { onClick: () => clicks++ }, 'world'),
                        ' again',
                    ]),
            })
        );
        expect(served).toBe('<span data-ls-phrase><b>mondo</b> ciao di nuovo</span>');
        expect(mismatches).toEqual([]);
        el.querySelector('b')!.dispatchEvent(new Event('click'));
        expect(clicks).toBe(1);
    });
});
