import { getCurrentScope, onScopeDispose, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { createSignal, type Signal } from 'langsys-js-typescript';

/**
 * Subscribe the current effect scope to a base-SDK `Signal<T>` and return its
 * value as a read-only shallow ref, updating whenever the signal changes.
 *
 * This is the Vue mirror of Svelte's `$store` auto-subscription and React's
 * `useSignal` (`useSyncExternalStore`). The base SDK's `subscribe` fires
 * synchronously with the current value and returns an unsubscribe function, so
 * the ref is seeded immediately — server-side rendering sees the value the SDK
 * seeded from `initialTranslations` with no flash of untranslated content.
 *
 * `shallowRef` is deliberate: signal payloads (`TFunction`, the catalog) must
 * not be deeply proxied — the signal replaces the whole value on every change,
 * which is exactly what a shallow ref tracks.
 *
 * When called inside a component `setup()` or an `effectScope`, the
 * subscription is disposed with the scope. Outside any scope (module level),
 * the subscription lives for the app's lifetime — fine for the SDK's global
 * singletons, but prefer calling from `setup()`.
 */
export function useSignal<T>(signal: Signal<T>): Readonly<ShallowRef<T>> {
    const value = shallowRef(signal.get()) as ShallowRef<T>;
    const unsubscribe = signal.subscribe((next) => {
        value.value = next;
    });
    if (getCurrentScope()) onScopeDispose(unsubscribe);
    return value;
}

/**
 * Create a reactive `Signal<string>` to hold the user's selected locale — the
 * Vue analog of Svelte's `writable('en-US')`.
 *
 * Pass the result as `UserLocaleStore` to `LangsysApp.init`, read it reactively
 * with `useSignal(store)` (or use the all-in-one `useLocaleStore` composable),
 * and switch locale with `store.set('fr-FR')`. The base SDK only ever reads and
 * subscribes to it — it never writes.
 *
 * Locale identifiers are canonicalized to BCP 47 by the base SDK (v0.3.0+), so
 * `'en-us'` still works on input — but `currentlyLoadedLocale` always emits the
 * canonical form (`'en-US'`), so prefer canonical casing to keep comparisons
 * against it straightforward.
 */
export function createLocaleStore(initial = 'en-US'): Signal<string> {
    return createSignal<string>(initial);
}

/**
 * Adapt an existing Vue `Ref<string>` into the SDK's `Signal<string>` contract
 * — the Vue analog of the Svelte wrapper's `adaptStore(writable)`.
 *
 * Use this when your app already owns the locale in a ref (Pinia state, a
 * composable, Nuxt's `useState`) and you want the SDK to react to it directly:
 *
 *   const locale = ref('en-US');
 *   LangsysApp.init({ ..., UserLocaleStore: refToLocaleSource(locale) });
 *   locale.value = 'fr-FR'; // SDK loads French
 *
 * The watcher uses `flush: 'sync'` to preserve the Signal contract the SDK
 * relies on (synchronous notification, immediate first fire). The returned
 * unsubscriber stops the watcher.
 */
export function refToLocaleSource(localeRef: Ref<string>): Signal<string> {
    return {
        get: () => localeRef.value,
        set: (value) => {
            localeRef.value = value;
        },
        update: (fn) => {
            localeRef.value = fn(localeRef.value);
        },
        subscribe: (run) => {
            const stop = watch(localeRef, (value) => run(value), { flush: 'sync' });
            run(localeRef.value);
            return stop;
        },
    };
}
