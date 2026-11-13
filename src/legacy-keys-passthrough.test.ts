import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { STUB_API_URL, stubApi, type StubbedApi } from '../test/helpers/stub-api.js';
import { until } from '../test/helpers/wait.js';
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
 * What `t()` renders is decided in-process, so the API's transport is a stand-in (`stub-api.ts`):
 * nothing here asserts on what a server answered. Its own file: a second `init()` in one process
 * is a no-op.
 */

const legacyKeys = [
    { name: 'en.json', format: 'vue-i18n', data: { cart: { count: 'no items | one item | {count} items' } } },
    { name: 'checkout.json', namespace: 'checkout', data: { submit: 'Place order' } },
];

let api: StubbedApi;
const t = (phrase: string, params?: Record<string, unknown>) =>
    (LangsysApp.t as unknown as (p: string, params?: Record<string, unknown>) => string)(phrase, params);

beforeAll(async () => {
    api = stubApi({ writeEnabled: false });
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'legacy-project',
        key: 'legacy-key',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: STUB_API_URL,
        legacyKeys,
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
});
afterAll(() => {
    api.restore();
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
