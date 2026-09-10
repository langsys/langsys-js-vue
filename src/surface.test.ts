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
 * _LangsysApp.foo(); }` per core method. Every method the core adds after such a
 * class is written silently vanishes from the binding's surface, with a green
 * typecheck and a green suite, because nothing references what is missing.
 *
 * The fix is structural — forward by reference through a proxy — and this test
 * guards the **structure** rather than any particular method name: every member
 * the core declares public must be reachable, so the next core addition cannot
 * go missing quietly. A test naming today's methods would rot into the same
 * blind spot it exists to close.
 *
 * ## Public vs. core-private, and why this test derives the split
 *
 * An earlier revision of this file hard-coded five names — `applyAuthorization`,
 * `getUserLanguagePreferences`, `parseAcceptLanguageHeader`,
 * `findBestLocaleMatch`, `resolveLocale` — as "methods the enumerating class
 * dropped". **That was wrong.** All five are declared `private` in the core;
 * TypeScript's `private` is erased at runtime, so a prototype walk finds them and
 * a naive reading calls them dropped API. They were never API, the old wrapper
 * dropped **no** public member, and pinning their names here meant a legitimate
 * core refactor — a rename, a `#private`, a move to a module function — would
 * redden this suite for no reason.
 *
 * So the split is **derived from the resolved `.d.ts`**, which is the only
 * artifact that states it: `private name;` for private members, a normal
 * signature for public ones. Nothing below names a private member.
 */

/** Members this binding deliberately overrides — narrow, each for a stated reason. */
const INTENTIONAL_OVERRIDES = new Set([
    'init', // widens UserLocaleStore to a Vue Signal + adapts a Ref writeGrant
    'setWriteGrant', // adapts a Vue Ref into the core's WriteGrant union
]);

const require_ = createRequire(import.meta.url);

function resolvedDtsText(): string {
    const js = require_.resolve('langsys-js-typescript');
    return readFileSync(js.replace(/index\.(m?js)$/, 'index.d.ts'), 'utf8');
}

/**
 * Split the core singleton's runtime members into public and core-private, using
 * the `.d.ts` class body as the authority.
 *
 * Scoped to the class body on purpose: these names also appear in doc comments
 * elsewhere in the file, and matching those would classify by prose.
 */
function classify(dtsText: string) {
    const body = /declare class LangsysAppClass \{([\s\S]*?)\n\}/.exec(dtsText)?.[1];
    if (!body) throw new Error('LangsysAppClass declaration not found in the resolved .d.ts');

    const privateNames = new Set([...body.matchAll(/^\s+private (\w+)[;(:]/gm)].map((m) => m[1]));
    // `get x(): T`, `x(...)`, and `x: T` all read as public; `private x;` already excluded.
    const publicNames = new Set(
        [...body.matchAll(/^\s+(?:get |set )?(\w+)\s*[(<:;]/gm)].map((m) => m[1]).filter((n) => !privateNames.has(n))
    );

    const proto = Object.getPrototypeOf(coreLangsysApp) as object;
    const runtime = Object.getOwnPropertyNames(proto).filter((n) => n !== 'constructor');

    return {
        runtime,
        publicMembers: runtime.filter((n) => publicNames.has(n)),
        privateMembers: runtime.filter((n) => privateNames.has(n)),
        unclassified: runtime.filter((n) => !publicNames.has(n) && !privateNames.has(n)),
    };
}

const asRecord = (o: unknown) => o as unknown as Record<string, unknown>;
const split = classify(resolvedDtsText());

describe('the public/private split is derived, and the derivation works', () => {
    it('classifies every runtime member — nothing falls through', () => {
        // An unclassified member would silently drop out of the coverage below.
        expect(split.unclassified).toEqual([]);
        expect(split.publicMembers.length).toBeGreaterThan(10); // positive control
    });

    it('control: a known-public method lands in the public set', () => {
        expect(split.publicMembers).toContain('getCountries');
    });

    it('control: a getter is public, not misread as private', () => {
        // `get t(): TFunction` — an earlier version of this classifier matched only
        // `name(` and put `t` in the private column, which would have understated
        // the public surface by one.
        expect(split.publicMembers).toContain('t');
    });

    it('control: flipping a member to private in a scratch .d.ts moves it', () => {
        // Without this, the classifier could be matching nothing at all and every
        // "is public" assertion below would be vacuous.
        const scratch = resolvedDtsText().replace(/^(\s+)getCountries\(/m, '$1private getCountries; //');
        const reclassified = classify(scratch);
        expect(reclassified.publicMembers).not.toContain('getCountries');
        expect(reclassified.privateMembers).toContain('getCountries');
    });
});

describe('BIND-6 — the binding forwards the core surface by reference', () => {
    it.each(split.publicMembers)('exposes public core member `%s`', (name) => {
        expect(asRecord(LangsysApp)[name]).toBeDefined();
    });

    it('forwards non-overridden public members by REFERENCE — the same object', () => {
        const forwarded = split.publicMembers.filter((n) => !INTENTIONAL_OVERRIDES.has(n));
        expect(forwarded.length).toBeGreaterThan(0); // positive control

        for (const name of forwarded) {
            // Identity, not equivalence: a re-implementation or a bound copy fails here.
            expect(asRecord(LangsysApp)[name], `\`${name}\` is not the core's own member`).toBe(
                asRecord(coreLangsysApp)[name]
            );
        }
    });

    it('overrides exactly the members it means to, and no more', () => {
        const overridden = split.publicMembers.filter(
            (name) => asRecord(LangsysApp)[name] !== asRecord(coreLangsysApp)[name]
        );
        expect(new Set(overridden)).toEqual(INTENTIONAL_OVERRIDES);
    });

    it('forwards core state properties too, not just prototype members', () => {
        // Own properties on the core singleton; an enumerating wrapper had to
        // re-declare each as a getter.
        expect(LangsysApp.Translations).toBe(coreLangsysApp.Translations);
        expect(LangsysApp.debug).toBe(coreLangsysApp.debug);
    });

    /**
     * Core-private members are forwarded because the proxy forwards *uniformly* —
     * it does not enumerate, so it cannot filter. That is a property of the
     * mechanism, not an API promise: nothing here names them, and the exported
     * type excludes them (see `surface-types.test-d.ts`). If the core renames or
     * removes one, this assertion follows along instead of reddening.
     */
    it('forwards core-private members uniformly — a mechanism property, NOT API', () => {
        expect(split.privateMembers.length).toBeGreaterThan(0); // positive control
        for (const name of split.privateMembers) {
            expect(asRecord(LangsysApp)[name], 'uniform forwarding should not special-case anything').toBe(
                asRecord(coreLangsysApp)[name]
            );
        }
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
 */
describe('proxy precondition — the core uses no #private fields', () => {
    it('structural: no #private field declarations in the resolved core artifact', () => {
        const source = readFileSync(require_.resolve('langsys-js-typescript'), 'utf8');
        // Class-field syntax only: `#name =`, `#name;`, `#name(`. Deliberately not a
        // bare `#`, which matches CSS colors and URL fragments in the core's strings.
        const privateFields = source.match(/(^|[\s;{}])#[A-Za-z_][A-Za-z0-9_]*\s*[=;(]/g) ?? [];
        expect(
            privateFields,
            'The core has grown #private fields. Forwarded members are returned unbound, so ' +
                '`this` is the proxy and those fields are unreachable — read the note above ' +
                'this test before changing the proxy.'
        ).toEqual([]);
    });

    it('structural check has a positive control — the pattern does match real #fields', () => {
        const fixture = 'class X { #count = 0; #tick() { return this.#count; } }';
        expect((fixture.match(/(^|[\s;{}])#[A-Za-z_][A-Za-z0-9_]*\s*[=;(]/g) ?? []).length).toBeGreaterThan(0);
    });

    it('behavioural: a forwarded call through the proxy receiver reads core state correctly', () => {
        // `detectPreferredLocale` routes through the core's own internal helpers via
        // `this`, so it exercises exactly the receiver path a #private field would
        // break — and it returns a value, so a silent no-op would show.
        const viaProxy = LangsysApp.detectPreferredLocale('en-US,en;q=0.9');
        expect(viaProxy).toBe(coreLangsysApp.detectPreferredLocale('en-US,en;q=0.9'));
        expect(viaProxy).toBeTruthy();
    });
});
