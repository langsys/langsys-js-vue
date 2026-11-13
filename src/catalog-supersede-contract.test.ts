// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { sleep, startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/catalog-supersede.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, LangsysApp, LangsysAppAPI, useCurrentLocale, useT } from './index.js';

/**
 * A locale switch that overtakes an in-flight catalog fetch, through this binding: the locale is
 * driven through the store handed to `init()`, and a mounted component reads `useT()` and
 * `useCurrentLocale()`. The core drops the superseded response, so the page shows, and the browser
 * stores, only the locale the user is on.
 *
 * The API on an SDK test clone (spec CONF-2) serves every catalog; the first locale's request is
 * held back before it is sent, so the second locale's request reaches the API first, and each case
 * reads the page only once the overtaken response has arrived. A pair whose fetch failed or was
 * superseded has nothing stored under its key: the browser keeps only catalogs that arrived. Its
 * own file: a second `init()` in one process is a no-op.
 */

let fx: ContractFixture;
let w: World;
const store = createLocaleStore('en-us');
const held: Record<string, number> = {};
/** The locales whose catalog response has arrived, answered or failed. */
const landed = new Set<string>();
let el: HTMLElement;

/** What the page shows: the phrase, then the loaded locale. */
const shown = () => el.textContent ?? '';
/** What the browser stores under `locale`'s key, or null when it stores nothing. */
const stored = (locale: string) => window.localStorage.getItem(`langsys:translations:${w.project()}:${locale}`);
/** Every catalog the browser has persisted, as one string. */
const persisted = () =>
    Object.keys(window.localStorage)
        .filter((k) => k.startsWith('langsys:translations'))
        .map((k) => `${k}=${window.localStorage.getItem(k)}`)
        .join('\n');

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('base');
    await fx.use(w);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    const send = LangsysAppAPI.getTranslations.bind(LangsysAppAPI);
    vi.spyOn(LangsysAppAPI, 'getTranslations').mockImplementation(async (locale: string) => {
        if (held[locale]) await sleep(held[locale]);
        try {
            return await send(locale);
        } finally {
            landed.add(locale);
        }
    });
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-reader'),
        UserLocaleStore: store,
        baseLocale: 'en-us',
        apiUrl: fx.baseUrl,
    });
    el = document.createElement('div');
    document.body.appendChild(el);
    createApp(
        defineComponent({
            setup() {
                const t = useT();
                const locale = useCurrentLocale();
                return () => h('p', `${t.value('Hello', 'UI') as string}|${locale.value}`);
            },
        })
    ).mount(el);
    await until(() => shown() === 'Hello|en-us', 15_000, 50);
});
afterAll(async () => {
    await fx?.stop();
});

describe('a switch that overtakes an in-flight catalog fetch', () => {
    it('slow fr overtaken by a de that fails fast: source text under de, nothing stored', async () => {
        await fx.update(w, { faults: [{ method: 'GET', path: '/translations', times: 1, status: 500 }] });
        held['fr-fr'] = 1_000;
        store.set('fr-fr');
        await sleep(30);
        store.set('de-de');
        await until(() => landed.has('fr-fr') && landed.has('de-de'), 15_000, 50);
        await sleep(300);

        expect(shown().split('|')[0]).toBe('Hello');
        expect(shown()).not.toContain('Bonjour');
        expect(shown()).not.toContain('fr-fr');
        expect(persisted()).not.toContain('Bonjour');
        expect(stored('de-de')).toBeNull();
        expect(stored('fr-fr')).toBeNull();
    });

    it('slow it overtaken by a pt that succeeds: Portuguese, and only Portuguese stored', async () => {
        held['it-it'] = 1_000;
        store.set('it-it');
        await sleep(30);
        store.set('pt-pt');
        await until(() => landed.has('it-it') && landed.has('pt-pt'), 15_000, 50);
        await until(() => shown() === 'Olá|pt-pt', 15_000, 50);
        await sleep(300);

        expect(shown()).toBe('Olá|pt-pt');
        expect(stored('pt-pt')).toContain('Olá');
        expect(stored('it-it')).toBeNull();
        expect(persisted()).not.toContain('Ciao');
    });
});
