import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp } from './index.js';

/**
 * MIG — this binding passes the legacy-key configuration to the core untouched.
 *
 * The legacy-key mode is the core's (MIG-1..8). This binding's only part is that `legacyKeys`,
 * with each file's `format` and `namespace`, reaches the core through the `init` override
 * exactly as the app wrote it. Proven by what `t()` then renders, not by inspecting the
 * config: a key resolves to its source value, and a vue-i18n pipe plural renders as a plural,
 * which it does only if `format: 'vue-i18n'` arrived — under the default `plain` format the
 * pipes stay literal. The files are the shared `mig-vectors.json` resolution cases
 * `vue-file-plural` and a plain key beside it.
 *
 * Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-public', project: 'p1', type: 'ip_write', report_discovered_content: false }],
};

const legacyKeys = [
    { name: 'en.json', format: 'vue-i18n', data: { cart: { count: 'no items | one item | {count} items' } } },
    { name: 'checkout.json', namespace: 'checkout', data: { submit: 'Place order' } },
];

let fx: ContractFixture;
const t = (phrase: string, params?: Record<string, unknown>) =>
    (LangsysApp.t as unknown as (p: string, params?: Record<string, unknown>) => string)(phrase, params);

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-public',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
        legacyKeys,
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
});
afterAll(async () => {
    await fx.stop();
});

describe('MIG — legacyKeys reach the core through the init override', () => {
    it('a key resolves to its source value', () => {
        expect(t('checkout.submit')).toBe('Place order');
    });

    it("the file's format arrives: a vue-i18n pipe plural renders by count", () => {
        expect(t('cart.count', { count: 0 })).toBe('no items');
        expect(t('cart.count', { count: 1 })).toBe('one item');
        expect(t('cart.count', { count: 3 })).toBe('3 items');
    });

    it('control: text that is not a key is literal source', () => {
        expect(t('Not a key')).toBe('Not a key');
    });
});
