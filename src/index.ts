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
 * Vue-flavored `LangsysApp` type: the core singleton's surface, with the two
 * members this binding adapts re-typed to accept Vue shapes.
 */
export type LangsysAppVue = Omit<typeof _LangsysApp, 'init' | 'setWriteGrant'> & {
    /** Initialize Langsys. Pass a `Signal<string>` (from `createLocaleStore`) as `UserLocaleStore`. */
    init(config: iLangsysInitConfig): Promise<iLangsysResponse>;
    /**
     * Supply or replace the write grant after `init()` — the login-walled case,
     * where the token only exists once the user has authenticated.
     *
     * Re-authorizes so the server re-evaluates the session with the new
     * `X-Write-Grant` header, then applies the returned `write_enabled` (GRANT-3).
     * Await it if you need to know the session flipped.
     */
    setWriteGrant(grant: WriteGrantSource | undefined): Promise<void>;
};

/**
 * The two members this binding adapts, and nothing else. Both exist for a
 * stated reason: `init` widens `UserLocaleStore` and `writeGrant` to Vue
 * shapes, and `setWriteGrant` accepts a Vue `Ref`. Neither changes meaning —
 * the decisions stay the core's (BIND-1, BIND-2).
 */
const overrides = {
    init(config: iLangsysInitConfig): Promise<iLangsysResponse> {
        return _LangsysApp.init({
            ...config,
            writeGrant: refToWriteGrant(config.writeGrant),
        });
    },
    setWriteGrant(grant: WriteGrantSource | undefined): Promise<void> {
        return _LangsysApp.setWriteGrant(refToWriteGrant(grant));
    },
} as const;

/**
 * Vue SDK entry point — the base SDK's singleton, forwarded **by reference**,
 * with the two narrow overrides above.
 *
 * ## Why a proxy and not a wrapper class
 *
 * This was a hand-written class enumerating one delegating method per core
 * method. That shape has a failure mode with no symptom: **every method the
 * core adds after the class is written silently disappears from this binding**,
 * with a green typecheck and a green suite, because nothing references what is
 * missing.
 *
 * It had already happened five times when the 838 audit found it —
 * `applyAuthorization`, `getUserLanguagePreferences`, `parseAcceptLanguageHeader`,
 * `findBestLocaleMatch` and `resolveLocale` were all on the core and simply not
 * on the list. Adding them by hand would have fixed the symptom and left the
 * mechanism running for the next core release to trip over.
 *
 * Forwarding by reference is what BIND-6 actually asks for — "re-export by
 * reference everything that does not need adapting" — and it makes this binding
 * excludable from an investigation in one sentence: everything but `init` and
 * `setWriteGrant` *is* the core, not a copy of it. `src/surface.test.ts` guards
 * the structure rather than any method name, so a future core addition cannot
 * go missing quietly again.
 *
 * Forwarded members are returned **unbound**, so `LangsysApp.foo` and the core's
 * `foo` are the same function object. Calling through the proxy sets `this` to
 * the proxy, whose every read forwards to the core singleton, so the method sees
 * the core's state either way. Binding instead would make a destructured method
 * keep working here while the identical destructure off the core singleton
 * breaks — a behaviour difference, which is exactly what BIND-1 forbids a
 * binding from introducing.
 *
 * Safe because the core class uses no `#private` fields: those cannot be read
 * through a proxy receiver and would force binding, and with it that divergence.
 * `src/surface.test.ts` pins that assumption both structurally and by calling
 * through the proxy, so it stops being true loudly rather than silently.
 */
export const LangsysApp: LangsysAppVue = new Proxy(_LangsysApp, {
    get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
            return overrides[prop as keyof typeof overrides];
        }
        // `target` as the receiver, so getters read the core's own state.
        return Reflect.get(target, prop, target);
    },
}) as unknown as LangsysAppVue;

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
