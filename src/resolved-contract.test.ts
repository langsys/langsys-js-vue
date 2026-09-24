// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, type VNode } from 'vue';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Phrase, Translate, useT } from './index.js';

/**
 * GATE-10 against the contract double: text inside a `data-ls-resolved` subtree is not source,
 * so nothing inside it is registered. This binding's part is handing the core the real DOM
 * host of every `<Translate>` and `<Phrase>`, so the core's ancestor walk reaches a marker the
 * app put anywhere above the component.
 *
 * The session may write and the double accepts registration from it, so an absence is
 * evidence: the double would have stored the phrase. Every case pairs the marked phrase with
 * an unmarked sibling rendered in the same tree, and waits for the sibling to be stored before
 * asserting the absence, so "nothing stored yet" cannot pass as "suppressed".
 */

const SEED = {
    projects: [
        {
            id: 'p1',
            base_locale: 'en',
            target_locales: ['es-es'],
            website_url: 'https://site.local',
            phrases: [{ category: 'UI', phrase: 'Known phrase', translations: { 'es-es': 'Frase conocida' } }],
        },
    ],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
const unmounts: Array<() => void> = [];

const phrases = async () => (await fx.state()).projects.p1.phrases.map((p) => p.phrase);
const blockContents = async () => (await fx.state()).projects.p1.blocks.map((b) => b.content ?? '');
const stored = async (text: string) =>
    (await phrases()).includes(text) || (await blockContents()).some((c) => c.includes(text));

function mount(render: () => VNode): HTMLElement {
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

/** Wait for the control to be stored (proving a flush happened), then report whether `text` was. */
async function storedBeside(control: string, text: string): Promise<boolean> {
    await vi.advanceTimersByTimeAsync(3_000);
    await until(() => stored(control));
    await sleep(200);
    return stored(text);
}

const single = (text: string) => h(Translate, { category: 'UI' }, () => [h('p', text)]);
const block = (a: string, b: string) => h(Translate, { category: 'UI' }, () => [h('p', a), h('p', b)]);
const phrase = (text: string) => h(Phrase, { category: 'UI' }, () => text);
const UsesT = (text: string) =>
    defineComponent({
        setup: () => {
            const t = useT();
            return () => h('span', t.value(text, 'UI') as string);
        },
    });

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es');
    vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
        shouldAdvanceTime: true,
    });
});
afterAll(async () => {
    vi.useRealTimers();
    await fx.stop();
});
afterEach(() => {
    while (unmounts.length) unmounts.pop()!();
});

describe('GATE-10 — a resolved subtree registers nothing, through every wrapper', () => {
    it('<Translate>, single-token path: a marked ancestor suppresses, an unmarked sibling registers', async () => {
        mount(() =>
            h('div', [
                h('div', { 'data-ls-resolved': 'es-es' }, [h('section', [single('Resolved single A')])]),
                single('Source single A'),
            ])
        );
        expect(await storedBeside('Source single A', 'Resolved single A')).toBe(false);
    });

    it('<Translate>, content-block path', async () => {
        mount(() =>
            h('div', [
                h('div', { 'data-ls-resolved': '' }, [block('Resolved block one', 'Resolved block two')]),
                block('Source block one', 'Source block two'),
            ])
        );
        expect(await storedBeside('Source block one', 'Resolved block one')).toBe(false);
    });

    it('<Phrase>', async () => {
        mount(() =>
            h('div', [h('div', { 'data-ls-resolved': '' }, [phrase('Resolved phrase C')]), phrase('Source phrase C')])
        );
        expect(await storedBeside('Source phrase C', 'Resolved phrase C')).toBe(false);
    });

    it('the legacy spelling data-langsys-resolved suppresses too', async () => {
        mount(() =>
            h('div', [
                h('div', { 'data-langsys-resolved': '' }, [single('Resolved legacy D')]),
                single('Source legacy D'),
            ])
        );
        expect(await storedBeside('Source legacy D', 'Resolved legacy D')).toBe(false);
    });

    it('="false" on a nearer ancestor opts back out, so the text registers', async () => {
        mount(() =>
            h('div', { 'data-ls-resolved': 'es-es' }, [
                h('div', { 'data-ls-resolved': 'false' }, [single('Opted out E')]),
                single('Still resolved E'),
            ])
        );
        await vi.advanceTimersByTimeAsync(3_000);
        await until(() => stored('Opted out E'));
        await sleep(200);
        expect(await stored('Still resolved E')).toBe(false);
    });

    it('identity and translation are untouched: a stamped block keeps its id and a known phrase still translates', async () => {
        const el = mount(() =>
            h('div', { 'data-ls-resolved': '' }, [
                h(Translate, { category: 'UI', custom_id: 'resolved-block-f' }, () => [h('p', 'Known phrase')]),
            ])
        );
        await until(() => el.querySelector('translate')?.textContent === 'Frase conocida');
        expect(el.querySelector('translate')?.getAttribute('data-ls-contentblock')).toBe('resolved-block-f');
    });

    /**
     * A bare `t()` call has no DOM host, so no reader can walk to the marker. Measured, not
     * assumed: `useT()` inside a resolved subtree still registers. This pins the gap GATE-10's
     * row records; it goes red if the path ever starts honouring the marker.
     */
    it('known gap: useT() inside a resolved subtree still registers', async () => {
        mount(() =>
            h('div', [h('div', { 'data-ls-resolved': '' }, [h(UsesT('Resolved via t G'))]), single('Source single G')])
        );
        expect(await storedBeside('Source single G', 'Resolved via t G')).toBe(true);
    });
});
