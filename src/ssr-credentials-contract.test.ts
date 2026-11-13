import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { anyPhrase, startContractFixture, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/ssr-credentials.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, LangsysApp, Translate, useT } from './index.js';
import { createRequestScope, installRequestScopes, provideRequestScope, renderInRequestScope } from './server.js';

/**
 * SRV-2, credentials, through this binding's two server paths, against the API on an SDK test
 * clone (spec CONF-2), in a process with no `window`: a request scope carries its own project id and API key, and its render
 * sends under them. Two scopes in one process never share a credential however they interleave,
 * and a scope given none sends under the module-wide ones. The binding passes the scope's options
 * through unchanged, to `renderInRequestScope` and to the `createRequestScope` the Nuxt path
 * provides.
 *
 * Which key a request carried is a transport fact, read at the fetch seam; what each project stored
 * is read from the API, which refuses a key for another project: each project's catalog with its
 * own key, and its blocks' content as its owner reads them. Its own file: a second `init()` in one
 * process is a no-op.
 */

let fx: ContractFixture;
let w: World;
type Role = 'zero' | 'one' | 'two';
const credentials = (role: Role) => ({ projectid: w.project(role), key: w.key(`key-${role}`) });
const sent: Array<{ locale: string | null; key: string | null; body: string }> = [];
const phrasesOf = async (role: Role) => anyPhrase(await fx.held(w.key(`key-${role}`), w.project(role), 'de')).sort();
const blocksOf = async (role: Role) =>
    (await fx.storedBlocks(w, w.key(`key-${role}`), 'de', role)).map((b) => b.content ?? '');
/** The requests one render made, told apart by its locale or by what it sent. */
const ofRender = (locale: string, text: string) =>
    sent.filter((r) => r.locale === locale || r.body.includes(text) || r.body.includes(`"${locale}"`));
const keysOf = (requests: typeof sent) => [...new Set(requests.map((r) => r.key))];

/** A page with a phrase the catalog holds, a miss, and a block, all of its own. */
const Page = (miss: string) =>
    defineComponent({
        setup() {
            const t = useT();
            return () =>
                h('main', [
                    h('h1', t.value('Hello', 'UI') as string),
                    h('p', t.value(miss, 'UI') as string),
                    h(Translate, { category: 'UI' }, () => [h('p', `${miss} one`), h('p', `${miss} two`)]),
                ]);
        },
    });

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('base');
    await fx.use(w);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: w.project('zero'),
        key: w.key('key-zero'),
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
        ssrTokenStrategy: 'server',
    });
    installRequestScopes();
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation(async (input, init) => {
        const url = new URL(String(input));
        if (url.href.startsWith(fx.baseUrl))
            sent.push({
                locale: url.searchParams.get('locale') ?? url.pathname.split('/').pop() ?? null,
                key: new Headers(init?.headers).get('x-authorization'),
                body: typeof init?.body === 'string' ? init.body : '',
            });
        return real(input, init);
    });
});
afterAll(async () => {
    vi.restoreAllMocks();
    await fx?.stop();
});

describe('SRV-2: a server render sends under its own scope’s credentials', () => {
    it('two concurrent renders, one per server path, each with its own project id and key, never share a credential', async () => {
        sent.length = 0;
        const plain = renderInRequestScope({ locale: 'de', credentials: credentials('one') }, () =>
            renderToString(createSSRApp(Page('Only in one')))
        );
        const nuxt = (async () => {
            const scope = await createRequestScope({ locale: 'it', credentials: credentials('two') });
            const app = createSSRApp(Page('Only in two'));
            provideRequestScope(app, scope); // the Nuxt path
            return { result: await renderToString(app), scope };
        })();
        const [one, two] = await Promise.all([plain, nuxt]);
        expect(one.result).toContain('<h1>Hallo one</h1>');
        expect(two.result).toContain('<h1>Ciao two</h1>');
        expect(await Promise.all([one.scope.close(), two.scope.close()])).toEqual([{ status: true }, { status: true }]);

        const ofOne = ofRender('de', 'Only in one');
        const ofTwo = ofRender('it', 'Only in two');
        expect(ofOne.length, 'control: the first render made requests').toBeGreaterThan(0);
        expect(ofTwo.length, 'control: the second render made requests').toBeGreaterThan(0);
        expect(keysOf(ofOne)).toEqual([w.key('key-one')]);
        expect(keysOf(ofTwo)).toEqual([w.key('key-two')]);
        expect(sent.length, JSON.stringify(sent)).toBe(ofOne.length + ofTwo.length);

        expect(await phrasesOf('one')).toEqual(['Hello', 'Only in one']);
        expect(await phrasesOf('two')).toEqual(['Hello', 'Only in two']);
        expect((await blocksOf('one')).join()).toContain('Only in one one');
        expect((await blocksOf('two')).join()).toContain('Only in two one');
        expect(await phrasesOf('zero')).toEqual(['Hello']);
    });

    it('a scope given no credentials sends under the module-wide ones', async () => {
        sent.length = 0;
        const { result, scope } = await renderInRequestScope({ locale: 'de' }, () =>
            renderToString(createSSRApp(Page('Only in zero')))
        );
        expect(result).toContain('<h1>Hallo zero</h1>');
        expect(await scope.close()).toEqual({ status: true });
        expect(keysOf(sent)).toEqual([w.key('key-zero')]);
        expect(await phrasesOf('zero')).toEqual(['Hello', 'Only in zero']);
    });
});
