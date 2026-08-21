import { currentlyLoadedLocale, sTranslations, tSignal, writeEnabled } from 'langsys-js-typescript';
import type { Signal, TFunction, iCategories } from 'langsys-js-typescript';
import { getCurrentScope, onScopeDispose, shallowRef } from 'vue';
import type { ShallowRef } from 'vue';
import { createLocaleStore, useSignal } from './adapters.js';

/**
 * The current translation function as a reactive ref, updating whenever
 * translations or the loaded locale change. This is the Vue analog of Svelte's
 * `$t` store read and React's `useT()`.
 *
 *   const t = useT();
 *   // template: <h1>{{ t('Welcome to my app', 'UI') }}</h1>   (auto-unwrapped)
 *   // script:   t.value('Welcome to my app', 'UI')
 *
 * The phrase is both the lookup key and the base-language default. Signature:
 * `t(phrase, category?, params?)`. Placeholder names in the phrase are
 * type-checked against the params object at the call site.
 */
export function useT(): Readonly<ShallowRef<TFunction>> {
    return useSignal(tSignal);
}

/**
 * The locale whose translations are currently loaded. This lags the
 * user-selected locale (`UserLocaleStore`) until the fetch for the new locale
 * settles, which makes it the right value to gate "translations are ready" UI on.
 */
export function useCurrentLocale(): Readonly<ShallowRef<string>> {
    return useSignal(currentlyLoadedLocale);
}

/**
 * The raw translation catalog. Rarely needed in app code — prefer `useT()`.
 * Exposed for advanced cases (inspecting which categories/phrases are loaded).
 */
export function useTranslations(): Readonly<ShallowRef<iCategories>> {
    return useSignal(sTranslations);
}

/**
 * All-in-one convenience for the user-locale store. Creates one
 * `Signal<string>` (the Vue analog of Svelte's `writable`), subscribes the
 * current scope to it, and returns `{ locale, setLocale, store }`.
 *
 *   const { locale, setLocale, store } = useLocaleStore('en-US');
 *   onMounted(() => {
 *     LangsysApp.init({ projectid, key, UserLocaleStore: store });
 *   });
 *
 *   // template: <select :value="locale" @change="setLocale($event.target.value)">…
 *
 * `setup()` runs once per component instance, so the store is stable for the
 * component's lifetime and safe to hand to `LangsysApp.init`.
 */
export function useLocaleStore(initial = 'en-US'): {
    locale: Readonly<ShallowRef<string>>;
    setLocale: (locale: string) => void;
    store: Signal<string>;
} {
    const store = createLocaleStore(initial);
    const locale = useSignal(store);
    return { locale, setLocale: store.set, store };
}

/**
 * Flips once the first `useWriteEnabled()` call has handed over to the live
 * signal, after which later calls read straight through.
 *
 * Deliberately keyed on the first CALL, not on module init. Timing from module
 * init is wrong precisely in the case this guard exists for: an awaited Nuxt
 * plugin or `useAsyncData` runs several macrotasks' worth of network work
 * between importing this module and mounting the app, so a timer started at
 * import has long since fired by the time hydration renders — the guard would
 * be off exactly when it was needed. The first call, by contrast, happens
 * *during* the hydration render, so a macrotask scheduled from it lands after
 * hydration completes, whatever delayed the mount.
 */
let pastHydration = false;

/**
 * Whether the current session may register content, as decided by the server.
 *
 * Tri-state, and the three states are genuinely distinct:
 *   - `undefined` — authorization hasn't landed yet. Not the same as read-only.
 *   - `false`     — read-only session; the SDK may report the page URL instead,
 *                   subject to the key's auto-discovery permission. A read-only
 *                   key with discovery disallowed reports nothing at all.
 *   - `true`      — this session registers content directly.
 *
 * **Never default `undefined` to `false`.** The same key can be write-enabled
 * from one IP and read-only from another, so only the server can answer, and
 * "not yet known" is a real state to render for. Telling a write-enabled
 * session it is read-only is a worse failure than an honest "not known yet",
 * and it is unrecoverable without a reload — upstream, `undefined` means "hold
 * these misses" rather than "drop them", so collapsing it silently discards
 * tokens that would otherwise have registered once authorization landed.
 *
 * Unlike the other composables this does *not* simply wrap `useSignal`. The
 * base SDK's `writeEnabled` is browser-authoritative: it is only ever written
 * client-side and stays `undefined` for the whole of a server render. Two
 * consequences shape this composable:
 *
 *   - **Under SSR** it reports `undefined` without subscribing at all. The
 *     signal is a process-wide singleton; subscribing to it from a server
 *     render would outlive the request that created it.
 *   - **During hydration** it publishes `undefined` — the value the server
 *     rendered — and adopts the real one on the next macrotask. In Nuxt,
 *     authorization can resolve *before* the first client render (an awaited
 *     plugin or `useAsyncData` that calls `LangsysApp.init`), so reading
 *     through would render markup disagreeing with the server HTML. This is
 *     the Vue-shaped equivalent of React's pinned `getServerSnapshot` and
 *     Svelte's deferred store; `nextTick()` would not do, because a microtask
 *     still drains inside the hydration pass.
 *
 * The deferral costs one tick on the first call per page load. Components
 * mounting later — client-side navigation, a `v-if` block — read through
 * immediately with no `undefined` flash.
 *
 *   const writeEnabled = useWriteEnabled();
 *   // template: <span v-if="writeEnabled === undefined">Checking…</span>
 *   //           <span v-else-if="writeEnabled">Editing enabled</span>
 *   //           <span v-else>Read-only</span>
 */
export function useWriteEnabled(): Readonly<ShallowRef<boolean | undefined>> {
    // Checked per call rather than latched at module scope: the module is
    // imported once per server process but this question is per-render, and
    // reading it here keeps the answer independent of module load order.
    const isBrowser = typeof window !== 'undefined';

    // Under SSR, report the "unknown" the server should render and skip
    // subscribing a singleton that would outlive this request.
    if (!isBrowser) return shallowRef<boolean | undefined>(undefined);

    // Past hydration there is nothing to protect against — mirror directly so
    // later mounts see the real value at once.
    if (pastHydration) return useSignal(writeEnabled);

    // Hydration pass: publish the same "unknown" the server rendered so the
    // hydrated markup matches, then adopt the real value immediately after.
    const value = shallowRef<boolean | undefined>(undefined);
    let unsubscribe: (() => void) | undefined;
    let cancelled = false;

    const timer = setTimeout(() => {
        if (cancelled) return;
        pastHydration = true;
        unsubscribe = writeEnabled.subscribe((next) => {
            value.value = next;
        });
    }, 0);

    if (getCurrentScope()) {
        onScopeDispose(() => {
            cancelled = true;
            clearTimeout(timer);
            unsubscribe?.();
        });
    }

    return value;
}
