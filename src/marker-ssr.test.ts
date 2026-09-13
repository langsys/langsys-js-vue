// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, createSSRApp, defineComponent, h, nextTick, ref } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { Translate as VanillaTranslate } from 'langsys-js-typescript';
import { Translate } from './index.js';

/**
 * MARK-1 — a rendered `<Translate>` host carries the identity it was rendered from.
 *
 * The core's DOM class stamps a host's identity when it mounts, and mounting never
 * happens during server rendering. So before this binding stamped anything itself,
 * served HTML carried **no** id on any `<Translate>` host — measured as
 * `<translate><p>Pricing plans</p></translate>` — while the same component mounted on
 * the client carried `data-ls-contentblock="…"`. Two paths over the same markup,
 * disagreeing, which CONF-1's every-path clause does not allow.
 *
 * An explicit `custom_id` IS the resolved id and is known at render time, so the
 * binding stamps it on every path. A derived id needs the rendered subtree tokenized,
 * which only the core's DOM class (client) or a server SDK can do — that half stays a
 * known gap, and is pinned below rather than left implicit.
 *
 * MARK-1's test asks for two independent paths to one value, because reading back the
 * attribute the renderer just wrote proves only that it was written. Here the second
 * path is the core's vanilla class, run on a plain element with no binding involved.
 */

const ATTR = 'data-ls-contentblock';
const tick = (ms = 20) => new Promise((r) => setTimeout(r, ms));
const cleanups: Array<() => void> = [];

afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    document.body.innerHTML = '';
});

const Block = (customId?: string) =>
    defineComponent({
        render: () =>
            h(Translate, { category: 'UI', ...(customId ? { custom_id: customId } : {}) }, () => [
                h('p', 'Pricing plans'),
            ]),
    });

/** What the core stamps for this content, reached WITHOUT going through this binding. */
async function stampedByCore(customId?: string): Promise<Record<string, string>> {
    const host = document.createElement('translate');
    host.innerHTML = '<p>Pricing plans</p>';
    document.body.appendChild(host);
    const instance = new VanillaTranslate(host, { category: 'UI', ...(customId ? { custom_id: customId } : {}) });
    cleanups.push(() => instance.destroy());
    await tick();
    return Object.fromEntries([...host.attributes].map((a) => [a.name, a.value]));
}

describe('MARK-1 — a served <Translate> host carries its identity', () => {
    it('stamps an explicit custom_id on the served host', async () => {
        const html = await renderToString(createSSRApp(Block('explicit-1')));
        expect(html).toContain(`${ATTR}="explicit-1"`);
    });

    it('control: a derived-id block is served unstamped — the known SSR gap, pinned', async () => {
        // Also proves the stamp above is conditional rather than unconditional.
        const html = await renderToString(createSSRApp(Block()));
        expect(html).not.toContain(ATTR);
    });

    it("the served stamp is the core's own — same attribute name, same value, derived independently", async () => {
        const html = await renderToString(createSSRApp(Block('explicit-1')));
        const core = await stampedByCore('explicit-1');
        const coreName = Object.entries(core).find(([, v]) => v === 'explicit-1')?.[0];

        expect(coreName, 'the core stamped no attribute carrying the explicit id').toBeDefined();
        // The literal cross-check: the core does not export its marker constant, so this
        // binding duplicates it. If the core ever renames the attribute, this goes red.
        expect(coreName).toBe(ATTR);
        expect(html).toContain(`${coreName}="${core[coreName as string]}"`);
    });

    it('hydrating the served explicit-id host raises no mismatch', async () => {
        const html = await renderToString(createSSRApp(Block('explicit-1')));
        const logs: string[] = [];
        const el = document.createElement('div');
        el.innerHTML = html;
        document.body.appendChild(el);
        const app = createSSRApp(Block('explicit-1'));
        app.config.warnHandler = (m) => void logs.push(String(m));
        const originalError = console.error;
        console.error = (...a: unknown[]) => void logs.push(a.map(String).join(' '));
        try {
            app.mount(el);
            await tick();
        } finally {
            console.error = originalError;
        }
        cleanups.push(() => app.unmount());

        expect(logs.filter((l) => /hydrat|mismatch/i.test(l))).toEqual([]);
        expect(el.querySelector('translate')?.getAttribute(ATTR)).toBe('explicit-1');
    });

    it('switching an explicit id to a derived one leaves the host stamped with the derived id', async () => {
        const derivedId = (await stampedByCore())[ATTR];
        expect(derivedId, 'control: the core derives an id for this content').toBeTruthy();

        const id = ref('explicit-1');
        const Switching = defineComponent({
            setup: () => () => h(Translate, { category: 'UI', custom_id: id.value }, () => [h('p', 'Pricing plans')]),
        });
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(Switching);
        app.mount(el);
        cleanups.push(() => app.unmount());
        await tick();
        const host = () => el.querySelector('translate');
        expect(host()?.getAttribute(ATTR)).toBe('explicit-1');

        id.value = '';
        await nextTick();
        await tick();
        expect(host()?.getAttribute(ATTR)).toBe(derivedId);
    });
});
