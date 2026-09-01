import { describe, expect, it } from 'vitest';
import * as pkg from './index.js';
import * as core from 'langsys-js-typescript';

/**
 * The raw `writeEnabled` signal must NOT be part of this package's public
 * surface. This test fails if someone re-exports it.
 *
 * ## Why it is withheld
 *
 * The core's signal is browser-authoritative: only ever written client-side,
 * `undefined` for the whole of a server render, and concrete some time after the
 * client boots. Reading it during SSR or the hydration pass is exactly the
 * mismatch `useWriteEnabled()` exists to prevent, and the raw signal carries
 * none of that protection. Re-exporting it puts the unguarded value one import
 * away from the guarded one, with nothing at the call site to say which is safe
 * where.
 *
 * Applied as one fleet ruling across this binding and `langsys-js-react`
 * (Reviewer, topic `838-audit-vue`); Svelte and Angular already withheld it.
 * Consumers who genuinely need the unguarded signal import it from
 * `langsys-js-typescript` directly — that escape hatch is why withholding it
 * here costs nothing.
 *
 * ## Why there are two positive controls
 *
 * An absence assertion is worthless on its own: it passes just as happily when
 * the import failed, when the module is empty, or when the core dropped the
 * symbol entirely. Each control rules out one of those, and the assertion only
 * means "deliberately withheld" when both hold:
 *
 *   1. **The core still exports it** — so the absence is this package's choice,
 *      not the core having removed it upstream.
 *   2. **This package loaded and exposes its guarded replacement** — so the
 *      absence is a missing export, not a failed or empty import.
 */

describe('raw writeEnabled is withheld from the public surface', () => {
    // ---- Positive control 1: the thing being withheld still exists upstream ----
    it('control: the core does export writeEnabled', () => {
        expect(
            typeof (core as Record<string, unknown>).writeEnabled,
            'the core no longer exports `writeEnabled` — the absence assertion below would ' +
                'then be vacuous rather than evidence of a deliberate choice'
        ).toBe('object');
    });

    // ---- Positive control 2: this package really loaded, and has the guarded path ----
    it('control: this package loaded and exposes useWriteEnabled', () => {
        expect(
            typeof (pkg as Record<string, unknown>).useWriteEnabled,
            'the package export map failed to load — every absence assertion below would ' + 'pass for the wrong reason'
        ).toBe('function');
    });

    // ---- The assertion those two controls make meaningful ----
    it('does not re-export the raw writeEnabled signal', () => {
        expect(
            'writeEnabled' in pkg,
            'The raw `writeEnabled` signal is re-exported again. It is withheld on purpose: ' +
                'it has no SSR or hydration protection, so exposing it reintroduces the ' +
                'mismatch useWriteEnabled() prevents. Use useWriteEnabled(); consumers who ' +
                'need the unguarded signal import it from langsys-js-typescript directly.'
        ).toBe(false);
    });

    it('still exports the other raw signals, so this is a targeted withholding', () => {
        // If these vanished too, the absence above would be "the barrel is empty",
        // not "this one signal is deliberately withheld".
        for (const kept of ['t', 'currentlyLoadedLocale', 'sTranslations'] as const) {
            expect(kept in pkg, `expected \`${kept}\` to remain exported`).toBe(true);
        }
    });
});
