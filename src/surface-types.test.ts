import { describe, expect, it } from 'vitest';
import { LangsysApp } from './index.js';
import type { iLangsysInitConfig as VanillaInitConfig } from 'langsys-js-typescript';
import type { iLangsysInitConfig } from './index.js';

/**
 * BIND-6 v2 (b) — the exported type must expose the core's PUBLIC surface and
 * nothing more.
 *
 * ## Why a type test, when `surface.test.ts` already checks reachability
 *
 * The proxy forwards *uniformly* — it does not enumerate, so it cannot filter,
 * and core-private members are therefore reachable at runtime. That is a
 * property of the mechanism, not an API promise, and the two must not be
 * confused: the runtime file asserts uniform forwarding, and this file asserts
 * that the **type** still refuses to hand a consumer a private member.
 *
 * Without this, "reachable at runtime" would quietly become "part of the API",
 * which is exactly the misreading that produced the wrong `PREVIOUSLY_DROPPED`
 * list in the first place: TypeScript's `private` is erased at runtime, so a
 * prototype walk sees members no consumer is entitled to call.
 *
 * ## How this file fails
 *
 * The assertion is the `@ts-expect-error` directive, and it is checked by
 * `npm run typecheck` (tsc includes `src/**` — this file is not part of the
 * build entry, so it never ships). The directive inverts: if the exported type
 * ever widened to include a core-private member, the marked line would stop
 * erroring and tsc would report **"Unused '@ts-expect-error' directive"**,
 * failing the typecheck. Verified in both directions — see the run notes in
 * CONFORMANCE.md.
 *
 * The runtime `it` blocks below carry the positive controls, so a reader sees
 * the same claim exercised in the suite rather than only in a comment.
 */

// ---------------------------------------------------------------------------
// The assertion: a core-private member must NOT be reachable through the type.
// `resolveLocale` is used only as a witness here; it is not API, and this file
// makes no claim about its continued existence. If the core removes it, replace
// the witness — do not conclude that anything regressed.
// ---------------------------------------------------------------------------
// @ts-expect-error core-private members are excluded from the exported type
void LangsysApp.resolveLocale;

// ---------------------------------------------------------------------------
// Positive control: a PUBLIC member must typecheck. Without this, the directive
// above would pass just as happily against an import that resolved to `any`,
// or to nothing at all.
// ---------------------------------------------------------------------------
const publicMemberTypechecks: () => Promise<unknown> = () => LangsysApp.getCountries();

describe('BIND-6 — the exported type exposes only the core public surface', () => {
    it('control: the module loaded and a public member is callable', () => {
        // If the import were broken, the `@ts-expect-error` above would still be
        // satisfied — by an error about the import rather than about privacy.
        expect(typeof publicMemberTypechecks).toBe('function');
        expect(typeof LangsysApp.getCountries).toBe('function');
    });

    it('control: the two adapted members are present and are ours', () => {
        expect(typeof LangsysApp.init).toBe('function');
        expect(typeof LangsysApp.setWriteGrant).toBe('function');
    });

    it('documents that runtime reachability is not API', () => {
        // Core-private members ARE reachable at runtime — uniform forwarding — and
        // that is deliberate. The type is what draws the API line, which is why
        // the assertion in this file is a compile-time directive rather than a
        // runtime `expect`.
        const reachableAtRuntime = 'resolveLocale' in (LangsysApp as unknown as object);
        expect(reachableAtRuntime).toBe(true);
    });
});

// ---------------------------------------------------------------------------
// BIND-4 — the binding introduces no configuration the core does not define.
//
// Vue's config WIDENS two existing keys (`UserLocaleStore`, `writeGrant`) to accept
// Vue shapes, and that is allowed; adding a key is not. A key only this binding knows
// about is one a plain-JS caller could rely on while every other binding silently drops
// it. Checked by `npm run typecheck`.
// ---------------------------------------------------------------------------
type ExtraKeys<T> = Exclude<keyof T, keyof VanillaInitConfig>;
type NoExtraKeys<T> = [ExtraKeys<T>] extends [never] ? true : false;

/** The assertion. */
const bind4NoExtraKeys: NoExtraKeys<iLangsysInitConfig> = true;

/**
 * Positive control: a config carrying one extra key must fail the same check — without
 * this, the assertion above would pass against a helper that always says `true`.
 */
// The control key must be one the core does NOT define. An earlier revision used `apiUrl`,
// and this control stayed silent — correctly: the core's config gained `apiUrl`, so it was
// never an extra key. The control caught its own bad example, which is its job.
// @ts-expect-error an added key must be detected
const bind4ControlDetectsExtraKey: NoExtraKeys<iLangsysInitConfig & { notACoreConfigKey: string }> = true;

describe('BIND-4 — no configuration the core does not define', () => {
    it('is enforced at compile time; both the assertion and its control are live', () => {
        expect(bind4NoExtraKeys).toBe(true);
        expect(bind4ControlDetectsExtraKey).toBe(true);
    });
});
