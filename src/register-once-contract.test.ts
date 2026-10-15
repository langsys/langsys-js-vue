// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, LangsysAppAPI, t, Translate } from './index.js';

/**
 * REG-7 through this binding: a content block has one registration request in flight. A
 * `<Translate>` registers on mount and again on every `t` change, and a page load changes `t`
 * twice (the catalog publish and the loaded-locale write), so a block mounted as `init()` starts
 * reaches registration three times while its first request may still be unanswered; two mounts of
 * the same content reach it together. Each block is sent once. Sends are counted at the transport
 * seam, since the double folds a repeat into the block it holds. Its own file: a second `init()`
 * in one process is a no-op.
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
const sent: string[] = [];
let tChanges = 0;

const Block = (text: string) => h(Translate, { category: 'UI' }, () => [h('p', `${text} one`), h('p', `${text} two`)]);

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    const original = LangsysAppAPI.createTranslatableItems.bind(LangsysAppAPI);
    vi.spyOn(LangsysAppAPI, 'createTranslatableItems').mockImplementation(async (items: unknown) => {
        for (const item of items as Array<{ custom_id?: string; phrase?: string }>)
            sent.push(item.custom_id ?? item.phrase ?? '?');
        return original(items as never);
    });
    t.subscribe(() => void tChanges++);
    tChanges = 0;

    // The page mounts as init() starts: the app does not wait for it.
    const el = document.createElement('div');
    document.body.appendChild(el);
    createApp(defineComponent({ render: () => h('main', [Block('Page load'), Block('Twice'), Block('Twice')]) })).mount(
        el
    );
    void LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es');
    await until(async () => (await fx.state()).projects.p1.blocks.length >= 2);
    await sleep(1_500);
});
afterAll(async () => {
    await fx.stop();
});

const blockIds = async () => (await fx.state()).projects.p1.blocks.map((b) => b.custom_id);

describe('REG-7: one registration request per block in flight, through <Translate>', () => {
    it('control: the page load changed t at least twice, so each block reached registration again', () => {
        expect(tChanges).toBeGreaterThanOrEqual(2);
    });

    it('a block mounted as init() starts is sent once', async () => {
        const ids = await blockIds();
        expect(ids).toHaveLength(2);
        const counts = Object.fromEntries(ids.map((id) => [id, sent.filter((s) => s === id).length]));
        expect(Object.values(counts), JSON.stringify(counts)).toEqual([1, 1]);
    });

    it('two mounts of the same content are one block, sent once', async () => {
        expect(sent.length, JSON.stringify(sent)).toBe(2);
    });
});
