// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import {
    anyBlock,
    sleep,
    startContractFixture,
    until,
    type ContractFixture,
} from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/client-registers.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Translate } from './index.js';
import { createRequestScope, installRequestScopes } from './server.js';

/**
 * SRV-7 against the API on an SDK test clone (spec CONF-2): a block the server rendered inside a
 * request scope, which the scope's catalog does not hold, is registered by the client with the
 * markup it was read from, here from the page the client hydrated, and the next catalog read
 * serves it under the id the server rendered.
 *
 * The session may write and renders with the default token strategy, so the scope sends nothing
 * itself: its seed carries the block, with its content, for the client. The served id is the
 * `data-ls-contentblock` the server stamped. Its own file: a second `init()` in one process is a
 * no-op.
 */

let fx: ContractFixture;
let w: World;
const held = () => fx.held(w.key('k-writer'), w.project(), 'es-es');

const Page = defineComponent({
    render: () =>
        h('main', [
            h(Translate, { category: 'UI' }, () => [
                h('p', 'Rendered on the server'),
                h('p', 'Registered by the client'),
            ]),
        ]),
});

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('base');
    await fx.use(w);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-writer'),
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'en', 15_000, 50);
    installRequestScopes();
});
afterAll(async () => {
    await fx?.stop();
});

describe('SRV-7 — a block the server rendered and left to the client', () => {
    it('is registered by the client from the page it hydrated, and the catalog serves it under the id the server rendered', async () => {
        const scope = await createRequestScope({ locale: 'en' });
        const html = await scope.run(() => renderToString(createSSRApp(Page)));
        const seed = scope.seed();
        await scope.close();
        const servedId = /data-ls-contentblock="([^"]+)"/.exec(html)?.[1];
        expect(servedId, 'the server stamped the block').toBeTruthy();
        expect(seed.blocks[servedId!], 'the seed carries the block, not collected').toMatchObject({
            customId: servedId,
        });
        expect(seed.blocks[servedId!]?.collected).toBeFalsy();
        await sleep(2_000);
        expect(anyBlock(await held()), 'the scope sent nothing itself').not.toContain(servedId);

        const seedCatalog = LangsysApp.seedCatalog as unknown as (c: object, l: string, s?: object) => void;
        seedCatalog(seed.catalog, seed.locale, seed);
        const el = document.createElement('div');
        el.innerHTML = html;
        document.body.appendChild(el);
        const app = createSSRApp(Page);
        app.mount(el);

        await until(async () => anyBlock(await held()).includes(servedId!));
        const stored = await fx.storedBlocks(w, w.key('k-writer'), 'es-es');
        expect(stored.find((b) => b.custom_id === servedId)?.content).toBe(
            '<p>Rendered on the server</p><p>Registered by the client</p>'
        );
        app.unmount();
        el.remove();
    });
});
