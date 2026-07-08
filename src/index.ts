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
 *   - Raw signals `t` / `currentlyLoadedLocale` / `sTranslations` — re-exported
 *     for advanced/direct subscription outside Vue's reactivity.
 */

import {
    LangsysApp as _LangsysApp,
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

// Reactive primitives (raw signals) — re-exported for advanced/direct
// subscription. `tSignal` is exposed under the friendlier name `t`. In
// components, prefer the composables (`useT`, `useCurrentLocale`, …).
export { currentlyLoadedLocale, createSignal, sTranslations, tSignal as t } from 'langsys-js-typescript';

// Locale canonicalization (BCP 47) — the SDK canonicalizes all locale input
// (v0.3.0+); re-exported so consumers can normalize their own values the same
// way before comparing against `useCurrentLocale()` / `detectPreferredLocale()`.
export { canonicalizeLocale } from 'langsys-js-typescript';

// API client (vanilla — no Vue concerns)
export { LangsysAppAPI } from 'langsys-js-typescript';

// Composables + adapters (the Vue-idiomatic reactive layer)
export { createLocaleStore, refToLocaleSource, useSignal } from './adapters.js';
export { useCurrentLocale, useLocaleStore, useT, useTranslations } from './composables.js';

// Components
export { Translate, type TranslateProps } from './components/Translate.js';
export { Phrase, type PhraseProps } from './components/Phrase.js';
export { DontTranslate, type DontTranslateProps } from './components/DontTranslate.js';

// Type re-exports — these are framework-agnostic, so consumers can rely on them
// directly without reaching into `langsys-js-typescript`.
export type {
    ExtractParamKeys,
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
 * Vue-flavored init config. Identical to the base SDK's config except
 * `UserLocaleStore` is typed as a `Signal<string>` — create one with
 * `createLocaleStore()` (or get one from the `useLocaleStore` composable, or
 * adapt an existing ref with `refToLocaleSource`). The base SDK only reads and
 * subscribes to it.
 */
export interface iLangsysInitConfig extends Omit<iVanillaInitConfig, 'UserLocaleStore'> {
    UserLocaleStore: Signal<string>;
}

/**
 * Vue SDK entry point. Delegates everything to the underlying
 * `langsys-js-typescript` singleton. Because the Vue locale store is already a
 * `Signal` (unlike Svelte's `Writable`, which needs adapting), `init` is a
 * straight passthrough — the Vue-native concerns live in the composables and
 * the `<Translate>` component, not here.
 */
class LangsysAppVue {
    /** Initialize Langsys. Pass a `Signal<string>` (from `createLocaleStore`) as `UserLocaleStore`. */
    public init(config: iLangsysInitConfig): Promise<iLangsysResponse> {
        return _LangsysApp.init(config);
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
