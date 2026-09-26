import { afterEach, describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, useT } from './index.js';

/**
 * SRV-7 (and SRV-2) — server renders for different visitors must not share translation state.
 *
 * The spec's Test: in one process, seed and render `de`, then render `it` through a new scope,
 * and the second render is Italian with no German in its bytes; concurrent `it` and `de`
 * renders each carry only their own locale; rendering both through one shared scope turns the
 * first case red.
 *
 * The request scope is the core's (SRV-7), and it does not exist yet. So this file is written
 * against a small seam interface, with one adapter per way of isolating a render:
 *
 * - `processGlobal` — what this binding can do today: seed the core's process-wide catalog
 *   before each render. The measured state is pinned below: sequential renders are right,
 *   concurrent ones leak.
 * - `sharedScope` — the spec's mutation, one scope for every render. It must fail the
 *   sequential case, which is what proves that case can fail.
 * - `coreScope` — the core's request scope. `null` until the core ships it; filling in this one
 *   adapter turns on the conformance cases.
 */

interface Seam {
    /** Open a scope for one request in `locale`, with the catalog the server holds for it. */
    open(locale: string, catalog: object): unknown;
    /** Render `app` inside `scope` and return the served bytes. */
    render(scope: unknown, app: Component): Promise<string>;
    /** Close `scope` after the response. */
    close(scope: unknown): void;
}

const CATALOGS: Record<string, object> = {
    de: { __uncategorized__: {}, UI: { Pricing: 'Preise' } },
    it: { __uncategorized__: {}, UI: { Pricing: 'Prezzi' } },
};
const EXPECTED: Record<string, string> = { de: 'Preise', it: 'Prezzi' };

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);

const processGlobal: Seam = {
    open: (locale, catalog) => ({ locale, catalog }),
    async render(scope, app) {
        const { locale, catalog } = scope as { locale: string; catalog: object };
        seed(catalog, locale);
        return renderToString(createSSRApp(app));
    },
    close() {},
};

/** The mutation: the first scope opened is the one every render uses. */
function sharedScope(): Seam {
    let only: unknown;
    return {
        open: (locale, catalog) => (only ??= processGlobal.open(locale, catalog)),
        render: (_scope, app) => processGlobal.render(only, app),
        close() {},
    };
}

/** The core's request scope (SRV-7). Set this adapter when the core ships the seam. */
const coreScope: Seam | null = null;

/** A page whose render suspends once, so two concurrent requests interleave across the await. */
function page(gate: Promise<void>) {
    return defineComponent({
        async setup() {
            await gate;
            const t = useT();
            return () => h('h1', t.value('Pricing', 'UI') as string);
        },
    });
}
const Heading = defineComponent({
    setup() {
        const t = useT();
        return () => h('h1', t.value('Pricing', 'UI') as string);
    },
});

async function sequential(seam: Seam): Promise<string> {
    const de = seam.open('de', CATALOGS.de);
    await seam.render(de, Heading);
    seam.close(de);
    const it = seam.open('it', CATALOGS.it);
    const html = await seam.render(it, Heading);
    seam.close(it);
    return html;
}

/** Start `it`, let `de` open and finish while `it` is suspended, then let `it` finish. */
async function concurrent(seam: Seam): Promise<{ it: string; de: string }> {
    let release!: () => void;
    const gate = new Promise<void>((r) => (release = r));
    const itScope = seam.open('it', CATALOGS.it);
    const itRender = seam.render(itScope, page(gate));
    const deScope = seam.open('de', CATALOGS.de);
    const de = await seam.render(deScope, page(Promise.resolve()));
    release();
    const it = await itRender;
    seam.close(itScope);
    seam.close(deScope);
    return { it, de };
}

afterEach(() => seed({ __uncategorized__: {} }, 'en'));

describe('SRV-7 harness — the controls', () => {
    it("control: one shared scope serves the second visitor the first one's language", async () => {
        const html = await sequential(sharedScope());
        expect(html).toContain(EXPECTED.de);
        expect(html).not.toContain(EXPECTED.it);
    });

    it('today, seeding the process-wide catalog before each render is right one request at a time', async () => {
        const html = await sequential(processGlobal);
        expect(html).toContain(EXPECTED.it);
        expect(html).not.toContain(EXPECTED.de);
    });

    it('known gap, pinned: under concurrency the process-wide catalog leaks — the Italian visitor gets German', async () => {
        const { it, de } = await concurrent(processGlobal);
        expect(de).toContain(EXPECTED.de);
        expect(it).toContain(EXPECTED.de);
        expect(it).not.toContain(EXPECTED.it);
    });
});

describe.skipIf(coreScope === null)("SRV-7 — the core's request scope", () => {
    it('de, then it through a new scope: the second render is Italian, with no German in its bytes', async () => {
        const html = await sequential(coreScope!);
        expect(html).toContain(EXPECTED.it);
        expect(html).not.toContain(EXPECTED.de);
    });

    it('concurrent it and de: each render carries only its own locale', async () => {
        const { it, de } = await concurrent(coreScope!);
        expect(it).toContain(EXPECTED.it);
        expect(it).not.toContain(EXPECTED.de);
        expect(de).toContain(EXPECTED.de);
        expect(de).not.toContain(EXPECTED.it);
    });
});
