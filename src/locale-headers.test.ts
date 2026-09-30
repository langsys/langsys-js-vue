import { afterEach, describe, expect, it } from 'vitest';
import { localeHeaders as coreLocaleHeaders } from 'langsys-js-typescript';
import { LangsysApp, localeHeaders } from './index.js';
import { createRequestScope } from './server.js';

/**
 * FRM-6 — the header that asks the app's own API for the user's language. The helper is the core's;
 * this binding re-exports it and forwards `LangsysApp.localeHeaders()` through its proxy.
 */

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);
afterEach(() => seed({ __uncategorized__: {} }, 'en'));

describe('FRM-6 — localeHeaders()', () => {
    it("is the core's own, and LangsysApp forwards it", () => {
        expect(localeHeaders).toBe(coreLocaleHeaders);
        const { localeHeaders: destructured } = LangsysApp;
        seed({ __uncategorized__: {} }, 'en');
        expect(destructured()).toEqual(LangsysApp.localeHeaders());
    });

    it('after switching to es-es, names es-es (control: en before the switch)', () => {
        seed({ __uncategorized__: {} }, 'en');
        expect(localeHeaders()).toEqual({ 'Accept-Language': 'en' });
        seed({ __uncategorized__: {} }, 'es-es');
        expect(localeHeaders()).toEqual({ 'Accept-Language': 'es-es' });
        expect(LangsysApp.localeHeaders()).toEqual({ 'Accept-Language': 'es-es' });
    });

    it("inside a request scope, names the scope's locale, not the process's", async () => {
        seed({ __uncategorized__: {} }, 'es-es');
        const scope = await createRequestScope({ locale: 'it', catalog: { __uncategorized__: {} } as never });
        expect(scope.run(() => localeHeaders())).toEqual({ 'Accept-Language': 'it' });
        expect(localeHeaders()).toEqual({ 'Accept-Language': 'es-es' });
    });
});
