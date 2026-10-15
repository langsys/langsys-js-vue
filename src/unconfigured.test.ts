// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h } from 'vue';
import { createLocaleStore, LangsysApp, LangsysAppAPI, Phrase, Translate, useT } from './index.js';

/**
 * WIRE-4 in a binding: an app with no credentials boots and renders its source through the
 * framework's function, with params filled; nothing is fetched, nothing throws, and blocks show
 * their text. The binding passes the core's options through and adds no check of its own, so a
 * fresh clone or a CI build without a key still runs. Its own file: a second `init()` in one
 * process is a no-op.
 */

const requested: string[] = [];
const caught: unknown[] = [];
let el: HTMLElement;
let status: unknown;

const Greeting = defineComponent({
    setup() {
        const t = useT();
        return () => h('p', t.value('Hello {name}', 'UI', { name: 'Ana' }) as string);
    },
});

beforeAll(async () => {
    vi.stubGlobal(
        'fetch',
        vi.fn(async (input: unknown) => {
            requested.push(String(input instanceof Request ? input.url : input));
            return new Response('{}', { status: 500, headers: { 'content-type': 'application/json' } });
        })
    );
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    status = (await LangsysApp.init({ projectid: 'p1', key: '', UserLocaleStore: createLocaleStore('it') })).status;
    el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(
        defineComponent({
            render: () =>
                h('div', [
                    h(Greeting),
                    h(Translate, { category: 'UI' }, () => [h('p', 'Hello'), h('p', 'World')]),
                    h(Phrase, { category: 'UI' }, () => ['Hello ', h('b', 'world')]),
                ]),
        })
    );
    app.config.errorHandler = (error) => void caught.push(error);
    app.mount(el);
    // Past the block settle window, so every registration has been asked for and answered.
    await new Promise((r) => setTimeout(r, 1_000));
});
afterAll(() => {
    el.remove();
    vi.unstubAllGlobals();
});

describe('an app with no credentials boots and renders its source', () => {
    it('init() resolves unconfigured, and nothing reaches the app as an error', () => {
        expect(status).toBe(false);
        expect(LangsysApp.isConfigured()).toBe(false);
        expect(caught).toEqual([]);
    });

    it('useT() renders the source with its params filled, and the blocks show their text', () => {
        expect(el.textContent).toBe('Hello AnaHelloWorldHello world');
    });

    it('nothing is fetched', () => {
        expect(requested).toEqual([]);
    });

    it("control: the transport watched here is the core's", async () => {
        await LangsysAppAPI.validate({ projectid: 'p1', key: 'k' } as never).catch(() => undefined);
        expect(requested).toHaveLength(1);
    });
});
