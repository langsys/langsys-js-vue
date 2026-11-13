import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { anyPhrase, startContractFixture, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/ssr-scope.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, LangsysApp, useT } from './index.js';
import { createRequestScope, installRequestScopes, provideRequestScope } from './server.js';

/**
 * SRV-1 and SRV-3 through this binding's wiring, against the API on an SDK test clone (spec
 * CONF-2), in a process with no `window`, as a server runs.
 *
 * The session may write and renders with `ssrTokenStrategy: 'server'`, so a scope's misses are
 * sent when it closes after the response, and the API stores them, read back through its catalog.
 * Each request's scope fetches its own locale's catalog from the API.
 *
 * Its own file: a second `init()` in one process is a no-op.
 */

let fx: ContractFixture;
let w: World;
const stored = async () => anyPhrase(await fx.held(w.key('k-writer'), w.project(), 'it'));

const Page = (missing: string) =>
    defineComponent({
        setup() {
            const t = useT();
            return () =>
                h('main', [h('h1', t.value('Pricing', 'UI') as string), h('p', t.value(missing, 'UI') as string)]);
        },
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
        ssrTokenStrategy: 'server',
    });
    installRequestScopes();
});
afterAll(async () => {
    await fx?.stop();
});

describe('SRV-1 / SRV-3 — a request scope, wired through this binding, against the API', () => {
    it('SRV-1: each request serves its own locale from the catalog its scope fetched', async () => {
        const it = await createRequestScope({ locale: 'it' });
        const de = await createRequestScope({ locale: 'de' });
        const [itHtml, deHtml] = await Promise.all([
            it.run(() => renderToString(createSSRApp(Page('Only a miss A')))),
            de.run(() => renderToString(createSSRApp(Page('Only a miss B')))),
        ]);
        expect(itHtml).toContain('<h1>Prezzi</h1>');
        expect(deHtml).toContain('<h1>Preise</h1>');
        // A genuine miss serves the base language.
        expect(itHtml).toContain('<p>Only a miss A</p>');
        await Promise.all([it.close(), de.close()]);
    });

    it("SRV-3: a render's misses are sent when its scope closes after the response, and the API stores them", async () => {
        const scope = await createRequestScope({ locale: 'it' });
        const app = createSSRApp(Page('Missed on the server C'));
        provideRequestScope(app, scope); // the Nuxt path
        await renderToString(app);
        expect(await stored()).not.toContain('Missed on the server C'); // nothing sent during the render
        expect(scope.misses()).toEqual(expect.arrayContaining([{ category: 'UI', phrase: 'Missed on the server C' }]));

        const result = await scope.close();
        expect(result).toMatchObject({ status: true });
        expect(await stored()).toContain('Missed on the server C');
    });
});
