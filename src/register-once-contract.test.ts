// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import {
    anyBlock,
    startContractFixture,
    sleep,
    until,
    type ContractFixture,
} from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/register-once.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, LangsysAppAPI, t, Translate } from './index.js';

/**
 * REG-7 through this binding: a content block has one registration request in flight. A
 * `<Translate>` registers on mount and again on every `t` change, and a page load changes `t`
 * twice (the catalog publish and the loaded-locale write), so a block mounted as `init()` starts
 * reaches registration three times while its first request may still be unanswered; two mounts of
 * the same content reach it together. Each block is sent once, and the API on an SDK test clone
 * (spec CONF-2) holds both. That a block is never sent again is a clause about what the SDK sends,
 * so it is counted at the transport seam: the API folds a repeat into the block it holds. Its own
 * file: a second `init()` in one process is a no-op.
 */

let fx: ContractFixture;
let w: World;
const sent: string[] = [];
let tChanges = 0;

/** The blocks the API holds for the project, read with its key. */
const blockIds = async () => anyBlock(await fx.held(w.key('k-writer'), w.project(), 'es-es'));

const Block = (text: string) => h(Translate, { category: 'UI' }, () => [h('p', `${text} one`), h('p', `${text} two`)]);

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('base');
    await fx.use(w);
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
        projectid: w.project(),
        key: w.key('k-writer'),
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es');
    await until(async () => (await blockIds()).length >= 2);
    await sleep(3_000);
});
afterAll(async () => {
    await fx?.stop();
});

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
