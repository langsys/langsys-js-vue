// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import * as Vue from 'vue';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { compile } from '@vue/compiler-dom';
import { until } from '../test/helpers/contract-fixture.js';
import { LangsysApp, Translate } from './index.js';

/**
 * A `<Translate>` follows its slot through the life of the page: a slot can move between the tree
 * path and the core's DOM class after mount, a component under the DOM class can change its own
 * text, the block can be unmounted inside the core's settle window or deactivated by `<KeepAlive>`,
 * and the page shows the current locale's translation throughout. What each path registers is in
 * `block-updates-contract.test.ts`.
 */

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);
const IT = { __uncategorized__: {}, UI: { Pricing: 'Prezzi', Checkout: 'Cassa' } };
const DE = { __uncategorized__: {}, UI: { Pricing: 'Preise', Checkout: 'Kasse' } };
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));
const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    seed({ __uncategorized__: {} }, 'en');
});
function mount(component: object) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(component);
    app.mount(el);
    cleanups.push(() => {
        app.unmount();
        el.remove();
    });
    return el;
}

describe('<Translate> through the life of the page', () => {
    it('a slot that becomes a component after mount is still translated', async () => {
        seed(IT, 'it');
        const Child = defineComponent({ render: () => h('p', 'Pricing') });
        const show = ref(false);
        const el = mount({
            render: () => h(Translate, { category: 'UI' }, () => [show.value ? h(Child) : h('p', 'Pricing')]),
        });
        expect(el.textContent).toBe('Prezzi');
        show.value = true;
        await until(() => el.textContent === 'Prezzi');
        expect(el.textContent).toBe('Prezzi');
    });

    it('a slot that stops being a component after mount follows a later locale switch', async () => {
        seed(IT, 'it');
        const Child = defineComponent({ render: () => h('p', 'Pricing') });
        const show = ref(true);
        const el = mount({
            render: () => h(Translate, { category: 'UI' }, () => [show.value ? h(Child) : h('p', 'Pricing')]),
        });
        await until(() => el.textContent === 'Prezzi');
        expect(el.textContent).toBe('Prezzi');
        show.value = false;
        await nextTick();
        await wait(800);
        seed(DE, 'de');
        await until(() => el.textContent === 'Preise');
        expect(el.textContent).toBe('Preise');
    });

    it('text a child component updates under the DOM class is translated again', async () => {
        seed(IT, 'it');
        const label = ref('Pricing');
        const Child = defineComponent({ render: () => h('p', label.value) });
        const el = mount({ render: () => h(Translate, { category: 'UI' }, () => [h(Child)]) });
        await until(() => el.textContent === 'Prezzi');
        expect(el.textContent).toBe('Prezzi');
        label.value = 'Checkout';
        await until(() => el.textContent === 'Cassa');
        expect(el.textContent).toBe('Cassa');
    });

    it('unmounting a fallback block inside the settle window throws nothing later', async () => {
        seed(IT, 'it');
        const Child = defineComponent({ render: () => h('p', 'Pricing') });
        const errors: unknown[] = [];
        const onError = (e: ErrorEvent) => void errors.push(e.error ?? e.message);
        window.addEventListener('error', onError);
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp({ render: () => h(Translate, { category: 'UI' }, () => [h(Child)]) });
        app.mount(el);
        await wait(100);
        app.unmount();
        el.remove();
        await wait(900);
        window.removeEventListener('error', onError);
        expect(errors).toEqual([]);
    });

    it('a fallback block kept alive while deactivated shows the new locale when reactivated', async () => {
        seed(IT, 'it');
        const Child = defineComponent({ render: () => h('p', 'Pricing') });
        const Block = defineComponent({ render: () => h(Translate, { category: 'UI' }, () => [h(Child)]) });
        const Other = defineComponent({ render: () => h('i', 'other') });
        const showBlock = ref(true);
        const el = mount({ render: () => h(KeepAlive, null, [showBlock.value ? h(Block) : h(Other)]) });
        await until(() => el.textContent === 'Prezzi');
        expect(el.textContent).toBe('Prezzi');
        showBlock.value = false;
        await nextTick();
        seed(DE, 'de');
        await wait(100);
        showBlock.value = true;
        await until(() => el.textContent === 'Preise');
        expect(el.textContent).toBe('Preise');
    });

    it('a block holding a compiled variable keeps its text through a catalog update and a locale switch', async () => {
        seed(IT, 'it');
        const code = compile('<Translate category="UI"><p>Good night, {{ name }}</p></Translate>', {
            mode: 'function',
        }).code;
        const el = mount({
            render: new Function('Vue', code)(Vue),
            data: () => ({ name: 'Ana' }),
            components: { Translate },
        });
        await nextTick();
        expect(el.textContent).toBe('Good night, Ana');
        seed({ ...IT, UI: { ...IT.UI, Other: 'Altro' } }, 'it');
        await nextTick();
        expect(el.textContent).toBe('Good night, Ana');
        seed(DE, 'de');
        await nextTick();
        expect(el.textContent).toBe('Good night, Ana');
    });
});
