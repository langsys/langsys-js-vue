// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/page"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, nextTick, type Component } from 'vue';
import {
    generateCustomId,
    PREVIOUS_CATEGORY_MARKER_ATTR,
    PREVIOUS_CONTENT_BLOCK_MARKER_ATTR,
} from 'langsys-js-typescript';
import { sleep, startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds, { MOVED_BLOCK } from '../test/helpers/contract-seeds/move-categories.js';
import type { World } from '../test/helpers/contract-worlds.js';
import {
    createLocaleStore,
    currentlyLoadedLocale,
    inCategory,
    LangsysApp,
    Phrase,
    sTranslations,
    Translate,
    useT,
} from './index.js';

/**
 * MOVE-1, MOVE-3 and MOVE-4 through this binding, against the API on an SDK test clone, which
 * stores `previous_category` (spec CONF-2). Content translated under `Header` is rendered under
 * `Checkout` naming `Header` as its previous category, through each Vue surface that takes a
 * category: `<Phrase previousCategory>`, `<Translate previousCategory>` and `useT()` with the
 * core's `inCategory()`.
 *
 * - MOVE-4: each renders the `Header` translation the catalog holds, while `Checkout` holds none.
 * - MOVE-1: each registers under `Checkout` with `previous_category` `Header`, read back as the API
 *   answers it: the item `Checkout` now serves holds `Header`'s translation as its own, which the
 *   API copies only for an item registered with that previous category. The catalog's data form
 *   tells the two apart: it also serves an untranslated item the translation of the same text in
 *   another category, flagged `memory_translated`. The control, a phrase translated under `Header`
 *   and rendered under `Checkout` naming none, holds no translation of its own.
 * - MOVE-3: once the refreshed catalog holds the moved items, a later render sends nothing.
 *
 * The decisions are the core's; this binding's half is handing each surface's previous category
 * to it. Every item sent is also read at the transport seam. Its own file: a second `init()` in
 * one process is a no-op.
 */

let fx: ContractFixture;
let w: World;
const sent: Array<Record<string, unknown>> = [];
const realFetch = globalThis.fetch;
const BLOCK_ID = generateCustomId('Checkout', ['Moved block', 'Second paragraph']);
const PREVIOUS_BLOCK_ID = generateCustomId('Header', ['Moved block', 'Second paragraph']);

const SignIn = defineComponent({
    setup() {
        const t = useT();
        return () =>
            h(
                'span',
                { id: 'call' },
                (t.value as unknown as (phrase: string, category: unknown) => string)(
                    'Sign in',
                    inCategory('Checkout', { previousCategory: 'Header' })
                )
            );
    },
});
const Page = defineComponent({
    render: () =>
        h('div', [
            h('p', { id: 'phrase' }, [
                h(Phrase, { category: 'Checkout', previousCategory: 'Header' }, () => 'Buy now'),
            ]),
            h('p', [h(SignIn)]),
            h('section', { id: 'block' }, [
                h(Translate, { category: 'Checkout', previousCategory: 'Header' }, () => MOVED_BLOCK()),
            ]),
            h('p', { id: 'control' }, [h(Phrase, { category: 'Checkout' }, () => 'Not moved')]),
        ]),
});

async function mount(component: Component) {
    const host = document.createElement('div');
    document.body.appendChild(host);
    const app = createApp(component);
    app.mount(host);
    await nextTick();
    const text = (id: string) => host.querySelector(`#${id}`)?.textContent ?? '';
    /** The value of `name` on the unit host inside `#id`, or null. */
    const marker = (id: string, name: string) => host.querySelector(`#${id} [${name}]`)?.getAttribute(name) ?? null;
    return {
        text,
        marker,
        unmount: () => {
            app.unmount();
            host.remove();
        },
    };
}

/** One item as the catalog's data form serves it; a block's phrases are its `translations`. */
interface Row {
    type: 'phrase' | 'content_block';
    phrase: string | null;
    custom_id: string | null;
    translation: string | null;
    memory_translated: boolean;
    translations: Row[] | null;
}

/** What the catalog serves at es-es under `category`, in its data form, read by the test under the case's key. */
async function served(category: string): Promise<Row[]> {
    const { body } = await fx.api(`/translations/data?project_id=${encodeURIComponent(w.project())}&locale=es-es`, {
        key: w.key('k-writer'),
    });
    return (body?.data?.[category] ?? []) as Row[];
}
const phraseRow = (rows: Row[], phrase: string) => rows.find((r) => r.type === 'phrase' && r.phrase === phrase);
const blockRow = (rows: Row[], id: string) => rows.find((r) => r.type === 'content_block' && r.custom_id === id);
/** The translation an item holds itself: not a memory match from the same text in another category. */
const own = (row: Row | undefined) => (row && !row.memory_translated ? (row.translation ?? undefined) : undefined);

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('moved');
    await fx.use(w);
    for (const m of ['log', 'info', 'warn', 'error', 'debug', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
        if (String(input).endsWith('/translatable-items') && typeof init?.body === 'string') {
            sent.push(...(JSON.parse(init.body).translatable_items as Array<Record<string, unknown>>));
        }
        return realFetch(input, init);
    }) as typeof fetch;
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-writer'),
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es', 15_000, 50);
});
afterAll(async () => {
    globalThis.fetch = realFetch;
    await fx?.stop();
});

const sentFor = (match: (i: Record<string, unknown>) => boolean) => sent.filter(match);
const phraseItem = (phrase: string) => (i: Record<string, unknown>) => i.phrase === phrase;
const blockItem = (i: Record<string, unknown>) => i.type === 'content_block' && i.custom_id === BLOCK_ID;

describe('content moved from Header to Checkout, through each Vue surface', () => {
    it('MOVE-4 and MOVE-1: renders the previous category’s translation, and registers under the new one with it, as the API reads it', async () => {
        expect(await served('Checkout')).toEqual([]);
        const view = await mount(Page);
        try {
            expect(view.text('phrase')).toBe('Comprá ya');
            expect(view.text('call')).toBe('Ingresá');
            expect(view.text('block')).toBe('Bloque movidoSegundo párrafo');
            expect(view.text('control')).toBe('Not moved');
            // MOVE-5, and the control for the case below: each host says it rendered from the
            // previous category, since the copied translations read the same as the old ones.
            expect(view.marker('phrase', PREVIOUS_CATEGORY_MARKER_ATTR)).toBe('Header');
            expect(view.marker('block', PREVIOUS_CONTENT_BLOCK_MARKER_ATTR)).toBe(PREVIOUS_BLOCK_ID);
            expect(view.marker('control', PREVIOUS_CATEGORY_MARKER_ATTR)).toBeNull();

            await until(async () => {
                const checkout = await served('Checkout');
                return (
                    ['Buy now', 'Sign in', 'Not moved'].every((p) => phraseRow(checkout, p)) &&
                    blockRow(checkout, BLOCK_ID) !== undefined
                );
            });
            const checkout = await served('Checkout');
            expect(own(phraseRow(checkout, 'Buy now'))).toBe('Comprá ya');
            expect(own(phraseRow(checkout, 'Sign in'))).toBe('Ingresá');
            const block = blockRow(checkout, BLOCK_ID)!;
            expect(Object.fromEntries((block.translations ?? []).map((p) => [p.phrase, own(p)]))).toEqual({
                'Moved block': 'Bloque movido',
                'Second paragraph': 'Segundo párrafo',
            });
            // The control: the same API, given no previous category, copies nothing.
            expect(own(phraseRow(checkout, 'Not moved'))).toBeUndefined();

            // At the transport seam: each moved item went out once, under Checkout, naming Header.
            for (const match of [phraseItem('Buy now'), phraseItem('Sign in'), blockItem]) {
                expect(sentFor(match)).toHaveLength(1);
                expect(sentFor(match)[0]).toMatchObject({ category: 'Checkout', previous_category: 'Header' });
            }
            expect(sentFor(phraseItem('Not moved'))[0]).not.toHaveProperty('previous_category');
        } finally {
            view.unmount();
        }
    });

    it('MOVE-3 and MOVE-4: once the refreshed catalog holds the moved items, a later render takes them from the new category and sends nothing', async () => {
        await LangsysApp.refresh();
        await until(() => {
            const checkout = (sTranslations.get() as Record<string, Record<string, unknown>>).Checkout ?? {};
            return checkout['Buy now'] === 'Comprá ya' && checkout['Sign in'] === 'Ingresá' && BLOCK_ID in checkout;
        });
        const before = sent.length;
        const view = await mount(Page);
        try {
            expect(view.text('phrase')).toBe('Comprá ya');
            expect(view.text('call')).toBe('Ingresá');
            expect(view.text('block')).toBe('Bloque movidoSegundo párrafo');
            expect(view.marker('phrase', PREVIOUS_CATEGORY_MARKER_ATTR), 'rendered from Checkout').toBeNull();
            expect(view.marker('block', PREVIOUS_CONTENT_BLOCK_MARKER_ATTR), 'rendered from Checkout').toBeNull();
            await sleep(3000);
            expect(sent.slice(before)).toEqual([]);
        } finally {
            view.unmount();
        }
    });
});
