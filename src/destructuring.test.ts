import { describe, expect, it } from 'vitest';
import { LangsysApp as coreLangsysApp } from 'langsys-js-typescript';
import { ref } from 'vue';
import { LangsysApp } from './index.js';

/**
 * A member taken off `LangsysApp` must stay callable on its own.
 *
 * ## The regression this pins
 *
 * `0.2.1` — the last published release — exported a hand-written wrapper class
 * whose methods delegated in their own bodies (`m() { return _LangsysApp.m() }`).
 * Those bodies never read `this`, so this worked for consumers:
 *
 *     const { getCountries } = LangsysApp;
 *     await getCountries();
 *
 * Replacing the wrapper with a proxy that forwarded members **unbound** broke
 * exactly that line. An unbound forward hands back the core's own function, so
 * calling it detached leaves `this === undefined` and the core throws
 * `Cannot read properties of undefined (reading 'resolveLocale')` on its first
 * internal hop. Measured against both builds before this test existed:
 * `0.2.1` OK, unbound proxy throws, and a non-destructured call works on both.
 *
 * ## Why binding is the right answer here, specifically
 *
 * The argument for unbound was that binding makes a destructured method work
 * here while the same destructure off the core singleton throws — a divergence
 * BIND-1 forbids a binding from introducing. But **this package already shipped
 * that divergence**: the `0.2.1` wrapper had it by construction. So unbound did
 * not preserve a property we had; it removed one, from consumers who already had
 * it. BIND-1 forbids *widening* what the core offers, not keeping what the
 * binding itself already shipped. (Fleet ruling, topic `838-bind6-v2-vue`;
 * Svelte already binds, and Solid takes the same ruling from the same
 * measurement.)
 *
 * Binding also settles the proxy's `this` question from the other side: a bound
 * forward runs with the core instance as its receiver whatever the call site
 * looks like, so correctness no longer rests solely on the core having no
 * `#private` fields. That invariant is still pinned in `surface.test.ts` — two
 * guarantees from two directions, rather than one load-bearing assumption.
 */

describe('destructured members stay callable — the 0.2.1 shape', () => {
    it('control: the members exist and are functions before anything is detached', () => {
        // If this failed, everything below would be asserting about `undefined`.
        expect(typeof LangsysApp.getCountries).toBe('function');
        expect(typeof LangsysApp.detectPreferredLocale).toBe('function');
    });

    it('a detached synchronous member runs and returns the core answer', () => {
        // `detectPreferredLocale` hops through the core's own helpers via `this`,
        // so it is the sharpest probe: an unbound forward throws here rather than
        // returning something subtly wrong.
        const { detectPreferredLocale } = LangsysApp;

        expect(() => detectPreferredLocale('en-US,en;q=0.9')).not.toThrow();
        expect(detectPreferredLocale('en-US,en;q=0.9')).toBe(coreLangsysApp.detectPreferredLocale('en-US,en;q=0.9'));
    });

    it('a detached async member reaches the core rather than throwing on `this`', async () => {
        const capture = async (fn: () => unknown): Promise<string> => {
            try {
                await fn();
                return '';
            } catch (e) {
                return String(e);
            }
        };

        // Positive control FIRST: the core's own function, detached, must fail in
        // exactly the way this test is looking for. Without it, the assertion
        // below would pass just as happily against a matcher that never fires.
        const rawDetached = coreLangsysApp.getCountries;
        expect(await capture(() => rawDetached()), 'the control did not reproduce the `this` failure').toMatch(
            /Cannot read properties of undefined/
        );

        // The real assertion: the same shape through this binding does not.
        // A network failure offline is fine and is not what this asserts.
        const { getCountries } = LangsysApp;
        expect(await capture(() => getCountries())).not.toMatch(/Cannot read properties of undefined/);
    });

    it('detaching an adapted member keeps the adaptation', async () => {
        // `setWriteGrant` is one of the two overrides. Detached, it must still be
        // the Vue-flavored one — otherwise binding would have quietly handed back
        // the core's, losing Ref support at exactly the call site most likely to
        // destructure.
        const { setWriteGrant } = LangsysApp;
        expect(typeof setWriteGrant).toBe('function');

        // `not.toBe(core.setWriteGrant)` would NOT prove this: a bound forward of
        // the core's own method is also `!==` it. The override keeps its own
        // name, while a forward would be renamed `bound setWriteGrant` — so the
        // name is what actually separates the two.
        expect((setWriteGrant as { name: string }).name).toBe('setWriteGrant');

        // And the behaviour that name is standing in for: a Vue Ref must reach
        // the core as a PROVIDER FUNCTION reading the live value, never as the
        // Ref object itself.
        const proto = Object.getPrototypeOf(coreLangsysApp) as Record<string, unknown>;
        const original = proto.setWriteGrant as (...a: unknown[]) => unknown;
        let received: unknown;
        proto.setWriteGrant = function (this: unknown, grant: unknown) {
            received = grant;
            return Promise.resolve();
        };
        try {
            const grantRef = ref<string | null>('first');
            await setWriteGrant(grantRef);
            expect(typeof received, 'a Ref must be adapted, not passed through').toBe('function');
            expect((received as () => unknown)()).toBe('first');
            grantRef.value = 'rotated';
            expect((received as () => unknown)(), 'the provider must read live, not snapshot').toBe('rotated');
        } finally {
            proto.setWriteGrant = original;
        }
    });

    it('a member read twice is stable, so a detached copy is not a moving target', () => {
        // Consumers destructure once and hold the result. If each property read
        // minted a fresh function, `LangsysApp.foo !== LangsysApp.foo` would make
        // any identity-based memoization on the consumer's side silently churn.
        expect(LangsysApp.getCountries).toBe(LangsysApp.getCountries);
    });
});
