import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { startContractFixture, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, LangsysApp, useT } from './index.js';
import { createRequestScope, installRequestScopes, provideRequestScope } from './server.js';

/**
 * SRV-1 and SRV-3 through this binding's wiring, against the contract double, in a process with
 * no `window`, as a server runs.
 *
 * The session may write and renders with `ssrTokenStrategy: 'server'`, so a scope's misses are
 * sent when it closes after the response, and the double stores them. Each request's scope
 * fetches its own locale's catalog from the double.
 *
 * Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [
        {
            id: 'p1',
            base_locale: 'en',
            target_locales: ['it', 'de'],
            website_url: 'https://site.local',
            phrases: [{ category: 'UI', phrase: 'Pricing', translations: { it: 'Prezzi', de: 'Preise' } }],
        },
    ],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
const stored = async () => (await fx.state()).projects.p1.phrases.map((p) => p.phrase);

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
    installRequestScopes();
});
afterAll(async () => {
    await fx.stop();
});

describe('SRV-1 / SRV-3 — a request scope, wired through this binding, against the double', () => {
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

    it("SRV-3: a render's misses are sent when its scope closes after the response, and the double stores them", async () => {
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
