// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { sleep, startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { everyText } from '../test/helpers/contract-held.js';
import seeds from '../test/helpers/contract-seeds/switch-during-registration.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Phrase, Translate, useT } from './index.js';

/**
 * A write session on the base locale registers what it shows, and the visitor switches language,
 * through the store handed to `init()`, while those registrations are unanswered: each request is
 * sent only after 4s, as on a slow network. By then a translator has translated the content, so
 * the switched catalog arrives with it. A registration answered afterwards marks only what that
 * catalog does not already hold, so `<Translate>`, `<Phrase>` and `useT()` show the translation.
 *
 * Run against the API on an SDK test clone (spec CONF-2). The translator's work is the case's own
 * call to the API's registration route, under the project's write key, carrying the translations
 * an import carries (MIG-9): the API stores them as the project's, and the switched catalog serves
 * them. What renders is the API's catalog answer. Its own file: a second `init()` in one process
 * is a no-op.
 */

let fx: ContractFixture;
let w: World;
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
    w = seeds.take('base');
    await fx.use(w);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    const store = createLocaleStore('en');
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-writer'),
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
        await sleep(4_000);
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
    await until(() => requests.length >= 1, 10_000, 50);

    // The content as a translator has left it by the time the visitor switches language, as an
    // import registers it: each phrase with the translations already held for it. The API accepts
    // it before the SDK's own registration is sent.
    blockId = el.querySelector('translate')!.getAttribute('data-ls-contentblock')!;
    const imported = await fx.api('/translatable-items', {
        key: w.key('k-writer'),
        method: 'POST',
        body: {
            project_id: w.project(),
            translatable_items: [
                {
                    type: 'phrase',
                    category: 'UI',
                    phrase: 'Welcome {m0o}back{m0c}',
                    translations: [{ locale: 'es-es', translation: 'Bienvenido {m0o}de nuevo{m0c}' }],
                },
                {
                    type: 'phrase',
                    category: 'UI',
                    phrase: 'Good to see you',
                    translations: [{ locale: 'es-es', translation: 'Me alegra verte' }],
                },
                {
                    type: 'content_block',
                    category: 'UI',
                    custom_id: blockId,
                    content: '<p>A caption</p><p>Under the photo</p>',
                    phrases: [
                        { phrase: 'A caption', translations: [{ locale: 'es-es', translation: 'Un pie de foto' }] },
                        { phrase: 'Under the photo', translations: [{ locale: 'es-es', translation: 'Bajo la foto' }] },
                    ],
                },
            ],
        },
    });
    if (imported.status >= 300)
        throw new Error(`the import answered ${imported.status}: ${JSON.stringify(imported.body)}`);
    expect(
        requests.filter((r) => r.answeredIn !== undefined),
        'the SDK’s registrations are not answered yet'
    ).toEqual([]);
    store.set('es-es');
    await until(() => currentlyLoadedLocale.get() === 'es-es', 10_000, 50);
    // The race this covers: the registrations answered after the switch's catalog loaded.
    await until(() => requests.length > 0 && requests.every((r) => r.answeredIn !== undefined), 30_000, 100);
    await sleep(1_500);
});
afterAll(async () => {
    vi.unstubAllGlobals();
    await fx?.stop();
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

    it('what the page shows is what the API holds: the content and its translations are stored', async () => {
        expect(everyText(await fx.held(w.key('k-writer'), w.project(), 'es-es'))).toEqual(
            expect.arrayContaining(['A caption', 'Under the photo', 'Welcome {m0o}back{m0c}', 'Good to see you'])
        );
    });
});
