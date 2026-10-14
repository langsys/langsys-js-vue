// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, nextTick, ref } from 'vue';
import { startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Phrase, Translate } from './index.js';

/**
 * A `<Translate>` or `<Phrase>` whose slot changes after mount registers what it shows now, on
 * either path: a static slot whose content changes stays on the tree path, and a slot that turns
 * into a component moves to the core's DOM class. A block `<KeepAlive>` holds out of the page
 * registers nothing, and registers what it shows when it is back. Against the contract double with a write key,
 * reading what it stored; the DOM class registers once its settle window has closed, so each check
 * polls the double rather than reading one flush. Its own file: a second `init()` in one process
 * is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['it'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
const unmounts: Array<() => void> = [];
const stored = async () => {
    const p1 = (await fx.state()).projects.p1;
    return [...p1.phrases.map((p) => p.phrase), ...p1.blocks.map((b) => b.content ?? '')].join('\n');
};
/** Let registrations flush, then wait until the double has stored `text`. */
async function eventuallyStored(text: string): Promise<string> {
    await vi.advanceTimersByTimeAsync(3_000);
    await until(async () => (await stored()).includes(text), 15_000);
    return stored();
}
function mount(render: () => ReturnType<typeof h>) {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(defineComponent({ render }));
    app.mount(el);
    unmounts.push(() => {
        app.unmount();
        el.remove();
    });
    return el;
}

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
    vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
        shouldAdvanceTime: true,
    });
});
afterAll(async () => {
    vi.useRealTimers();
    while (unmounts.length) unmounts.pop()!();
    await fx.stop();
});

describe('a slot that changes after mount registers what it shows', () => {
    it('<Translate>: static content swapped by a v-if registers the new content', async () => {
        const second = ref(false);
        mount(() =>
            h('div', [
                h(Translate, { category: 'UI' }, () => [
                    second.value ? h('p', 'Second block text') : h('p', 'First block text'),
                ]),
                h(Translate, { category: 'UI' }, () => [h('p', 'Static A')]),
            ])
        );
        await eventuallyStored('Static A');
        second.value = true;
        await nextTick();
        expect(await eventuallyStored('Second block text')).toContain('Second block text');
    });

    it('<Phrase>: static content swapped by a v-if registers the new content', async () => {
        const second = ref(false);
        mount(() => h(Phrase, { category: 'UI' }, () => (second.value ? 'Second phrase text' : 'First phrase text')));
        mount(() => h(Phrase, { category: 'UI' }, () => 'Static C'));
        await eventuallyStored('Static C');
        second.value = true;
        await nextTick();
        expect(await eventuallyStored('Second phrase text')).toContain('Second phrase text');
    });

    it('<Translate>: a slot that turns into a component registers through the DOM class', async () => {
        const Child = defineComponent({ render: () => h('p', 'Now from a component') });
        const child = ref(false);
        mount(() => h(Translate, { category: 'UI' }, () => [child.value ? h(Child) : h('p', 'Before the component')]));
        mount(() => h(Translate, { category: 'UI' }, () => [h('p', 'Static E')]));
        await eventuallyStored('Static E');
        child.value = true;
        await nextTick();
        expect(await eventuallyStored('Now from a component')).toContain('Now from a component');
    });

    it.each([
        ['<Translate>', (text: string) => h(Translate, { category: 'UI' }, () => [h('p', text)]), 'block'],
        ['<Phrase>', (text: string) => h(Phrase, { category: 'UI' }, () => text), 'phrase'],
    ] as const)(
        '%s under <KeepAlive>: content that changed while the block was out of the page registers when it is back',
        async (_label, render, kind) => {
            const text = ref(`Before caching the ${kind}`);
            const Block = defineComponent({ render: () => render(text.value) });
            const Other = defineComponent({ render: () => h('p', 'Another tab') });
            const shown = ref(true);
            mount(() => h(KeepAlive, null, [shown.value ? h(Block) : h(Other)]));
            await eventuallyStored(`Before caching the ${kind}`);
            shown.value = false;
            await nextTick();
            text.value = `Changed while the ${kind} was cached`;
            await nextTick();
            mount(() => render(`Static ${kind} L`));
            expect(
                await eventuallyStored(`Static ${kind} L`),
                'control: out of the page, it records nothing'
            ).not.toContain(text.value);
            shown.value = true;
            await nextTick();
            expect(await eventuallyStored(text.value)).toContain(text.value);
        }
    );
});
