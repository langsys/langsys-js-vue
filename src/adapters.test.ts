import { describe, expect, it } from 'vitest';
import { computed, customRef, effectScope, isRef, ref, shallowRef } from 'vue';
import { createSignal } from 'langsys-js-typescript';
import { createLocaleStore, refToLocaleSource, refToWriteGrant, useSignal } from './adapters.js';

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

describe('refToWriteGrant', () => {
    it('passes undefined through, so "no grant" stays no grant', () => {
        expect(refToWriteGrant(undefined)).toBeUndefined();
    });

    it('passes a plain token string through unchanged', () => {
        expect(refToWriteGrant('jwt-token')).toBe('jwt-token');
    });

    it('passes a provider function through by identity, not re-wrapped', () => {
        const provider = () => 'from-provider';
        expect(refToWriteGrant(provider)).toBe(provider);
    });

    /**
     * The load-bearing one. A ref must become a PROVIDER, never a snapshot: the
     * base SDK resolves the grant per request and caches it nowhere, so reading
     * through on each call is what makes `grantRef.value = next` take effect on
     * the very next request. Snapshotting would look like a working adapter
     * while producing a grant that can never refresh — and because grants are
     * short-lived, that passes testing and expires in production.
     */
    it('turns a ref into a provider that re-reads on every call', () => {
        const grantRef = ref('first');

        // The failing case first, so the check below is evidence rather than
        // decoration: a snapshotting adapter is frozen at its adapt-time value.
        const snapshotting = (g: typeof grantRef) => (isRef(g) ? g.value : g);
        const snapshot = snapshotting(grantRef);
        grantRef.value = 'second';
        expect(snapshot).toBe('first'); // stale — this is the bug being excluded

        // The passing case: same ref, same mutation, read through on each call.
        grantRef.value = 'first';
        const grant = refToWriteGrant(grantRef);
        expect(typeof grant).toBe('function');
        expect((grant as () => string)()).toBe('first');

        grantRef.value = 'second';
        expect((grant as () => string)()).toBe('second');

        grantRef.value = 'third';
        expect((grant as () => string)()).toBe('third');
    });

    it('accepts a computed or shallowRef, not just a writable ref', () => {
        const base = ref('tok');
        const derived = computed(() => `${base.value}-derived`);
        expect((refToWriteGrant(derived) as () => string)()).toBe('tok-derived');

        base.value = 'next';
        expect((refToWriteGrant(derived) as () => string)()).toBe('next-derived');

        const shallow = shallowRef<string | null>('shallow-tok');
        expect((refToWriteGrant(shallow) as () => string | null)()).toBe('shallow-tok');
    });

    it('propagates a ref holding null/undefined as a valid "no grant yet"', () => {
        const grantRef = ref<string | null | undefined>(undefined);
        const grant = refToWriteGrant(grantRef) as () => string | null | undefined;

        expect(grant()).toBeUndefined();
        grantRef.value = null;
        expect(grant()).toBeNull();
        grantRef.value = 'now-logged-in';
        expect(grant()).toBe('now-logged-in');
    });

    /**
     * The second snapshot shape: reading at adapt time rather than call time.
     * It produces a provider — so the "is it a function" check above passes —
     * but the value inside was captured once, and it also means the grant ref
     * gets tracked by whatever effect happens to be running at `init()`.
     */
    it('does not read the ref eagerly — it is read only when the provider is called', () => {
        let reads = 0;
        let value = 'x';
        const tracked = customRef<string>((track, trigger) => ({
            get() {
                reads++;
                track();
                return value;
            },
            set(v) {
                value = v;
                trigger();
            },
        }));

        // The failing case: an adapter that reads on the way through. It still
        // returns a function, so only the read COUNT distinguishes it.
        const eager = (g: typeof tracked) => {
            const captured = g.value;
            return () => captured;
        };
        eager(tracked);
        expect(reads).toBe(1); // read before anyone asked for the grant

        reads = 0;
        const grant = refToWriteGrant(tracked);
        expect(reads).toBe(0); // nothing read at adapt time

        expect((grant as () => string)()).toBe('x');
        expect(reads).toBe(1); // read exactly once, when the SDK asked

        (grant as () => string)();
        expect(reads).toBe(2); // and again on the next request, never memoized
    });

    it('leaves the returned provider usable outside any reactive scope', () => {
        const grantRef = ref('tok');
        const grant = refToWriteGrant(grantRef) as () => string;
        const scope = effectScope();
        scope.run(() => grant());
        scope.stop();

        // The SDK calls this from request code, long after any scope is gone.
        expect(grant()).toBe('tok');
        grantRef.value = 'rotated';
        expect(grant()).toBe('rotated');
    });
});
