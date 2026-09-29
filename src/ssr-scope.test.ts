import { afterEach, describe, expect, it } from 'vitest';
import * as vue from 'vue';
import { createSSRApp, defineComponent, h, type Component } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { LangsysApp, Phrase, Translate, useT } from './index.js';
import { currentlyLoadedLocale, sTranslations } from 'langsys-js-typescript';
import { useCurrentLocale, useTranslations } from './index.js';
import { createRequestScope, installRequestScopes, provideRequestScope, type RequestScope } from './server.js';

/**
 * SRV-7 (and SRV-2) — server renders for different visitors must not share translation state.
 *
 * The spec's Test: in one process, seed and render `de`, then render `it` through a new scope,
 * and the second render is Italian with no German in its bytes; concurrent `it` and `de`
 * renders each carry only their own locale; rendering both through one shared scope turns the
 * first case red.
 *
 * The request scope is the core's (SRV-7). This file is written against a small seam interface,
 * with one adapter per way of isolating a render:
 *
 * - `processGlobal` — what this binding can do today: seed the core's process-wide catalog
 *   before each render. The measured state is pinned below: sequential renders are right,
 *   concurrent ones leak.
 * - `sharedScope` — the spec's mutation, one scope for every render. It must fail the
 *   sequential case, which is what proves that case can fail.
 * - `coreScope` — the core's request scope, a real scope per request rendered inside
 *   `scope.run`, as plain Vite SSR renders through `renderInRequestScope`.
 *
 * The last block renders the way a Nuxt server plugin does. The plugin cannot wrap the render,
 * so it provides the request's scope to that request's own Vue app (`provideRequestScope`).
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

/** The core's request scope (SRV-7): a real scope per request, rendered inside `scope.run`. */
installRequestScopes();
const coreScope: Seam | null = {
    open: (locale, catalog) => createRequestScope({ locale, catalog: catalog as never }),
    async render(scope, app) {
        const opened = await (scope as Promise<RequestScope>);
        return opened.run(() => renderToString(createSSRApp(app)));
    },
    close(scope) {
        void (scope as Promise<RequestScope>).then((opened) => opened.close());
    },
};

/**
 * A page whose render suspends once, so two concurrent requests interleave across the await. The
 * await goes through `withAsyncContext`, which is what the compiler emits for a top-level
 * `await` in `<script setup>`: it restores the component instance afterwards, as in a real page.
 */
/** The compiler helper `<script setup>` emits for a top-level await; exported by Vue, not declared in its types. */
const withAsyncContext = (vue as unknown as { withAsyncContext<T>(fn: () => T): [T, () => void] }).withAsyncContext;

function page(gate: Promise<void>) {
    return defineComponent({
        async setup() {
            const [waiting, restore] = withAsyncContext(() => gate);
            await waiting;
            restore();
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

describe('SRV-7 — Nuxt-shaped: the plugin cannot wrap the render', () => {
    /** A request whose awaited "plugin" opens the scope before the app renders, as Nuxt awaits its plugins. */
    async function request(
        locale: string,
        wait: Promise<void>,
        hand: 'provide' | 'enter-in-plugin' | 'enter-in-request'
    ) {
        await null; // the request handler's own async context
        const app = createSSRApp(page(wait));
        if (hand === 'enter-in-request') {
            const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });
            scope.enter();
        } else {
            await (async function plugin() {
                const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });
                if (hand === 'provide') provideRequestScope(app, scope);
                else scope.enter();
            })();
        }
        return renderToString(app);
    }
    async function interleaved(hand: Parameters<typeof request>[2]) {
        let release!: () => void;
        const gate = new Promise<void>((r) => (release = r));
        const itRequest = request('it', gate, hand);
        const de = await request('de', Promise.resolve(), hand);
        release();
        return { it: await itRequest, de };
    }

    it('provideRequestScope from the plugin: interleaved requests each render only their own locale', async () => {
        const { it, de } = await interleaved('provide');
        expect(it).toContain(EXPECTED.it);
        expect(it).not.toContain(EXPECTED.de);
        expect(de).toContain(EXPECTED.de);
        expect(de).not.toContain(EXPECTED.it);
    });

    it("scope.enter() in the request's own async function isolates interleaved requests too", async () => {
        const { it, de } = await interleaved('enter-in-request');
        expect(it).toContain(EXPECTED.it);
        expect(de).toContain(EXPECTED.de);
    });

    /**
     * Measured hazard, pinned: `enter()` called inside an awaited async function that first
     * awaited `createRequestScope` — the shape of a Nuxt plugin — does not isolate the request:
     * the Italian request serves German. This is why the Nuxt path provides the scope instead.
     */
    it('hazard, pinned: scope.enter() inside an awaited plugin serves the Italian request German', async () => {
        const { it } = await interleaved('enter-in-plugin');
        expect(it).not.toContain(EXPECTED.it);
    });
});

describe("SRV-1 — <Translate> and <Phrase> serve the request scope's translations", () => {
    it('concurrent it and de requests each serve their own block and phrase translations', async () => {
        const Blocks = defineComponent({
            render: () =>
                h('div', [
                    h(Translate, { category: 'UI' }, () => [h('p', 'Pricing')]),
                    h(Phrase, { category: 'UI' }, () => 'Pricing'),
                ]),
        });
        const [it, de] = await Promise.all(
            (['it', 'de'] as const).map(async (locale) => {
                const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });
                return scope.run(() => renderToString(createSSRApp(Blocks)));
            })
        );
        expect(it).toMatch(/data-ls-resolved="it"><p>Prezzi<\/p><\/translate><span data-ls-phrase>Prezzi<\/span>/);
        expect(de).toMatch(/data-ls-resolved="de"><p>Preise<\/p><\/translate><span data-ls-phrase>Preise<\/span>/);
    });
    it('a scope provided to the app (the Nuxt path), with no async context: each serves its own locale and records its block', async () => {
        seed(CATALOGS.de, 'de'); // the process-wide state, from another request
        const Blocks = defineComponent({
            render: () =>
                h('div', [
                    h(Translate, { category: 'UI' }, () => [h('p', 'Pricing')]),
                    h(Phrase, { category: 'UI' }, () => 'Pricing'),
                ]),
        });
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOGS.it as never });
        const app = createSSRApp(Blocks);
        provideRequestScope(app, scope);
        const html = await renderToString(app);
        expect(html).toMatch(/data-ls-resolved="it"><p>Prezzi<\/p><\/translate><span data-ls-phrase>Prezzi<\/span>/);
        expect(Object.keys(scope.seed().blocks)).toHaveLength(1);
    });
});

describe('SRV-2 — what follows the scope on the server', () => {
    it("the composables read the scope, not the process-wide catalog another visitor's request left", async () => {
        seed(CATALOGS.de, 'de'); // the process-wide state, from another request
        const Probe = defineComponent({
            setup() {
                const t = useT();
                const locale = useCurrentLocale();
                const catalog = useTranslations();
                return () =>
                    h(
                        'p',
                        `${t.value('Pricing', 'UI') as string}|${locale.value}|${(catalog.value as Record<string, Record<string, string>>).UI?.Pricing}`
                    );
            },
        });
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOGS.it as never });
        const html = await scope.run(() => renderToString(createSSRApp(Probe)));
        expect(html).toBe('<p>Prezzi|it|Prezzi</p>');
    });

    it('a scope provided to the app (the Nuxt path) is what the composables read, with no async context', async () => {
        seed(CATALOGS.de, 'de');
        const Probe = defineComponent({
            setup() {
                const t = useT();
                const locale = useCurrentLocale();
                const catalog = useTranslations();
                return () =>
                    h(
                        'p',
                        `${t.value('Pricing', 'UI') as string}|${locale.value}|${(catalog.value as Record<string, Record<string, string>>).UI?.Pricing}`
                    );
            },
        });
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOGS.it as never });
        const app = createSSRApp(Probe);
        provideRequestScope(app, scope);
        expect(await renderToString(app)).toBe('<p>Prezzi|it|Prezzi</p>');
    });

    it("the raw signals answer with the request's scope inside it, and with the process outside it", async () => {
        seed(CATALOGS.de, 'de');
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOGS.it as never });
        const read = () => [
            currentlyLoadedLocale.get(),
            (sTranslations.get() as Record<string, Record<string, string>>).UI?.Pricing,
        ];
        expect(scope.run(read)).toEqual(['it', 'Prezzi']);
        expect(read()).toEqual(['de', 'Preise']);
    });

    it("concurrent it and de requests each read their own triple, the process's de state notwithstanding", async () => {
        seed(CATALOGS.de, 'de');
        const Probe = defineComponent({
            async setup() {
                const [waiting, restore] = withAsyncContext(() => Promise.resolve());
                await waiting;
                restore();
                const t = useT();
                const locale = useCurrentLocale();
                const catalog = useTranslations();
                return () =>
                    h(
                        'p',
                        `${t.value('Pricing', 'UI') as string}|${locale.value}|${(catalog.value as Record<string, Record<string, string>>).UI?.Pricing}`
                    );
            },
        });
        const [it, de] = await Promise.all(
            (['it', 'de'] as const).map(async (locale) => {
                const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });
                return scope.run(() => renderToString(createSSRApp(Probe)));
            })
        );
        expect(it).toBe('<p>Prezzi|it|Prezzi</p>');
        expect(de).toBe('<p>Preise|de|Preise</p>');
    });
});
