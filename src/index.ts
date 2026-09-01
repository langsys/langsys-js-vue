/**
 * langsys-js-vue — idiomatic Vue 3 binding over `langsys-js-typescript`.
 *
 * Public API:
 *   - `LangsysApp` — `init` accepts a `Signal<string>` (make one with
 *     `createLocaleStore`, or adapt a ref with `refToLocaleSource`) for the
 *     user locale; every other method delegates.
 *   - Composables — `useT`, `useCurrentLocale`, `useTranslations`,
 *     `useLocaleStore`, and the low-level `useSignal`. These are the reactive
 *     layer; in components prefer them over the raw signals.
 *   - `createLocaleStore` — make the user-locale store (Vue analog of Svelte's
 *     `writable`); `refToLocaleSource` — adapt an existing `Ref<string>`.
 *   - `Translate` — Vue component wrapping the vanilla DOM `Translate` class.
 *   - Raw signals `t` / `currentlyLoadedLocale` / `sTranslations` —
 *     re-exported for advanced/direct subscription outside Vue's reactivity.
 *     `writeEnabled` is deliberately NOT among them; see below.
 *   - Write gating — `useWriteEnabled()` (tri-state: `undefined` = not yet
 *     known, and never to be read as `false`), the `writeGrant` init option,
 *     and `setWriteGrant` for the post-login case.
 */

import {
    LangsysApp as _LangsysApp,
    setWriteGrant as _setWriteGrant,
    type WriteGrant,
    type ExtractParamKeys,
    type ParamPrimitive,
    type ParamsFor,
    type Signal,
    type TArgs,
    type TFunction,
    type TranslationParams,
    type iCategories,
    type iContentBlock,
    type iCountry,
    type iCountryDialCode,
    type iCountryList,
    type iCurrency,
    type iCurrencyList,
    type iLangsysInitConfig as iVanillaInitConfig,
    type iLangsysResponse,
    type iLanguageName,
    type iLocaleData,
    type iLocaleDefault,
    type iLocaleFlat,
    type iProject,
    type iTranslations,
} from 'langsys-js-typescript';
import { refToWriteGrant, type WriteGrantSource } from './adapters.js';

// Reactive primitives (raw signals) — re-exported for advanced/direct
// subscription. `tSignal` is exposed under the friendlier name `t`. In
// components, prefer the composables (`useT`, `useCurrentLocale`, …).
export { currentlyLoadedLocale, createSignal, sTranslations, tSignal as t } from 'langsys-js-typescript';

// ---------------------------------------------------------------------------
// `writeEnabled` is DELIBERATELY NOT RE-EXPORTED. Do not add it back.
//
// The core's signal is browser-authoritative: it is only ever written
// client-side and is `undefined` for the whole of a server render. Re-exporting
// it hands consumers a value that is correct to read in exactly one of the
// three contexts they will read it in — reading it during SSR or the hydration
// pass is precisely the mismatch `useWriteEnabled()` exists to prevent, and the
// raw signal carries none of that protection.
//
// Fleet ruling (Reviewer, topic `838-audit-vue`), applied as one decision across
// this binding and langsys-js-react: every binding withholds the raw signal and
// surfaces the guarded composable instead. Svelte and Angular already did.
//
// `useWriteEnabled()` is the supported access path. A consumer who genuinely
// needs the unguarded signal can still import it from `langsys-js-typescript`
// directly — that escape hatch is why withholding it here costs nothing.
//
// The absence is pinned by `src/write-enabled-absence.test.ts`.
// ---------------------------------------------------------------------------

// Locale canonicalization (BCP 47) — the SDK canonicalizes all locale input
// (v0.3.0+); re-exported so consumers can normalize their own values the same
// way before comparing against `useCurrentLocale()` / `detectPreferredLocale()`.
export { canonicalizeLocale } from 'langsys-js-typescript';

// API client (vanilla — no Vue concerns)
export { LangsysAppAPI } from 'langsys-js-typescript';

// Composables + adapters (the Vue-idiomatic reactive layer)
export { createLocaleStore, refToLocaleSource, refToWriteGrant, useSignal } from './adapters.js';
export type { WriteGrantSource } from './adapters.js';
export { useCurrentLocale, useLocaleStore, useT, useTranslations, useWriteEnabled } from './composables.js';

// Components
export { Translate, type TranslateProps } from './components/Translate.js';
export { Phrase, type PhraseProps } from './components/Phrase.js';
export { DontTranslate, type DontTranslateProps } from './components/DontTranslate.js';

// Type re-exports — these are framework-agnostic, so consumers can rely on them
// directly without reaching into `langsys-js-typescript`.
export type {
    ExtractParamKeys,
    WriteGrant,
    ParamPrimitive,
    ParamsFor,
    Signal,
    TArgs,
    TFunction,
    TranslationParams,
    iCategories,
    iContentBlock,
    iCountry,
    iCountryDialCode,
    iCountryList,
    iCurrency,
    iCurrencyList,
    iLangsysResponse,
    iLanguageName,
    iLocaleData,
    iLocaleDefault,
    iLocaleFlat,
    iProject,
    iTranslations,
};

/**
 * Vue-flavored init config. Identical to the base SDK's config except for two
 * fields widened to Vue shapes:
 *
 *   - `UserLocaleStore` is a `Signal<string>` — create one with
 *     `createLocaleStore()` (or get one from the `useLocaleStore` composable,
 *     or adapt an existing ref with `refToLocaleSource`). The base SDK only
 *     reads and subscribes to it.
 *   - `writeGrant` additionally accepts a `Ref<string | null | undefined>`, on
 *     top of the vanilla token string and provider function. **Prefer the
 *     provider function** (or a ref, which becomes one): grants are
 *     short-lived, and a provider is called fresh for each request rather than
 *     expiring mid-session. A bare string is a snapshot and cannot refresh.
 */
export interface iLangsysInitConfig extends Omit<iVanillaInitConfig, 'UserLocaleStore' | 'writeGrant'> {
    UserLocaleStore: Signal<string>;
    writeGrant?: WriteGrantSource;
}

/**
 * Vue SDK entry point. Delegates everything to the underlying
 * `langsys-js-typescript` singleton. Because the Vue locale store is already a
 * `Signal` (unlike Svelte's `Writable`, which needs adapting), `init` is a
 * straight passthrough — the Vue-native concerns live in the composables and
 * the `<Translate>` component, not here.
 */
class LangsysAppVue {
    /**
     * Initialize Langsys. Pass a `Signal<string>` (from `createLocaleStore`) as
     * `UserLocaleStore`.
     *
     * `writeGrant` is normalized on the way through, so a Vue ref becomes a
     * provider the SDK reads per request — see `refToWriteGrant`. Everything
     * else is a straight passthrough.
     */
    public init(config: iLangsysInitConfig): Promise<iLangsysResponse> {
        return _LangsysApp.init({
            ...config,
            writeGrant: refToWriteGrant(config.writeGrant),
        });
    }

    public get Translations() {
        return _LangsysApp.Translations;
    }

    public get translationsLoadingPromise() {
        return _LangsysApp.translationsLoadingPromise;
    }

    /** Current translation function. Reads fresh state on every call (not reactive on its own — use `useT()` in components). */
    public get t(): TFunction {
        return _LangsysApp.t;
    }

    public get debug() {
        return _LangsysApp.debug;
    }

    public refresh() {
        return _LangsysApp.refresh();
    }

    /**
     * Supply or replace the write grant after `init()` — the login-walled case,
     * where the token only exists once the user has authenticated.
     *
     * This re-authorizes so the server re-evaluates the session with the new
     * `X-Write-Grant` header, then applies the returned `write_enabled`. Await
     * it if you need to know the session flipped; misses occurring after it
     * lands register directly, while earlier ones were already reported by the
     * discovery lane.
     *
     * Prefer the function form of `writeGrant` at `init()` where you can — or a
     * ref, which becomes one. The grant is short-lived, and a provider is
     * called fresh for each request rather than expiring mid-session.
     */
    public setWriteGrant(grant: WriteGrantSource | undefined): Promise<void> {
        return _LangsysApp.setWriteGrant(refToWriteGrant(grant));
    }

    public getCountries(inLocale?: string) {
        return _LangsysApp.getCountries(inLocale);
    }
    public getCountryName(forCountryCode: string, inLocale?: string) {
        return _LangsysApp.getCountryName(forCountryCode, inLocale);
    }
    public getCurrencies(inLocale?: string) {
        return _LangsysApp.getCurrencies(inLocale);
    }
    public getCurrencyName(forCurrencyCode: string, inLocale?: string) {
        return _LangsysApp.getCurrencyName(forCurrencyCode, inLocale);
    }
    public getDialCodes(inLocale?: string) {
        return _LangsysApp.getDialCodes(inLocale);
    }

    public getLocales(inLocale?: string) {
        return _LangsysApp.getLocales(inLocale);
    }
    public getLocalesFlat(inLocale?: string) {
        return _LangsysApp.getLocalesFlat(inLocale);
    }
    public getLocalesData(inLocale?: string, forceRefresh?: boolean) {
        return _LangsysApp.getLocalesData(inLocale, forceRefresh);
    }
    public getLocalesFormat(format: '' | 'flat' | 'data' = '', inLocale?: string) {
        return _LangsysApp.getLocalesFormat(format, inLocale);
    }
    public getLocaleName(forLocale: string, shortName?: boolean, inLocale?: string) {
        return _LangsysApp.getLocaleName(forLocale, shortName, inLocale);
    }
    public getLocaleNameWithLookup(forLocale: string, shortName?: boolean, inLocale?: string) {
        return _LangsysApp.getLocaleNameWithLookup(forLocale, shortName, inLocale);
    }

    /** @deprecated use `getLocaleNameWithLookup` or `getLocaleName` */
    public getLanguageName(forLocale: string, shortName?: boolean, inLocale?: string) {
        return _LangsysApp.getLanguageName(forLocale, shortName, inLocale);
    }

    public detectPreferredLocale(acceptLanguageHeader?: string | null, supportedLocales?: string[]) {
        return _LangsysApp.detectPreferredLocale(acceptLanguageHeader, supportedLocales);
    }
}

export const LangsysApp = new LangsysAppVue();

/**
 * Standalone alias for `LangsysApp.setWriteGrant` — for module-scope code that
 * has no reason to reach for the singleton.
 *
 * Vue-flavored like the method: it accepts a ref in addition to the vanilla
 * token string and provider function, and normalizes it the same way. That is a
 * deliberate widening of the base SDK's export rather than a bare re-export —
 * re-exporting the vanilla function would leave two same-named entry points
 * where one silently mishandles a ref, setting the grant to a `Ref` object and
 * sending `[object Object]` as the header.
 */
export function setWriteGrant(grant: WriteGrantSource | undefined): Promise<void> {
    return _setWriteGrant(refToWriteGrant(grant));
}
