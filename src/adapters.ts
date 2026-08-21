import { getCurrentScope, isRef, onScopeDispose, shallowRef, watch } from 'vue';
import type { Ref, ShallowRef } from 'vue';
import { createSignal, type Signal, type WriteGrant } from 'langsys-js-typescript';

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

/**
 * The Vue-flavored write grant. Everything the base SDK accepts — a token
 * string, or (preferred) a provider function called fresh for each request —
 * plus a Vue `Ref`, so refreshing the grant is `grantRef.value = next` rather
 * than an imperative call.
 */
export type WriteGrantSource = WriteGrant | Ref<string | null | undefined>;

/**
 * Normalize the Vue grant option down to the base SDK's `WriteGrant` — the
 * write-grant analog of `refToLocaleSource`, and the Vue mirror of the Svelte
 * wrapper's `adaptWriteGrant`.
 *
 * A ref becomes a provider *function*, never a snapshot. The base SDK
 * deliberately resolves the grant per request and caches it nowhere, so reading
 * through on every call is what makes a later `grantRef.value = next` take
 * effect on the very next request instead of the next `init()`. Snapshotting
 * here would look like a working adapter while producing a grant that can never
 * refresh — and since grants are short-lived, it would work in testing and
 * expire in production.
 *
 * Unlike `refToLocaleSource` this deliberately does *not* subscribe. The grant
 * is pulled when a request needs it, so there is nothing to push; reading
 * lazily also keeps a grant ref from being tracked by whatever effect happened
 * to be running at `init()` time.
 *
 * Strings and provider functions pass through by identity — a provider is
 * already the shape the SDK wants, and re-wrapping it would only obscure it.
 */
export function refToWriteGrant(grant: WriteGrantSource | undefined): WriteGrant | undefined {
    if (grant === undefined) return undefined;
    if (isRef(grant)) return () => grant.value;
    return grant;
}
