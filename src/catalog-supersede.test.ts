// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { sleep, startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, LangsysApp, LangsysAppAPI, useCurrentLocale, useT } from './index.js';

/**
 * A locale switch that overtakes an in-flight catalog fetch, through this binding: the locale is
 * driven through the store handed to `init()`, and a mounted component reads `useT()` and
 * `useCurrentLocale()`. The core drops the superseded response, so the page shows, and the browser
 * stores, only the locale the user is on.
 *
 * The double serves every catalog; the first locale's request is held back before it is sent, so
 * the second locale's request reaches the double first. A pair whose fetch failed or was
 * superseded has nothing stored under its key: the browser keeps only catalogs that arrived. Its own file: a second `init()` in one
 * process is a no-op.
 */

const SEED = {
    projects: [
        {
            id: 'p1',
            base_locale: 'en-us',
            target_locales: ['fr-fr', 'de-de', 'it-it', 'pt-pt'],
            website_url: 'https://site.local',
            phrases: [
                {
                    category: 'UI',
                    phrase: 'Hello',
                    translations: { 'fr-fr': 'Bonjour', 'de-de': 'Hallo', 'it-it': 'Ciao', 'pt-pt': 'Olá' },
                },
            ],
        },
    ],
    keys: [{ key: 'k-reader', project: 'p1', type: 'read' }],
};

let fx: ContractFixture;
const store = createLocaleStore('en-us');
const held: Record<string, number> = {};
let el: HTMLElement;

/** What the page shows: the phrase, then the loaded locale. */
const shown = () => el.textContent ?? '';
/** What the browser stores under `locale`'s key, or null when it stores nothing. */
const stored = (locale: string) => window.localStorage.getItem(`langsys:translations:p1:${locale}`);
/** Every catalog the browser has persisted, as one string. */
const persisted = () =>
    Object.keys(window.localStorage)
        .filter((k) => k.startsWith('langsys:translations'))
        .map((k) => `${k}=${window.localStorage.getItem(k)}`)
        .join('\n');

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    const send = LangsysAppAPI.getTranslations.bind(LangsysAppAPI);
    vi.spyOn(LangsysAppAPI, 'getTranslations').mockImplementation(async (locale: string) => {
        if (held[locale]) await sleep(held[locale]);
        return send(locale);
    });
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-reader',
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
    await until(() => shown() === 'Hello|en-us');
});
afterAll(async () => {
    await fx.stop();
});

describe('a switch that overtakes an in-flight catalog fetch', () => {
    it('slow fr overtaken by a de that fails fast: source text under de, nothing stored', async () => {
        await fx.seed({ ...SEED, faults: [{ method: 'GET', path: '/translations', times: 1, status: 500 }] });
        held['fr-fr'] = 400;
        store.set('fr-fr');
        await sleep(30);
        store.set('de-de');
        await sleep(1_200); // fr has landed by now

        expect(shown().split('|')[0]).toBe('Hello');
        expect(shown()).not.toContain('Bonjour');
        expect(shown()).not.toContain('fr-fr');
        expect(persisted()).not.toContain('Bonjour');
        expect(stored('de-de')).toBeNull();
        expect(stored('fr-fr')).toBeNull();
    });

    it('slow it overtaken by a pt that succeeds: Portuguese, and only Portuguese stored', async () => {
        held['it-it'] = 400;
        store.set('it-it');
        await sleep(30);
        store.set('pt-pt');
        await sleep(1_200); // it has landed by now
        await until(() => shown() === 'Olá|pt-pt');

        expect(shown()).toBe('Olá|pt-pt');
        expect(stored('pt-pt')).toContain('Olá');
        expect(stored('it-it')).toBeNull();
        expect(persisted()).not.toContain('Ciao');
    });
});
