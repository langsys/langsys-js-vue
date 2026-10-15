// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, createSSRApp, defineComponent, h, Teleport, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { DontTranslate, LangsysApp, Phrase, Translate } from './index.js';
import { createRequestScope } from './server.js';

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
        'Built with': 'Creato con',
        'is ours': 'è nostro',
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

    it('a declined block throws nothing, on the server or in the browser (SRV-5)', async () => {
        const Child = defineComponent({ render: () => h('span', 'Pricing') });
        const Declined = defineComponent({ render: () => h(Translate, { category: 'UI' }, () => [h(Child)]) });
        await expect(renderToString(createSSRApp(Declined))).resolves.toContain('<span>Pricing</span>');
        await expect(serveAndHydrate(() => Declined)).resolves.toMatchObject({ mismatches: [] });
    });

    it("each attribute keeps the element's own spelling: an SVG's camelCase attributes are served once", async () => {
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({
                render: () =>
                    h(Translate, { category: 'UI' }, () => [
                        h('p', [
                            h('svg', { viewBox: '0 0 24 24', preserveAspectRatio: 'none' }, [h('path', { d: 'M0 0' })]),
                            'Pricing',
                        ]),
                    ]),
            })
        );
        expect(served).toContain(
            '<p><svg viewBox="0 0 24 24" preserveAspectRatio="none"><path d="M0 0"></path></svg>Prezzi</p>'
        );
        expect(el.innerHTML).toBe(served);
        expect(mismatches).toEqual([]);
    });

    describe("the space beside a <DontTranslate> at a block's edge", () => {
        const Edges = () =>
            defineComponent({
                render: () =>
                    h('div', [
                        h(Translate, { category: 'UI' }, () => [
                            h('p', ['Built with ', h(DontTranslate, null, () => 'Kangen®')]),
                        ]),
                        h(Translate, { category: 'UI' }, () => [
                            h('p', [h(DontTranslate, null, () => 'Kangen®'), ' is ours']),
                        ]),
                    ]),
            });
        const texts = (el: Element) => [...el.querySelectorAll('p')].map((p) => p.textContent);

        it('is kept in source text', async () => {
            const el = document.createElement('div');
            el.innerHTML = await renderToString(createSSRApp(Edges()));
            expect(texts(el)).toEqual(['Built with Kangen®', 'Kangen® is ours']);
        });

        it('is kept in a translation, served and hydrated', async () => {
            const { served, el, mismatches } = await serveAndHydrate(Edges);
            expect(served).toContain('<p>Creato con <span translate="no"');
            expect(texts(el)).toEqual(['Creato con Kangen®', 'Kangen® è nostro']);
            expect(mismatches).toEqual([]);
        });
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

describe('a block nested in a <Translate> that falls back', () => {
    /**
     * The outer block holds a component, so the core's DOM class translates it after mount and
     * walks its subtree; the inner block renders on the tree path with params of its own. The inner
     * hands the core its host on registration, so the walk leaves it alone: after hydration, with
     * the whole seed on the client, and after a catalog update, its values stay its own.
     */
    it('keeps its own params in a translated attribute after hydration and a catalog update', async () => {
        const IT_PHOTO = { __uncategorized__: {}, UI: { photo: { 'Photo of {name}': 'Foto di {name}' } } };
        const Icon = defineComponent({ render: () => h('i', '*') });
        const App = defineComponent({
            render: () =>
                h('div', [
                    h(Translate, { category: 'UI' }, () => [
                        h(Icon),
                        h(Translate, { category: 'UI', custom_id: 'photo', params: { name: 'Ana' } }, () => [
                            h('img', { alt: 'Photo of %name%' }),
                        ]),
                    ]),
                ]),
        });
        const g = globalThis as Record<string, unknown>;
        const win = g.window;
        delete g.window; // a server render
        let served: string;
        let requestSeed: ReturnType<Awaited<ReturnType<typeof createRequestScope>>['seed']>;
        try {
            const scope = await createRequestScope({ locale: 'it', catalog: IT_PHOTO as never });
            served = await scope.run(() => renderToString(createSSRApp(App)));
            requestSeed = scope.seed();
        } finally {
            g.window = win;
        }
        expect(served).toContain('<img alt="Foto di Ana">');

        LangsysApp.seedCatalog(requestSeed.catalog, requestSeed.locale, requestSeed);
        const el = document.createElement('div');
        el.innerHTML = served;
        document.body.appendChild(el);
        const client = createSSRApp(App);
        client.mount(el);
        cleanups.push(() => {
            client.unmount();
            el.remove();
        });
        const alt = () => el.querySelector('img')?.getAttribute('alt');
        await new Promise((r) => setTimeout(r, 900));
        expect(alt()).toBe('Foto di Ana');
        seed({ ...IT_PHOTO, UI: { ...IT_PHOTO.UI, Other: 'Altro' } }, 'it');
        await new Promise((r) => setTimeout(r, 900));
        expect(alt()).toBe('Foto di Ana');
    });
});

describe('the locale form across hydration', () => {
    it('served from a request in es-ES, the client seeded with es-ES hydrates with identical DOM and no mismatch (WIRE-3)', async () => {
        const ES = { __uncategorized__: {}, UI: { Pricing: 'Precios' } };
        const Page = defineComponent({ render: () => h(Translate, { category: 'UI' }, () => [h('p', 'Pricing')]) });
        const scope = await createRequestScope({ locale: 'es-ES', catalog: ES as never });
        const html = await scope.run(() => renderToString(createSSRApp(Page)));
        seed(ES, 'es-ES');
        expect(html).toContain('data-ls-resolved="es-es"'); // the canonical lowercase form
        const el = document.createElement('div');
        el.innerHTML = html;
        document.body.appendChild(el);
        const warnings: string[] = [];
        const app = createSSRApp(Page);
        app.config.warnHandler = (m) => void warnings.push(String(m));
        const error = console.error;
        console.error = (...a: unknown[]) => void warnings.push(a.map(String).join(' '));
        app.mount(el);
        console.error = error;
        cleanups.push(() => {
            app.unmount();
            el.remove();
        });
        expect({ html, after: el.innerHTML, mismatches: warnings.filter((w) => /hydrat|mismatch/i.test(w)) }).toEqual({
            html,
            after: html,
            mismatches: [],
        });
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
        expect(served).toBe('<span data-ls-phrase data-ls-resolved="it"><b>mondo</b> ciao di nuovo</span>');
        expect(mismatches).toEqual([]);
        el.querySelector('b')!.dispatchEvent(new Event('click'));
        expect(clicks).toBe(1);
    });

    it('fills its params into a <DontTranslate>, as into any excluded element, served and hydrated', async () => {
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({
                render: () =>
                    h('div', [
                        h(Phrase, { category: 'UI', params: { email: 'a@b.c' } }, () => [
                            'Write to ',
                            h(DontTranslate, null, () => '%email%'),
                            ' for help',
                        ]),
                        // Control: the same phrase around a plain translate="no" element.
                        h(Phrase, { category: 'UI', params: { email: 'a@b.c' } }, () => [
                            'Write to ',
                            h('b', { translate: 'no' }, '%email%'),
                            ' for help',
                        ]),
                    ]),
            })
        );
        expect(served).toContain('<span translate="no" data-ls-dont-translate>a@b.c</span>');
        expect(served).toContain('<b translate="no">a@b.c</b>');
        expect([...el.querySelectorAll('[data-ls-phrase]')].map((x) => x.textContent)).toEqual([
            'Write to a@b.c for help',
            'Write to a@b.c for help',
        ]);
        expect(mismatches).toEqual([]);
    });
});

describe('<DontTranslate> inside a block', () => {
    it('renders a teleport its slot holds once', async () => {
        seed(IT, 'it');
        const target = document.createElement('div');
        target.id = 'tp';
        document.body.appendChild(target);
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(
            defineComponent({
                render: () =>
                    h(Translate, { category: 'UI' }, () => [
                        h('p', [
                            'Pricing ',
                            h(DontTranslate, null, () => ['Kangen', h(Teleport, { to: '#tp' }, [h('b', 'TP')])]),
                        ]),
                    ]),
            })
        );
        app.mount(el);
        cleanups.push(() => {
            app.unmount();
            el.remove();
            target.remove();
        });
        await new Promise((r) => setTimeout(r, 20));
        expect(target.innerHTML).toBe('<b>TP</b>');
        expect(el.textContent).toBe('Prezzi Kangen');
    });
});
