// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, nextTick, type Component, type VNodeChild } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, Phrase, Translate } from './index.js';
import { createRequestScope } from './server.js';

/**
 * MOVE-4 for units nested in a block: a `<Phrase>` or `<Translate>` that names no category takes the
 * enclosing block's category and previous category, since it moved with the block; one that names
 * its own category (`''` included) takes neither, and moves only if it names its own previous
 * category. A unit naming no category but a previous category of its own takes the block's
 * category and its own previous category.
 *
 * A nested `<Phrase>` reaches the core two ways: the block's tree carries it as a phrase host
 * (MARK-4), whose category the core reads from the host's markers, and the `<Phrase>` the block
 * re-emits renders and registers itself. A block holding a component falls back to the core's DOM
 * class, and a unit inside it registers itself. Every path must hand the core the same category, so
 * each case reads what a request scope recorded: a block in the seed, a phrase as a miss.
 */

type Item = Record<string, unknown>;

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);

/** A component child: the tree cannot express it, so the block around it falls back. */
const Name = defineComponent({ render: () => h('b', 'Ana') });

/** A catalog holding the inner phrase only under its previous category. */
const HEADER = {
    __uncategorized__: {},
    Header: { 'Inner {m0o}phrase{m0c}': 'Interna {m0o}frase{m0c}' },
};

async function inScope(render: () => VNodeChild, catalog: object = { __uncategorized__: {} }) {
    const scope = await createRequestScope({ locale: 'it', catalog: catalog as never });
    const html = await scope.run(() => renderToString(createSSRApp(defineComponent({ render }))));
    const recorded = [
        ...(scope.misses() as unknown as Item[]),
        ...(Object.values(scope.seed().blocks) as unknown as Item[]),
    ];
    return { html, recorded };
}

const phrase = (props: Record<string, unknown> = {}) => h(Phrase, props, () => ['Inner ', h('i', 'phrase')]);
const block = (props: Record<string, unknown> = {}) =>
    h(Translate, { tag: 'div', ...props }, () => [h('p', 'Inner block'), h('p', 'Second paragraph')]);
const moved = { category: 'Checkout', previousCategory: 'Header' };

/** Every record of the inner phrase: the block's nested host and the component's own, wherever each lands. */
const innerPhrase = (recorded: Item[]) =>
    recorded.filter((r) => JSON.stringify(r.phrase ?? r.tokens ?? '').includes('Inner {m0o}phrase{m0c}'));
const innerBlock = (recorded: Item[]) => recorded.filter((r) => JSON.stringify(r.tokens ?? '').includes('Inner block'));
const categories = (records: Item[]) =>
    records.map((r) => ({ category: r.category, previousCategory: r.previousCategory }));

afterEach(() => seed({ __uncategorized__: {} }, 'en'));

describe('a nested unit that names no category moves with its block (MOVE-4)', () => {
    it('on the tree path, a <Phrase> takes the block’s category and previous category', async () => {
        const { recorded } = await inScope(() =>
            h(Translate, { tag: 'div', ...moved }, () => [h('p', 'First line'), phrase()])
        );
        expect(innerPhrase(recorded).length).toBeGreaterThan(0);
        expect(categories(innerPhrase(recorded))).toEqual(innerPhrase(recorded).map(() => moved));
    });

    it('on the tree path, it renders the previous category’s entry', async () => {
        const { html } = await inScope(
            () => h(Translate, { tag: 'div', ...moved }, () => [h('p', 'First line'), phrase()]),
            HEADER
        );
        expect(html).toContain('Interna <i>frase</i>');
    });

    it('in a block that falls back, a <Phrase> and a <Translate> take the block’s category and previous category', async () => {
        const { recorded } = await inScope(() => h(Translate, moved, () => [h(Name), h('div', [phrase(), block()])]));
        expect(categories(innerPhrase(recorded))).toEqual(innerPhrase(recorded).map(() => moved));
        expect(innerPhrase(recorded).length).toBeGreaterThan(0);
        expect(categories(innerBlock(recorded))).toEqual([moved]);
    });

    it('through a component between them, and through a nested block that itself names none', async () => {
        const Through = defineComponent({
            setup:
                (_, { slots }) =>
                () =>
                    h('section', slots.default?.()),
        });
        const { recorded } = await inScope(() =>
            h(Translate, moved, () => [h(Through, null, () => [h(Translate, null, () => [h(Name), phrase()])])])
        );
        expect(innerPhrase(recorded).length).toBeGreaterThan(0);
        expect(categories(innerPhrase(recorded))).toEqual(innerPhrase(recorded).map(() => moved));
    });

    it('an unmoved block hands down its category alone', async () => {
        const { recorded } = await inScope(() =>
            h(Translate, { tag: 'div', category: 'UI' }, () => [h('p', 'First line'), phrase()])
        );
        expect(categories(innerPhrase(recorded))).toEqual(
            innerPhrase(recorded).map(() => ({ category: 'UI', previousCategory: undefined }))
        );
    });

    it('a previous category of its own goes with the block’s category', async () => {
        for (const outer of [() => [h('p', 'First line')], () => [h(Name)]]) {
            const { recorded } = await inScope(() =>
                h(Translate, { tag: 'div', ...moved }, () => [...outer(), phrase({ previousCategory: 'Old' })])
            );
            expect(innerPhrase(recorded).length).toBeGreaterThan(0);
            expect(categories(innerPhrase(recorded))).toEqual(
                innerPhrase(recorded).map(() => ({ category: 'Checkout', previousCategory: 'Old' }))
            );
        }
    });
});

describe('control: a nested unit that names its own category takes neither', () => {
    for (const [label, props, expected] of [
        ['category=""', { category: '' }, { category: '', previousCategory: undefined }],
        ['its own category', { category: 'Own' }, { category: 'Own', previousCategory: undefined }],
        [
            'its own category and previous category',
            { category: 'Own', previousCategory: 'Old' },
            { category: 'Own', previousCategory: 'Old' },
        ],
    ] as const) {
        it(`${label}, on the tree path and in a block that falls back`, async () => {
            for (const outer of [() => [h('p', 'First line')], () => [h(Name)]]) {
                const { recorded } = await inScope(() =>
                    h(Translate, { tag: 'div', ...moved }, () => [...outer(), phrase(props)])
                );
                expect(innerPhrase(recorded).length).toBeGreaterThan(0);
                expect(categories(innerPhrase(recorded))).toEqual(innerPhrase(recorded).map(() => expected));
            }
        });
    }

    it('a <Phrase> outside any block, naming none, has no category', async () => {
        const { recorded } = await inScope(() => phrase());
        expect(categories(innerPhrase(recorded))).toEqual(
            innerPhrase(recorded).map(() => ({ category: '', previousCategory: undefined }))
        );
        expect(innerPhrase(recorded).length).toBeGreaterThan(0);
    });
});

describe('hydration (MOVE-4, MOVE-5)', () => {
    it('a nested <Phrase> rendered from the block’s previous category hydrates without a mismatch', async () => {
        const App = (): Component =>
            defineComponent({
                render: () => h(Translate, { tag: 'div', ...moved }, () => [h('p', 'First line'), phrase()]),
            });
        seed(HEADER, 'it');
        const served = await renderToString(createSSRApp(App()));
        expect(served).toContain('Interna <i>frase</i>');
        const el = document.createElement('div');
        el.innerHTML = served;
        document.body.appendChild(el);
        const warnings: string[] = [];
        const client = createSSRApp(App());
        client.config.warnHandler = (m) => void warnings.push(String(m));
        const error = console.error;
        console.error = (...a: unknown[]) => void warnings.push(a.map(String).join(' '));
        try {
            client.mount(el);
            await nextTick();
        } finally {
            console.error = error;
        }
        expect(el.innerHTML).toContain('Interna <i>frase</i>');
        expect(warnings.filter((w) => /hydrat|mismatch/i.test(w))).toEqual([]);
        client.unmount();
        el.remove();
    });
});
