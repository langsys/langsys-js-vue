import { describe, expect, it } from 'vitest';
import { effectScope, ref } from 'vue';
import { createSignal } from 'langsys-js-typescript';
import { createLocaleStore, refToLocaleSource, useSignal } from './adapters.js';

/**
 * Coverage for the runtime glue this package adds: the locale store (input
 * side), the ref→Signal adapter (input side), and the signal→ref bridge
 * (output side). The full reactive read path through real components is
 * exercised by the playground in `example/`.
 */
describe('createLocaleStore', () => {
    it('seeds, reads, updates, and notifies subscribers', () => {
        const store = createLocaleStore('en-US');
        expect(store.get()).toBe('en-US');

        const seen: string[] = [];
        const unsub = store.subscribe((v) => seen.push(v));
        expect(seen).toEqual(['en-US']); // subscribe fires immediately with the current value

        store.set('fr-FR');
        expect(store.get()).toBe('fr-FR');
        expect(seen).toEqual(['en-US', 'fr-FR']);

        unsub();
        store.set('de-DE');
        expect(store.get()).toBe('de-DE');
        expect(seen).toEqual(['en-US', 'fr-FR']); // no notifications after unsubscribe
    });

    it('defaults to en-US', () => {
        expect(createLocaleStore().get()).toBe('en-US');
    });

    it("passes values through verbatim — canonicalization is the base SDK's job", () => {
        // The store is a plain Signal; lowercase input is legal and reaches the
        // SDK as-is, where v0.3.0+ canonicalizes it to BCP 47 ('en-us' → 'en-US').
        const store = createLocaleStore('en-us');
        expect(store.get()).toBe('en-us');
    });
});

describe('useSignal', () => {
    it('seeds synchronously and tracks signal changes', () => {
        const signal = createSignal('a');
        const scope = effectScope();
        const value = scope.run(() => useSignal(signal))!;

        expect(value.value).toBe('a');
        signal.set('b');
        expect(value.value).toBe('b');
        scope.stop();
    });

    it('stops tracking when the owning scope is disposed', () => {
        const signal = createSignal('a');
        const scope = effectScope();
        const value = scope.run(() => useSignal(signal))!;

        scope.stop();
        signal.set('b');
        expect(value.value).toBe('a'); // unsubscribed with the scope
    });

    it('works outside any scope (module-level use), staying subscribed', () => {
        const signal = createSignal(1);
        const value = useSignal(signal);
        signal.set(2);
        expect(value.value).toBe(2);
    });
});

describe('refToLocaleSource', () => {
    it('satisfies the Signal contract over a Vue ref', () => {
        const locale = ref('en-US');
        const source = refToLocaleSource(locale);

        expect(source.get()).toBe('en-US');

        const seen: string[] = [];
        const unsub = source.subscribe((v) => seen.push(v));
        expect(seen).toEqual(['en-US']); // immediate first fire

        locale.value = 'fr-FR'; // ref writes notify synchronously (flush: 'sync')
        expect(seen).toEqual(['en-US', 'fr-FR']);

        source.set('de-DE'); // Signal writes reach the ref
        expect(locale.value).toBe('de-DE');
        expect(seen).toEqual(['en-US', 'fr-FR', 'de-DE']);

        source.update((current) => current.toLowerCase());
        expect(locale.value).toBe('de-de');
        expect(seen).toEqual(['en-US', 'fr-FR', 'de-DE', 'de-de']);

        unsub();
        locale.value = 'it-IT';
        expect(seen).toEqual(['en-US', 'fr-FR', 'de-DE', 'de-de']); // watcher stopped
    });
});
