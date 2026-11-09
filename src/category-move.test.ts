// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Vue from 'vue';
import { createApp, createSSRApp, defineComponent, h, nextTick, ref, type Component } from 'vue';
import { compile } from '@vue/compiler-dom';
import { renderToString } from 'vue/server-renderer';
import { generateCustomId } from 'langsys-js-typescript';
import { langsysTransform } from './compiler.js';
import { DontTranslate, inCategory, isCategoryRef, LangsysApp, Phrase, Translate, useT } from './index.js';
import { createRequestScope } from './server.js';

/**
 * Content moved to another category (spec MOVE-1..MOVE-5), through this binding.
 *
 * The behaviour is the core's; the binding forwards `previousCategory` from `<Translate>` and
 * `<Phrase>` (and a nested `<Phrase>` inside a block) and re-exports `inCategory()` for `t()`. Each
 * case below therefore checks the value reached the core, by what the core does with it: the
 * previous category's entry renders (MOVE-4) and the host says so (MOVE-5), the id stays the
 * current category's (MOVE-2), and the registration a request scope sends carries
 * `previous_category` (MOVE-1, MOVE-3). Each has a control with no move, rendered over the same
 * catalog, that renders source.
 */

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);

const BLOCK_TOKENS = ['First line', 'Second line'];
const PREVIOUS_ID = generateCustomId('Header', BLOCK_TOKENS);
const CURRENT_ID = generateCustomId('Checkout', BLOCK_TOKENS);

/** The catalog the first deploy after the move loads: everything is still under `Header`. */
const BEFORE = {
    __uncategorized__: { 'Was uncategorized': 'Era senza categoria' },
    Header: {
        'Buy now': 'Compra ora',
        'Hello, {name}': 'Ciao, {name}',
        'Read the {m0o}terms{m0c}': 'Leggi i {m0o}termini{m0c}',
        [PREVIOUS_ID]: { 'First line': 'Prima riga', 'Second line': 'Seconda riga' },
    },
};

/** The catalog once the API has copied the translations under `Checkout`. */
const AFTER = {
    ...BEFORE,
    Checkout: {
        'Read the {m0o}terms{m0c}': 'Leggete i {m0o}termini{m0c}',
        [CURRENT_ID]: { 'First line': 'Riga uno', 'Second line': 'Riga due' },
    },
};

const MovedBlock = (props: Record<string, unknown> = { previousCategory: 'Header' }) =>
    h(Translate, { category: 'Checkout', tag: 'div', ...props }, () => [h('p', 'First line'), h('p', 'Second line')]);
const MovedPhrase = (props: Record<string, unknown> = { previousCategory: 'Header' }) =>
    h(Phrase, { category: 'Checkout', ...props }, () => ['Read the ', h('b', 'terms')]);

const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    seed({ __uncategorized__: {} }, 'en');
});

/** Serve `app` over `catalog`, then hydrate the bytes over the same catalog. */
async function serveAndHydrate(app: () => Component, catalog: object = BEFORE) {
    seed(catalog, 'it');
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

describe('re-exports', () => {
    it('inCategory() and isCategoryRef() are the core’s, by reference', async () => {
        const core = await import('langsys-js-typescript');
        expect(inCategory).toBe(core.inCategory);
        expect(isCategoryRef).toBe(core.isCategoryRef);
        expect(isCategoryRef(inCategory('Checkout', { previousCategory: 'Header' }))).toBe(true);
    });
});

describe('<Translate previousCategory> (MOVE-4, MOVE-5, MOVE-2)', () => {
    it('serves the previous category’s block under the current id, stamped with the previous one; hydration matches', async () => {
        const { served, el, mismatches } = await serveAndHydrate(() => defineComponent({ render: () => MovedBlock() }));
        expect(served).toContain('<p>Prima riga</p><p>Seconda riga</p>');
        expect(served).toContain(`data-ls-contentblock="${CURRENT_ID}"`);
        expect(served).toContain(`data-ls-previous-contentblock="${PREVIOUS_ID}"`);
        expect(el.innerHTML).toBe(served);
        expect(mismatches).toEqual([]);
    });

    it('control: the same block with no previous category is served as source, unstamped, under the same id', async () => {
        const { served } = await serveAndHydrate(() => defineComponent({ render: () => MovedBlock({}) }));
        expect(served).toContain('<p>First line</p><p>Second line</p>');
        expect(served).toContain(`data-ls-contentblock="${CURRENT_ID}"`);
        expect(served).not.toContain('data-ls-previous');
    });

    it('null is no move, as unset is', async () => {
        const { served } = await serveAndHydrate(() =>
            defineComponent({ render: () => MovedBlock({ previousCategory: null }) })
        );
        expect(served).toContain('<p>First line</p>');
        expect(served).not.toContain('data-ls-previous');
    });

    it('once the catalog holds the block under its current category, that renders and the stamp goes', async () => {
        seed(BEFORE, 'it');
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(defineComponent({ render: () => MovedBlock() }));
        app.mount(el);
        cleanups.push(() => {
            app.unmount();
            el.remove();
        });
        await nextTick();
        expect(el.innerHTML).toContain('Prima riga');
        expect(el.querySelector('[data-ls-previous-contentblock]')).not.toBeNull();

        seed(AFTER, 'it');
        await nextTick();
        expect(el.innerHTML).toContain('<p>Riga uno</p><p>Riga due</p>');
        expect(el.querySelector('[data-ls-previous-contentblock]')).toBeNull();
        expect(el.firstElementChild!.getAttribute('data-ls-contentblock')).toBe(CURRENT_ID);
    });

    it('a previous category set after mount reaches the core: the next render reads it', async () => {
        seed(BEFORE, 'it');
        const previous = ref<string | undefined>(undefined);
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(defineComponent({ render: () => MovedBlock({ previousCategory: previous.value }) }));
        app.mount(el);
        cleanups.push(() => {
            app.unmount();
            el.remove();
        });
        await nextTick();
        expect(el.innerHTML).toContain('First line');
        previous.value = 'Header';
        await nextTick();
        expect(el.innerHTML).toContain('Prima riga');
    });
});

describe('<Phrase previousCategory> (MOVE-4, MOVE-5)', () => {
    it('serves the previous category’s phrase, stamped data-ls-previous-category; hydration matches', async () => {
        const { served, el, mismatches } = await serveAndHydrate(() =>
            defineComponent({ render: () => MovedPhrase() })
        );
        expect(served).toContain('Leggi i <b>termini</b>');
        expect(served).toContain('data-ls-previous-category="Header"');
        // The DOM writes an empty attribute as `=""`, the server as the bare name.
        expect(el.innerHTML).toBe(served.replace('data-ls-phrase ', 'data-ls-phrase="" '));
        expect(mismatches).toEqual([]);
    });

    it('control: with no previous category it is served as source, unstamped', async () => {
        const { served } = await serveAndHydrate(() => defineComponent({ render: () => MovedPhrase({}) }));
        expect(served).toContain('Read the <b>terms</b>');
        expect(served).not.toContain('data-ls-previous');
    });

    it("'' is a value: no category before reads the uncategorized entries", async () => {
        const { served } = await serveAndHydrate(() =>
            defineComponent({
                render: () => h(Phrase, { category: 'Checkout', previousCategory: '' }, () => 'Was uncategorized'),
            })
        );
        expect(served).toContain('Era senza categoria');
        // An empty attribute is served as its bare name.
        expect(served).toMatch(/ data-ls-previous-category[ >]/);
    });

    it('once the catalog holds it under the current category, that renders and the stamp goes', async () => {
        seed(BEFORE, 'it');
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(defineComponent({ render: () => MovedPhrase() }));
        app.mount(el);
        cleanups.push(() => {
            app.unmount();
            el.remove();
        });
        await nextTick();
        expect(el.innerHTML).toContain('Leggi i <b>termini</b>');
        seed(AFTER, 'it');
        await nextTick();
        expect(el.innerHTML).toContain('Leggete i <b>termini</b>');
        expect(el.querySelector('[data-ls-previous-category]')).toBeNull();
    });
});

describe('a <Phrase> nested in a <Translate>', () => {
    const Nested = (phraseProps: Record<string, unknown>, blockProps: Record<string, unknown> = {}) =>
        defineComponent({
            render: () =>
                h(Translate, { category: 'Checkout', tag: 'div', ...blockProps }, () => [
                    h('p', 'First line'),
                    h('p', 'Second line'),
                    h(Phrase, { category: 'Checkout', ...phraseProps }, () => ['Read the ', h('b', 'terms')]),
                ]),
        });

    it('renders from its own previous category, and never puts the prop in the block’s content', async () => {
        const { served, mismatches } = await serveAndHydrate(() => Nested({ previousCategory: 'Header' }));
        expect(served).toContain('Leggi i <b>termini</b>');
        expect(served).not.toMatch(/previouscategory=/i);
        expect(mismatches).toEqual([]);
    });

    it('the kebab spelling is read too', async () => {
        const { served } = await serveAndHydrate(() => Nested({ 'previous-category': 'Header' }));
        expect(served).toContain('Leggi i <b>termini</b>');
        expect(served).not.toMatch(/ previous-category=/);
    });

    it('MOVE-2: the block’s id and tokens are the same with and without the nested move; the host is marked as the core stamps one', async () => {
        const record = async (phraseProps: Record<string, unknown>) => {
            const scope = await createRequestScope({ locale: 'it', catalog: BEFORE as never });
            await scope.run(() => renderToString(createSSRApp(Nested(phraseProps))));
            return Object.values(scope.seed().blocks);
        };
        const [control] = await record({});
        expect(control!.content).not.toContain('data-ls-previous');
        // Both spellings a template or h() produces: the vnode's key is `previous-category` from a
        // compiled template and `previousCategory` from h().
        for (const props of [{ previousCategory: 'Header' }, { 'previous-category': 'Header' }]) {
            const [moved] = await record(props);
            expect(moved!.customId).toBe(CURRENT_ID);
            expect(moved!.customId).toBe(control!.customId);
            expect(moved!.tokens).toEqual(control!.tokens);
            // The nested host names its move beside its category, as MOVE-4 has markup name it,
            // and the prop never reaches the content as an attribute of its own.
            expect(moved!.content).toContain('data-ls-category="Checkout" data-ls-previous-category="Header"');
            expect(moved!.content).not.toMatch(/[\s"]previous-?category=/i);
            // The block itself did not move.
            expect(moved!.previousCategory).toBeUndefined();
        }
    });

    it('control: with no previous category of its own it is served as source', async () => {
        const { served } = await serveAndHydrate(() => Nested({}));
        expect(served).toContain('Read the <b>terms</b>');
    });
});

describe('t() with inCategory()', () => {
    it('useT(): the previous category’s entry renders until the current one exists', async () => {
        const Comp = defineComponent({
            setup() {
                const t = useT();
                return () =>
                    h('p', [
                        t.value('Buy now', inCategory('Checkout', { previousCategory: 'Header' })),
                        '|',
                        t.value('Buy now', 'Checkout'),
                    ]);
            },
        });
        seed(BEFORE, 'it');
        expect(await renderToString(createSSRApp(Comp))).toBe('<p>Compra ora|Buy now</p>');
    });

    it('a template t() with a template literal and a ref decided at run time keeps the ref as the category', async () => {
        seed(BEFORE, 'it');
        const template = '<p>{{ t(`Hello, ${name}`, where) }}</p>';
        const render = (where: unknown) => {
            const code = compile(template, { mode: 'function', nodeTransforms: [langsysTransform] }).code;
            const app = createSSRApp({
                render: new Function('Vue', code)(Vue) as Vue.RenderFunction,
                data: () => ({ name: 'Sara', where }),
                setup: () => ({ t: useT() }),
            });
            return renderToString(app);
        };
        expect(await render(inCategory('Checkout', { previousCategory: 'Header' }))).toBe('<p>Ciao, Sara</p>');
        // Controls: a plain category, and params, still take their own paths.
        expect(await render('Checkout')).toBe('<p>Hello, Sara</p>');
        expect(await render({ name: 'Ana' })).toBe('<p>Hello, Ana</p>');
    });
});

describe('what a request scope records for the registration (MOVE-1, MOVE-3)', () => {
    const recorded = async (app: Component) => {
        const scope = await createRequestScope({ locale: 'it', catalog: BEFORE as never });
        await scope.run(() => renderToString(createSSRApp(app)));
        return scope.seed().blocks[CURRENT_ID];
    };

    it('a moved block is recorded under its current id with its previous category', async () => {
        expect(await recorded(defineComponent({ render: () => MovedBlock() }))).toMatchObject({
            customId: CURRENT_ID,
            category: 'Checkout',
            previousCategory: 'Header',
        });
    });

    it('control: unmoved, under the same id with none', async () => {
        const block = await recorded(defineComponent({ render: () => MovedBlock({}) }));
        expect(block).toMatchObject({ customId: CURRENT_ID, category: 'Checkout' });
        expect(block!.previousCategory).toBeUndefined();
    });
});

// `<DontTranslate>` takes no category, so it takes no previous category (MOVE-1).
describe('<DontTranslate>', () => {
    it('declares no previousCategory prop', () => {
        expect(Object.keys((DontTranslate as { props?: object }).props ?? {})).not.toContain('previousCategory');
    });
});
