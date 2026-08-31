import { describe, expect, it } from 'vitest';
import { createRequire } from 'node:module';

/**
 * Bench precondition — fail loudly when the resolved core is the wrong one.
 *
 * ## Why this test exists
 *
 * `langsys-js-typescript@0.6.5` on the npm registry and `0.6.5` in the local
 * working copy are **different code under one version string**: the 838 surface
 * (write gating + content discovery) was added on top of the already-published
 * `0.6.5` without a version bump. So no version comparison — not
 * `package.json`, not `npm view`, not the lockfile — can tell the two apart.
 * The published tarball contains zero occurrences of `setWriteGrant`.
 *
 * This repo develops against the local copy through a gitignored
 * `node_modules/langsys-js-typescript` symlink. **Any `npm install` or `npm ci`
 * silently replaces that symlink with the registry tarball** — this is not
 * hypothetical, it happened mid-audit while installing unrelated dev tooling,
 * and every other test in this suite stayed green through it: the tests that
 * touch `writeEnabled` mock it, so they never reach the missing symbols.
 *
 * Green tests beside a red typecheck is the signature of an unpublished
 * dependency, and it is worth exactly one test to turn that into a red suite
 * instead of a silent false green.
 *
 * ## What it asserts
 *
 * Symbols are probed **by identity, never by version string**, against the
 * artifact Node actually resolves. `generateCustomId` is the positive control:
 * it exists in both the published and local builds, so if it is missing the
 * import itself is broken and the other failures would not be evidence of
 * absence.
 *
 * Loaded through `createRequire` rather than a dynamic `import()` on purpose:
 * that reads the **built artifact Node resolves on disk**, bypassing Vite's
 * module graph. Vite does not transform a linked package living outside the
 * project root, and a bundler's view of the dependency is not what this test is
 * asserting about.
 *
 * ## Retiring it
 *
 * Delete this file once the core publishes a tag whose *tarball* answers this
 * probe, and `package.json`'s range is bumped to it. Until then this is the
 * only check in the suite that can tell the two `0.6.5`s apart.
 */

/** Added by the 838 re-land — absent from every published build to date. */
const REQUIRED_838_SYMBOLS = {
    writeEnabled: 'object', // a Signal instance, not a function
    setWriteGrant: 'function',
    autoDiscovery: 'object', // a controller object, not a function
} as const;

/** Present in BOTH the published and local builds — proves the import resolved. */
const POSITIVE_CONTROL = 'generateCustomId';

const PKG = 'langsys-js-typescript';
const require_ = createRequire(import.meta.url);

function resolvedPath(): string {
    return require_.resolve(PKG);
}

function loadArtifact(): Record<string, unknown> {
    return require_(PKG) as Record<string, unknown>;
}

function remedy(where: string): string {
    return [
        '',
        `The resolved ${PKG} is missing the 838 surface.`,
        `Resolved from: ${where}`,
        '',
        'This almost always means `npm ci`/`npm install` replaced the dev symlink',
        'with the registry tarball. The published 0.6.5 and the local 0.6.5 are',
        'different code under the same version string, so nothing in package.json,',
        'the lockfile, or `npm ls` will show it.',
        '',
        'Restore the bench with:',
        '  rm -rf node_modules/langsys-js-typescript',
        '  ln -s ../../langsys-js-typescript node_modules/langsys-js-typescript',
        '',
    ].join('\n');
}

describe('upstream precondition — the resolved core carries the 838 surface', () => {
    it('resolves the package at all', () => {
        expect(() => resolvedPath()).not.toThrow();
    });

    it(`loads (positive control: ${POSITIVE_CONTROL} exists in every build)`, () => {
        // If THIS fails, the load is broken and the absences below prove nothing.
        expect(
            typeof loadArtifact()[POSITIVE_CONTROL],
            'positive control missing — the artifact failed to load, so the 838 ' +
                'assertions below would be meaningless rather than evidence of absence'
        ).toBe('function');
    });

    it.each(Object.entries(REQUIRED_838_SYMBOLS))('exports %s as %s', (symbol, expectedType) => {
        expect(typeof loadArtifact()[symbol], `\`${symbol}\` is absent.${remedy(resolvedPath())}`).toBe(expectedType);
    });
});
