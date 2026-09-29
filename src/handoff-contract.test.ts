// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, LangsysAppAPI, Translate } from './index.js';
import { createRequestScope, installRequestScopes } from './server.js';

/**
 * SRV-4 with SRV-3: the server-to-client hand-off, `LangsysApp.seedCatalog(seed.catalog,
 * seed.locale, seed)`.
 *
 * A write-enabled session renders with `ssrTokenStrategy: 'server'`, so a scope sends the blocks it
 * rendered when it closes and marks them `collected` in its seed. The client then hydrates the
 * served HTML; handed the whole seed, it never sends those blocks again. Sends are counted at the
 * transport seam, since the double stores registrations idempotently and could not show a
 * duplicate. Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
const cleanups: Array<() => void> = [];

const Page = (text: string) =>
    defineComponent({
        render: () =>
            h('main', [h(Translate, { category: 'UI' }, () => [h('p', `${text} one`), h('p', `${text} two`)])]),
    });

/** Serve `page` in a scope, close it, then hydrate on the client; return what the client sent. */
async function serveThenHydrate(
    text: string,
    handSeed: boolean
): Promise<{ serverStored: boolean; clientSent: number }> {
    const scope = await createRequestScope({ locale: 'en' });
    const html = await scope.run(() => renderToString(createSSRApp(Page(text))));
    const seed = scope.seed();
    await scope.close();
    const blockId = Object.keys(seed.blocks)[0]!;
    const serverStored = (await fx.state()).projects.p1.blocks.some((b) => b.custom_id === blockId);

    const sent: string[] = [];
    const original = LangsysAppAPI.createTranslatableItems.bind(LangsysAppAPI);
    const spy = vi.spyOn(LangsysAppAPI, 'createTranslatableItems').mockImplementation(async (items: unknown) => {
        for (const item of items as Array<{ custom_id?: string }>) if (item.custom_id) sent.push(item.custom_id);
        return original(items as never);
    });
    const seedCatalog = LangsysApp.seedCatalog as unknown as (c: object, l: string, s?: object) => void;
    if (handSeed) seedCatalog(seed.catalog, seed.locale, seed);
    else seedCatalog(seed.catalog, seed.locale);
    const el = document.createElement('div');
    el.innerHTML = html;
    document.body.appendChild(el);
    const app = createSSRApp(Page(text));
    app.mount(el);
    cleanups.push(() => {
        app.unmount();
        el.remove();
        spy.mockRestore();
    });
    await vi.advanceTimersByTimeAsync(3_000);
    await new Promise((r) => setTimeout(r, 300));
    return { serverStored, clientSent: sent.filter((id) => id === blockId).length };
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
        ssrTokenStrategy: 'server',
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
    installRequestScopes();
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
    while (cleanups.length) cleanups.pop()!();
});

describe('the hand-off: a block the server collected is never sent again by the client', () => {
    it('handed the whole seed, the client sends nothing for the block the server stored', async () => {
        const { serverStored, clientSent } = await serveThenHydrate('Handed', true);
        expect(serverStored, 'control: the scope sent the block when it closed').toBe(true);
        expect(clientSent).toBe(0);
    });

    it('control: handed only the catalog, the client sends the same block again', async () => {
        const { serverStored, clientSent } = await serveThenHydrate('Unhanded', false);
        expect(serverStored).toBe(true);
        expect(clientSent).toBe(1);
    });
});
