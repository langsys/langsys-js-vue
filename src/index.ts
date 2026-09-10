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
 * **Correction (2026-09-09).** An earlier version of this note claimed the old
 * class had already dropped five core methods. It had not. All five names in
 * that claim are declared `private` in the core, and TypeScript's `private` is
 * erased at runtime — a prototype walk finds them, and reading that as lost API
 * is the mistake. Measured against the core's `.d.ts`, the old wrapper dropped
 * **zero** public members. No defect had shipped.
 *
 * The mechanism is still right, on the risk rather than on a past incident: a
 * hand-written list cannot fail when the core grows a member, because nothing
 * references what is missing. Forwarding removes the failure mode instead of
 * waiting for it.
 *
 * Forwarding by reference is what BIND-6 actually asks for — "re-export by
 * reference everything that does not need adapting" — and it makes this binding
 * excludable from an investigation in one sentence: everything but `init` and
 * `setWriteGrant` *is* the core, not a copy of it. `src/surface.test.ts` guards
 * the structure rather than any method name, so a future core addition cannot
 * go missing quietly again.
 *
 * Forwarded functions are **bound to the core instance** (and cached, so a member
 * read twice is the same object). An earlier revision forwarded them unbound, on
 * the argument that binding would make a destructured method work here while the
 * identical destructure off the core singleton throws — a divergence BIND-1
 * forbids a binding from introducing.
 *
 * That argument was measured and did not hold: **this package already shipped
 * that divergence.** `0.2.1`'s wrapper delegated in its own method bodies, which
 * never read `this`, so `const { getCountries } = LangsysApp` worked for every
 * installed consumer. Unbound forwarding did not preserve a property we had — it
 * removed one. BIND-1 forbids *widening* what the core offers, not keeping what
 * this binding already shipped. (Fleet ruling, topic `838-bind6-v2-vue`.)
 *
 * Binding also settles the receiver question from the other side: `this` inside a
 * forwarded call is the core instance whatever the call site looks like, so
 * correctness no longer rests solely on the core having no `#private` fields.
 * That invariant is still pinned in `src/surface.test.ts` — two guarantees from
 * two directions rather than one load-bearing assumption. `src/destructuring.test.ts`
 * pins the shipped shape itself.
 */
/**
 * Bound-function cache, so a member read twice is the same object.
 *
 * `.bind()` mints a new function on every call, and a proxy `get` trap runs on
 * every property read — so binding naively would make
 * `LangsysApp.getCountries !== LangsysApp.getCountries`. The class this replaced
 * had stable identity for free (methods live on a prototype), and consumers
 * memoize on function identity all the time — a Vue `watch` source, a dependency
 * array, a `Map` key. Re-minting would churn every one of them silently.
 *
 * Keyed on the source function too, not just the property name: if the core ever
 * reassigns a method, the cached bind would otherwise keep calling the old one.
 */
const boundMembers = new Map<PropertyKey, { source: unknown; bound: unknown }>();

/**
 * True when `prop` is a data-property function the core itself declares — a
 * method, not an accessor, and not something inherited from `Object.prototype`.
 *
 * The walk stops before `Object.prototype` deliberately: `toString`,
 * `hasOwnProperty` and friends are not the core's surface, and binding them
 * would hand back wrappers for members this binding has no business adapting.
 */
function isCoreMethod(target: object, prop: PropertyKey): boolean {
    for (let o: object | null = target; o && o !== Object.prototype; o = Object.getPrototypeOf(o) as object | null) {
        const descriptor = Object.getOwnPropertyDescriptor(o, prop);
        if (descriptor) return typeof descriptor.value === 'function' && prop !== 'constructor';
    }
    return false;
}

/**
 * A proxy `get` trap MUST return the exact value of a non-writable,
 * non-configurable own data property — returning a bound wrapper for one throws
 * `TypeError: 'get' on proxy: property … is a read-only and non-configurable
 * data property`.
 *
 * The core has no such property today, so this is a guard against a future one
 * rather than a live fix; without it, a core author freezing a method would
 * break every read through this binding with an error naming the proxy rather
 * than the change that caused it.
 */
function isFrozenOwnProperty(target: object, prop: PropertyKey): boolean {
    const descriptor = Object.getOwnPropertyDescriptor(target, prop);
    return descriptor !== undefined && descriptor.writable === false && descriptor.configurable === false;
}

export const LangsysApp: LangsysAppVue = new Proxy(_LangsysApp, {
    get(target, prop) {
        if (Object.prototype.hasOwnProperty.call(overrides, prop)) {
            return overrides[prop as keyof typeof overrides];
        }
        // `target` as the receiver, so getters read the core's own state.
        const value = Reflect.get(target, prop, target);
        if (typeof value !== 'function') return value;

        // Cache first: a hit skips both checks below, and the source comparison
        // is what keeps a reassigned core method from serving a stale bind.
        const cached = boundMembers.get(prop);
        if (cached && cached.source === value) return cached.bound;

        // Returning a wrapper here would violate a proxy invariant and throw.
        if (isFrozenOwnProperty(target, prop)) return value;

        // Bind METHODS only — never the value an accessor computed.
        //
        // `get t()` returns a fresh `TFunction` closure that already reads state
        // at call time; it needs no receiver. Binding it would wrap a computed
        // value in a new object on every read, and this binding's reactivity
        // depends on `TFunction` identity (a fresh closure per change, a stable
        // reference between changes) — so wrapping it would put a layer between
        // the core's identity signal and anyone comparing against it.
        if (!isCoreMethod(target, prop)) return value;

        const bound = (value as (...args: unknown[]) => unknown).bind(target);
        boundMembers.set(prop, { source: value, bound });
        return bound;
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
