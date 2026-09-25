// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { LangsysApp, useT } from './index.js';

/**
 * SNAP-2 and SNAP-3 through this binding.
 *
 * Loading a snapshot is the core's `LangsysApp.loadSnapshot(snapshot, locale?)`, synchronous,
 * with refusals thrown as `SnapshotError` naming a reason. This binding's part is forwarding it
 * unchanged: the snapshot reaches the core as given, a component mounted after the call renders
 * its translations with no network request, and a refusal reaches the caller with its reason.
 * The documents are the shared `snapshot-vectors.json` (vendored byte-exact from
 * langsys-js-typescript, blob 594bd77a).
 */

interface Vectors {
    loads: Array<{
        id: string;
        document: unknown;
        locale: string;
        expect_catalog: Record<string, Record<string, string>>;
    }>;
    refusals: Array<{ id: string; document: unknown; refuse: string }>;
}
const VECTORS = JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/snapshot-vectors.json'), 'utf8')) as Vectors;
const LOAD = VECTORS.loads[0];

const core = LangsysApp as unknown as {
    loadSnapshot(snapshot: unknown, locale?: string): boolean;
    seedCatalog(catalog: object, locale: string): void;
};

const fetchSpy = vi.fn(async () => {
    throw new Error('no network in this file');
});
const cleanups: Array<() => void> = [];

beforeEach(() => {
    vi.stubGlobal('fetch', fetchSpy);
    fetchSpy.mockClear();
    core.seedCatalog({ __uncategorized__: {} }, 'en');
});
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    vi.unstubAllGlobals();
});

/** Mount a component that renders one phrase through useT(), and return its text. */
function rendered(phrase: string, category: string): string | null {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(
        defineComponent({
            setup() {
                const t = useT();
                return () => h('span', t.value(phrase, category) as string);
            },
        })
    );
    app.mount(el);
    cleanups.push(() => {
        app.unmount();
        el.remove();
    });
    return el.textContent;
}

describe('SNAP-2 — a snapshot loads through the binding', () => {
    const [category, entries] = Object.entries(LOAD.expect_catalog)[0];
    const [key, translation] = Object.entries(entries).find(([k, v]) => k !== v)!;

    it('control: before loading, the phrase renders as source', () => {
        expect(rendered(key, category)).toBe(key);
    });

    it('loads synchronously and a component mounted after it renders the translation, with no request', () => {
        expect(core.loadSnapshot(LOAD.document, LOAD.locale)).toBe(true);
        expect(rendered(key, category)).toBe(translation);
        expect(fetchSpy).not.toHaveBeenCalled();
    });

    it('a destructured loadSnapshot works the same way', () => {
        const { loadSnapshot } = core;
        expect(loadSnapshot(LOAD.document, LOAD.locale)).toBe(true);
        expect(rendered(key, category)).toBe(translation);
    });

    it('a JSON string is handed through as given', () => {
        expect(core.loadSnapshot(JSON.stringify(LOAD.document), LOAD.locale)).toBe(true);
        expect(rendered(key, category)).toBe(translation);
    });
});

describe('SNAP-3 — a refused snapshot reaches the caller with its reason', () => {
    it.each(VECTORS.refusals.map((r) => [r.id, r] as const))('%s', (_id, r) => {
        let caught: unknown;
        try {
            core.loadSnapshot(r.document, 'en');
        } catch (e) {
            caught = e;
        }
        expect((caught as { name?: string })?.name).toBe('SnapshotError');
        expect((caught as { reason?: string }).reason).toBe(r.refuse);
    });
});
