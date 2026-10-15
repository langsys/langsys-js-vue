// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { sleep, startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Phrase, Translate, useT } from './index.js';

/**
 * A write session on the base locale registers what it shows, and the visitor switches language,
 * through the store handed to `init()`, while those registrations are unanswered: each request
 * answers only after 800ms, as on a slow network. By then a translator has translated the
 * content, so the switched catalog arrives with it. A registration answered afterwards marks only
 * what that catalog does not already hold, so `<Translate>`, `<Phrase>` and `useT()` show the
 * translation. Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
let el: HTMLElement;
let blockId: string;
/** Each registration request: what it carried, and the locale loaded when it was sent and when it was answered. */
const requests: Array<{ items: string[]; sentIn: string; answeredIn?: string }> = [];

const Greeting = defineComponent({
    setup() {
        const t = useT();
        return () => h('em', t.value('Good to see you', 'UI') as string);
    },
});

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    const store = createLocaleStore('en');
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: store,
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'en');

    const real = globalThis.fetch;
    vi.stubGlobal('fetch', async (url: string, init?: RequestInit) => {
        if (!String(url).includes('/translatable-items')) return real(url, init);
        const body = JSON.parse(String(init?.body ?? '{}')) as {
            translatable_items?: Array<{ custom_id?: string; phrase?: string }>;
        };
        const request = {
            items: (body.translatable_items ?? []).map((i) => i.custom_id ?? i.phrase ?? '?'),
            sentIn: currentlyLoadedLocale.get(),
            answeredIn: undefined as string | undefined,
        };
        requests.push(request);
        await sleep(800);
        const answer = await real(url, init);
        request.answeredIn = currentlyLoadedLocale.get();
        return answer;
    });

    el = document.createElement('div');
    document.body.appendChild(el);
    createApp(
        defineComponent({
            render: () =>
                h('main', [
                    h(Translate, { category: 'UI' }, () => [h('p', 'A caption'), h('p', 'Under the photo')]),
                    h('div', [h(Phrase, { category: 'UI' }, () => ['Welcome ', h('b', 'back')])]),
                    h(Greeting),
                ]),
        })
    ).mount(el);
    await until(() => requests.length >= 1);
    await sleep(500);

    // The content as a translator has left it by the time the visitor switches language.
    blockId = el.querySelector('translate')!.getAttribute('data-ls-contentblock')!;
    await fx.seed({
        ...SEED,
        projects: [
            {
                ...SEED.projects[0]!,
                phrases: [
                    {
                        category: 'UI',
                        phrase: 'Welcome {m0o}back{m0c}',
                        translations: { 'es-es': 'Bienvenido {m0o}de nuevo{m0c}' },
                    },
                    { category: 'UI', phrase: 'Good to see you', translations: { 'es-es': 'Me alegra verte' } },
                ],
                blocks: [
                    {
                        category: 'UI',
                        custom_id: blockId,
                        phrases: [
                            { phrase: 'A caption', translations: { 'es-es': 'Un pie de foto' } },
                            { phrase: 'Under the photo', translations: { 'es-es': 'Bajo la foto' } },
                        ],
                    },
                ],
            },
        ],
    });
    store.set('es-es');
    await until(() => currentlyLoadedLocale.get() === 'es-es');
    await sleep(1_500);
});
afterAll(async () => {
    vi.unstubAllGlobals();
    await fx.stop();
});

describe('a registration answered after a locale switch keeps the switched catalog', () => {
    it('control: the block and the phrase were sent on the base locale and answered after the switched catalog loaded', () => {
        const inFlight = requests.filter((r) => r.sentIn === 'en' && r.answeredIn === 'es-es');
        const items = inFlight.flatMap((r) => r.items);
        expect(items, JSON.stringify(requests)).toContain(blockId);
        expect(items, JSON.stringify(requests)).toContain('Welcome {m0o}back{m0c}');
    });

    it('<Translate> shows the switched catalog’s translation', () => {
        expect(el.querySelector('translate')?.textContent).toBe('Un pie de fotoBajo la foto');
    });

    it('<Phrase> and useT() show the switched catalog’s translations', () => {
        expect(el.querySelector('[data-ls-phrase]')?.innerHTML).toBe('Bienvenido <b>de nuevo</b>');
        expect(el.querySelector('em')?.textContent).toBe('Me alegra verte');
    });
});
