import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { LangsysApp as coreLangsysApp } from 'langsys-js-typescript';
import { LangsysApp } from './index.js';

/**
 * BIND-6 — wrap the narrowest surface possible.
 *
 * ## The bug this test exists to prevent
 *
 * This binding used to export a hand-written `LangsysAppVue` class that
 * **enumerated** its delegating methods — one `public foo() { return
 * _LangsysApp.foo(); }` per core method. Every method the core added after that
 * class was written silently vanished from the binding's surface, with a green
 * typecheck and a green suite, because nothing referenced what was missing.
 *
 * It was not hypothetical. Five core methods had already gone missing this way
 * and nobody noticed: `applyAuthorization`, `getUserLanguagePreferences`,
 * `parseAcceptLanguageHeader`, `findBestLocaleMatch` and `resolveLocale`.
 *
 * Adding those five by hand would have fixed the symptom and left the mechanism
 * running. So the fix was structural — forward by reference through a proxy —
 * and this test guards the **structure** rather than any particular method name:
 * it asserts that *every* core method is reachable, so the next core addition
 * cannot go missing quietly. A test naming only today's methods would rot into
 * the same blind spot it exists to close.
 */

/** Members the binding deliberately overrides — narrow, and each for a stated reason. */
const INTENTIONAL_OVERRIDES = new Set([
    'init', // types UserLocaleStore as a Vue Signal + adapts a Ref writeGrant
    'setWriteGrant', // adapts a Vue Ref into the core's WriteGrant union
]);

/** Methods the wrapper class had silently dropped, kept as a named regression guard. */
const PREVIOUSLY_DROPPED = [
    'applyAuthorization',
    'getUserLanguagePreferences',
    'parseAcceptLanguageHeader',
    'findBestLocaleMatch',
    'resolveLocale',
] as const;

function coreMethodNames(): string[] {
    const proto = Object.getPrototypeOf(coreLangsysApp) as object;
    const core = coreLangsysApp as unknown as Record<string, unknown>;
    return Object.getOwnPropertyNames(proto).filter(
        (name) => name !== 'constructor' && typeof core[name] === 'function'
    );
}

const asRecord = (o: unknown) => o as unknown as Record<string, unknown>;

describe('BIND-6 — the binding forwards the core surface by reference', () => {
    it('has a positive control: the core exposes methods to forward', () => {
        // If this were empty, every assertion below would pass vacuously.
        expect(coreMethodNames().length).toBeGreaterThan(10);
    });

    it.each(coreMethodNames())('exposes core method `%s`', (name) => {
        expect(typeof asRecord(LangsysApp)[name]).toBe('function');
    });

    it('forwards non-overridden methods by REFERENCE — the same function object', () => {
        const forwarded = coreMethodNames().filter((n) => !INTENTIONAL_OVERRIDES.has(n));
        expect(forwarded.length).toBeGreaterThan(0); // positive control

        for (const name of forwarded) {
            // Identity, not equivalence: a re-implementation or a bound copy fails here.
            expect(asRecord(LangsysApp)[name], `\`${name}\` is not the core's own function`).toBe(
                asRecord(coreLangsysApp)[name]
            );
        }
    });

    it('overrides exactly the two members it means to, and no more', () => {
        const overridden = coreMethodNames().filter(
            (name) => asRecord(LangsysApp)[name] !== asRecord(coreLangsysApp)[name]
        );
        expect(new Set(overridden)).toEqual(INTENTIONAL_OVERRIDES);
    });

    it.each(PREVIOUSLY_DROPPED)('exposes `%s`, which the enumerating class dropped', (name) => {
        expect(typeof asRecord(LangsysApp)[name]).toBe('function');
    });

    it('forwards core state properties too, not just methods', () => {
        // `Translations` and `debug` are own properties on the core singleton;
        // the enumerating wrapper had to re-declare each as a getter.
        expect(LangsysApp.Translations).toBe(coreLangsysApp.Translations);
        expect(LangsysApp.debug).toBe(coreLangsysApp.debug);
    });
});

/**
 * The proxy's one structural hazard, pinned.
 *
 * Forwarded members are returned **unbound**, so calling `LangsysApp.foo()` sets
 * `this` to the proxy rather than to the core singleton. That is safe only while
 * the core class uses no `#private` fields: those are keyed on the actual
 * instance and cannot be read through a proxy receiver, so a single `#field`
 * added upstream would turn every forwarded call that touches it into a
 * `TypeError` at runtime.
 *
 * Binding the methods instead would dodge that, but would break identity — and
 * with it BIND-6's whole point — so the assumption is pinned rather than
 * engineered around. Both halves matter: the structural check catches a
 * `#field` the moment it appears, and the behavioural check catches the failure
 * it would actually cause.
 */
describe('proxy precondition — the core uses no #private fields', () => {
    it('structural: no #private field declarations in the resolved core artifact', () => {
        const require_ = createRequire(import.meta.url);
        const source = readFileSync(require_.resolve('langsys-js-typescript'), 'utf8');

        // Class-field syntax only: `#name =`, `#name;`, `#name(`. Deliberately not a
        // bare `#`, which matches CSS colors and URL fragments in the core's strings.
        const privateFields = source.match(/(^|[\s;{}])#[A-Za-z_][A-Za-z0-9_]*\s*[=;(]/g) ?? [];

        expect(
            privateFields,
            'The core has grown #private fields. Forwarded methods are returned unbound, ' +
                'so `this` is the proxy and those fields are unreachable — see the note above ' +
                'this test before changing the proxy.'
        ).toEqual([]);
    });

    it('structural check has a positive control — the pattern does match real #fields', () => {
        // Without this, the assertion above would pass just as well against a
        // regex that matches nothing at all.
        const fixture = 'class X { #count = 0; #tick() { return this.#count; } }';
        const hits = fixture.match(/(^|[\s;{}])#[A-Za-z_][A-Za-z0-9_]*\s*[=;(]/g) ?? [];
        expect(hits.length).toBeGreaterThan(0);
    });

    it('behavioural: a forwarded call through the proxy receiver reads core state correctly', () => {
        // `detectPreferredLocale` routes through the core's own internal helpers
        // via `this`, so it exercises exactly the receiver path a #private field
        // would break — and it returns a value, so a silent no-op would show.
        const viaProxy = LangsysApp.detectPreferredLocale('en-US,en;q=0.9');
        const viaCore = coreLangsysApp.detectPreferredLocale('en-US,en;q=0.9');

        expect(viaProxy).toBe(viaCore);
        expect(viaProxy).toBeTruthy();
    });
});
