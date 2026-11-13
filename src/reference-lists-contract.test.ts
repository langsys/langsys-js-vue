// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import { startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/reference-lists.js';
import type { World } from '../test/helpers/contract-worlds.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp } from './index.js';

/**
 * REF-1's binding clause against the API on an SDK test clone (spec CONF-2): a list call through
 * this binding answers the core's held list with no further request, and the binding sends no
 * request of its own. The six lists are the core's, forwarded by reference (BIND-6).
 *
 * The API answers each request, and the case's crafted lists answer the ones it accepts (the
 * forwarder's reference lists), so each display locale answers a list of its own. A call that must
 * not send is shown by the case's lists changing, so that a read would answer a different list,
 * and the call still answering the one the core holds; the absence of a request is counted at the
 * transport seam beside it. Its own file: a second `init()` in one process is a no-op.
 */

const REFERENCE = {
    locales: ['es-es', 'es-cr', 'en-us', 'de-de'],
    countries: [{ code: 'ES' }, { code: 'CR' }, { code: 'US' }],
    dial_codes: [
        { country_code: 'ES', dial_code: '34' },
        { country_code: 'CR', dial_code: '506' },
    ],
    currencies: [
        { code: 'EUR', name: 'Euro', symbol: '€' },
        { code: 'CRC', name: 'Costa Rican Colón', symbol: '₡' },
    ],
};
/** A second set of tables, so that a read made after the change answers a different list. */
const CHANGED = {
    locales: ['it-it', 'es-es', 'en-us', 'de-de'],
    countries: [{ code: 'IT' }],
    dial_codes: [{ country_code: 'IT', dial_code: '39' }],
    currencies: [{ code: 'CHF', name: 'Swiss Franc', symbol: 'CHF' }],
};

type Call = (locale?: string) => Promise<unknown>;
const LISTS: { name: string; route: string; call: Call }[] = [
    { name: 'getLocales', route: 'locales', call: (l) => LangsysApp.getLocales(l) },
    { name: 'getLocalesFlat', route: 'locales/flat', call: (l) => LangsysApp.getLocalesFlat(l) },
    { name: 'getLocalesData', route: 'locales/data', call: (l) => LangsysApp.getLocalesData(l) },
    { name: 'getCurrencies', route: 'currencies', call: (l) => LangsysApp.getCurrencies(l) },
    { name: 'getCountries', route: 'countries', call: (l) => LangsysApp.getCountries(l) },
    { name: 'getDialCodes', route: 'countries/dial-codes', call: (l) => LangsysApp.getDialCodes(l) },
];

let fx: ContractFixture;
let w: World;

/** WIRE-3's form of a locale code, which every locale form answers its codes in. */
const wire3 = (code: string) => code.replace(/_/g, '-').toLowerCase();
function wire3Codes(list: unknown): unknown {
    if (Array.isArray(list)) return list.map((row) => ({ ...row, code: wire3(row.code) }));
    return Object.fromEntries(
        Object.entries(list as Record<string, unknown>).map(([group, rows]) => [group, wire3Codes(rows)])
    );
}

/** The list the API answers for `locale` right now, read by the test itself under the session's key. */
async function apiList(route: string, locale: string): Promise<unknown> {
    const byLocale = route.startsWith('locales');
    const url = byLocale ? `/${route}?locales%5B%5D=${locale}&append_target_locales=0` : `/${route}/${locale}`;
    const { body } = await fx.api(url, { key: w.key('k-reader') });
    if (!byLocale) return body.data;
    const [, entry] = Object.entries(body.data).find(([k]) => wire3(k) === locale) ?? [];
    return entry === undefined ? undefined : wire3Codes(entry);
}

/** Every request the page sends from here on, at the transport seam. */
function countRequests(): string[] {
    const sent: string[] = [];
    const real = globalThis.fetch;
    vi.spyOn(globalThis, 'fetch').mockImplementation((input, init) => {
        sent.push(String(input instanceof Request ? input.url : input));
        return real(input as string, init);
    });
    return sent;
}

const held = new Map<string, unknown>();

beforeAll(async () => {
    fx = await startContractFixture();
    w = seeds.take('base');
    await fx.use(w, { reference: REFERENCE });
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-reader'),
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en-us',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es', 15_000, 50);
});
afterAll(async () => {
    vi.restoreAllMocks();
    await fx?.stop();
});
afterEach(() => {
    // The transport count of a case ends with it.
    vi.mocked(globalThis.fetch).mockRestore?.();
});

describe('REF-1 — a list call through the binding answers the core’s held list', () => {
    it('each list, called with no locale, answers the API’s list for the current locale', async () => {
        for (const { name, route, call } of LISTS) {
            const answered = await call();
            expect(answered, name).toEqual(await apiList(route, 'es-es'));
            expect(answered, `${name}: control, the list is not empty`).not.toEqual(Array.isArray(answered) ? [] : {});
            held.set(name, answered);
        }
    });

    it('control: once the case’s lists change, the API answers each list differently', async () => {
        await fx.update(w, { reference: CHANGED });
        for (const { name, route } of LISTS) expect(await apiList(route, 'es-es'), name).not.toEqual(held.get(name));
    });

    it('called again through the binding, each list answers what the core holds, and nothing is sent', async () => {
        const sent = countRequests();
        for (const { name, call } of LISTS) {
            expect(await call(), name).toEqual(held.get(name));
            expect(await call('es-es'), `${name}, the locale named`).toEqual(held.get(name));
        }
        // Destructured, as an app holding the method alone calls it.
        const { getCountries, getCurrencies } = LangsysApp;
        expect(await getCountries()).toEqual(held.get('getCountries'));
        expect(await getCurrencies()).toEqual(held.get('getCurrencies'));
        expect(sent).toEqual([]);
    });

    it('control: a call for a display locale the core does not hold sends, and answers the API’s list', async () => {
        for (const { name, route, call } of LISTS) {
            const sent = countRequests();
            const answered = await call('de-de');
            expect(sent.length, `${name} sent its read`).toBeGreaterThan(0);
            expect(answered, name).toEqual(await apiList(route, 'de-de'));
            vi.mocked(globalThis.fetch).mockRestore();
        }
    });
});
