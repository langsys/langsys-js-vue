// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, type Component } from 'vue';
import { createRouter, createWebHashHistory, RouterView, useRoute, type Router } from 'vue-router';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, syncNavigation, useT } from './index.js';

/**
 * HINT-13 against the contract double (spec CONF-2, tier `contract`): a component that stays
 * mounted across a route change records its miss at the new URL, because this binding calls
 * the core's `notifyNavigation()` from Vue Router's `afterEach`.
 *
 * The session is read-only and its key may report, so the double STORES a hint for any page
 * the SDK reports. Presence and absence are both evidence here: the double would accept a
 * hint for page B, so "no hint for B" means the SDK never sent one.
 *
 * Page components only render phrases the catalog translates, so they record nothing. The
 * one missing phrase in each case sits where the case says, and a hint for a page can only
 * come from it.
 *
 * One `init()` for the file (a second is a no-op). Each case uses its own paths, because the
 * core reports a URL once per session, and re-seeds the double, which empties its state.
 */

const SEED = {
    config: { renderer_egress_ips: ['10.9.9.9'] },
    projects: [
        {
            id: 'p1',
            base_locale: 'en',
            target_locales: ['es-es'],
            website_url: 'https://site.local',
            phrases: [{ category: 'UI', phrase: 'Known phrase', translations: { 'es-es': 'Frase conocida' } }],
        },
    ],
    keys: [{ key: 'k-public', project: 'p1', type: 'ip_write', report_discovered_content: true }],
};

let fx: ContractFixture;
let router: Router | undefined;
let unmount: (() => void) | undefined;

const hints = async () => (await fx.state()).hints.map((h) => h.url);
const hintFor = async (path: string) => (await hints()).some((u) => u.endsWith(`#${path}`));
/** Run out the 5–30 s report jitter, then wait on real time for the double to store it. */
const runOutJitter = () => vi.advanceTimersByTimeAsync(31_000);
const settle = () => sleep(600);

/** A component that renders one phrase through `useT()`. */
const says = (phrase: string) =>
    defineComponent({
        setup() {
            const t = useT();
            return () => h('div', t.value(phrase, 'UI') as string);
        },
    });

/** A child that reads nothing from the route. */
const RouteIndependent = says('Child phrase');
/** A route component vue-router reuses across `/p/:id`, re-rendering because it reads the param. */
const ParamPage = defineComponent({
    setup() {
        const t = useT();
        const route = useRoute();
        return () =>
            h('section', [
                `${t.value('Known phrase', 'UI') as string}:${String(route.params.id)}`,
                h(RouteIndependent),
            ]);
    },
});

async function mountApp(opts: {
    layoutPhrase: string;
    pageA: Component;
    pageB: Component;
    keepAlive?: boolean;
    wire: boolean;
    paths: [string, string];
}) {
    window.location.hash = opts.paths[0];
    router = createRouter({
        history: createWebHashHistory(),
        routes: [
            { path: opts.paths[0], component: opts.pageA },
            { path: opts.paths[1], component: opts.pageB },
            { path: '/p/:id', component: ParamPage },
        ],
    });
    if (opts.wire) syncNavigation(router);
    const view = opts.keepAlive
        ? () =>
              h(RouterView, null, {
                  default: ({ Component }: { Component: unknown }) =>
                      h(KeepAlive, null, [Component ? h(Component as never) : null]),
              })
        : () => h(RouterView);
    const Layout = defineComponent({
        setup() {
            const t = useT();
            return () => h('div', [h('header', t.value(opts.layoutPhrase, 'UI') as string), view()]);
        },
    });
    const app = createApp(Layout);
    app.use(router);
    await router.push(opts.paths[0]);
    await router.isReady();
    const el = document.createElement('div');
    document.body.appendChild(el);
    app.mount(el);
    unmount = () => {
        app.unmount();
        el.remove();
    };
}

async function go(path: string) {
    await router!.push(path);
    expect(window.location.href, 'control: the URL moved').toBe(`https://site.local/#${path}`);
}

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    // `error` too: the locale display data the SDK requests at start-up is outside the double's contract (404).
    for (const m of ['log', 'info', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-public',
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es');
});
afterAll(async () => {
    await fx.stop();
});
beforeEach(async () => {
    await fx.seed(SEED);
    vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
        shouldAdvanceTime: true,
    });
});
afterEach(() => {
    unmount?.();
    unmount = undefined;
    vi.useRealTimers();
});

describe('HINT-13 — a persistent layout records its miss at the new URL', () => {
    it.each([
        ['plain <RouterView>', false, ['/n1a', '/n1b']],
        ['<KeepAlive> <RouterView>', true, ['/n2a', '/n2b']],
    ] as const)('%s: the double stores a hint for page B', async (_label, keepAlive, paths) => {
        await mountApp({
            layoutPhrase: 'Layout phrase',
            pageA: says('Known phrase'),
            pageB: says('Known phrase'),
            keepAlive,
            wire: true,
            paths: [...paths],
        });
        await runOutJitter();
        await until(() => hintFor(paths[0]));

        await go(paths[1]);
        await runOutJitter();
        await until(() => hintFor(paths[1]));
    });

    it('a param-only navigation: a route-independent child of the reused page records at the new URL', async () => {
        await mountApp({
            layoutPhrase: 'Known phrase',
            pageA: says('Known phrase'),
            pageB: says('Known phrase'),
            wire: true,
            paths: ['/n3a', '/n3b'],
        });
        await go('/p/1');
        await runOutJitter();
        await until(() => hintFor('/p/1'));

        await go('/p/2');
        await runOutJitter();
        await until(() => hintFor('/p/2'));
    });

    it('without the call, the same layout records nothing for page B, although the double would store it', async () => {
        await mountApp({
            layoutPhrase: 'Layout phrase',
            pageA: says('Known phrase'),
            pageB: says('Known phrase'),
            wire: false,
            paths: ['/n4a', '/n4b'],
        });
        await runOutJitter();
        await until(() => hintFor('/n4a'));

        await go('/n4b');
        await runOutJitter();
        await settle();
        expect(await hintFor('/n4b')).toBe(false);
    });

    it('control: a phrase only page A rendered, unmounted by the navigation, records nothing at B', async () => {
        await mountApp({
            layoutPhrase: 'Known phrase',
            pageA: says('Only on page A'),
            pageB: says('Known phrase'),
            wire: true,
            paths: ['/n5a', '/n5b'],
        });
        await runOutJitter();
        await until(() => hintFor('/n5a'));

        await go('/n5b');
        await runOutJitter();
        await settle();
        expect(await hintFor('/n5b')).toBe(false);
    });
});
