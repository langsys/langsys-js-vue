import { describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';

/**
 * Where a server render registers: inside the request scope, or nowhere. `<Translate>` and `<Phrase>`
 * call the core's `registerBlock` during a server render only inside the scope they render in,
 * entered with `scope.run` or provided to the app (the Nuxt path, here with no AsyncLocalStorage),
 * so the scope holds each block for `close()`. A render outside every scope registers nothing: on
 * a server the core has no scope to hold the block for and resolves such a call at once.
 *
 * `registerBlock` is wrapped to record, per call, whether a request scope was current.
 */

const { calls } = vi.hoisted(() => ({ calls: [] as boolean[] }));
vi.mock('langsys-js-typescript', async (importOriginal) => {
    const core = await importOriginal<typeof import('langsys-js-typescript')>();
    return {
        ...core,
        registerBlock: (...args: Parameters<typeof core.registerBlock>) => {
            calls.push(core.currentRequestScope() !== undefined);
            return core.registerBlock(...args);
        },
    };
});

const { createRequestScope, provideRequestScope } = await import('./server.js');
const { Phrase, Translate } = await import('./index.js');

const CATALOG = { __uncategorized__: {}, UI: { Pricing: 'Prezzi' } };
const Blocks = defineComponent({
    render: () =>
        h('div', [
            h(Translate, { category: 'UI' }, () => [h('p', 'Pricing'), h('p', 'Unknown block line')]),
            h(Phrase, { category: 'UI' }, () => ['Unknown ', h('b', 'phrase')]),
        ]),
});

describe('a server render registers inside its request scope, or not at all', () => {
    it('outside every scope, it never calls registerBlock', async () => {
        calls.length = 0;
        await renderToString(createSSRApp(Blocks));
        expect(calls).toEqual([]);
    });

    it('in a scope provided to the app, with no async context, each block registers with that scope current, and the scope holds it', async () => {
        calls.length = 0;
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOG as never });
        const app = createSSRApp(Blocks);
        provideRequestScope(app, scope);
        await renderToString(app);
        expect(calls).toEqual([true, true]);
        const seed = scope.seed();
        expect(Object.values(seed.blocks).map((b) => b.tokens)).toEqual([['Pricing', 'Unknown block line']]);
        expect(seed.phrases.map((p) => p.phrase)).toEqual(['Unknown {m0o}phrase{m0c}']);
    });

    it('in a scope entered with scope.run, the same', async () => {
        calls.length = 0;
        const scope = await createRequestScope({ locale: 'it', catalog: CATALOG as never });
        await scope.run(() => renderToString(createSSRApp(Blocks)));
        expect(calls).toEqual([true, true]);
    });
});
