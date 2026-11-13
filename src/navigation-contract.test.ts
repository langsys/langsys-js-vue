// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { createApp, defineComponent, h, KeepAlive, type Component } from 'vue';
import { createRouter, createWebHashHistory, RouterView, useRoute, type Router } from 'vue-router';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import seeds from '../test/helpers/contract-seeds/navigation.js';
import type { World } from '../test/helpers/contract-worlds.js';
import {
    createLocaleStore,
    currentlyLoadedLocale,
    LangsysApp,
    Phrase,
    syncNavigation,
    Translate,
    useT,
} from './index.js';

/**
 * HINT-13 against the API on an SDK test clone (spec CONF-2, tier `contract`): a component that
 * stays mounted across a route change records its miss at the new URL, because this binding calls
 * the core's `notifyNavigation()` from Vue Router's `afterEach`.
 *
 * The session is read-only, its key may report, and the project machine-translates new content,
 * so the API STORES a hint for any page the SDK reports. Presence and absence are both evidence
 * here: the API would accept a hint for page B, so "no hint for B" means the SDK never sent one.
 * The hints are read back through the forwarder's reader of what the clone stored.
 *
 * Page components only render phrases the catalog translates, so they record nothing. The
 * one missing phrase in each case sits where the case says, and a hint for a page can only
 * come from it.
 *
 * One `init()` for the file (a second is a no-op). Each case uses its own paths, because the
 * core reports a URL once per session, and calls from an address of its own, because the API
 * accepts five hints a minute from one address.
 */

let fx: ContractFixture;
let w: World;
let nextCase = 0;
let router: Router | undefined;
let unmount: (() => void) | undefined;

const hints = async () => (await fx.hints(w)).map((h) => h.url);
const hintFor = async (path: string) => (await hints()).some((u) => u.endsWith(`#${path}`));
/** Run out the 5–30 s report jitter, then wait on real time for the API to store it. */
const runOutJitter = () => vi.advanceTimersByTimeAsync(31_000);
const settle = () => sleep(3_000);

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
    w = seeds.take('base');
    await fx.use(w);
    for (const m of ['log', 'info', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: w.project(),
        key: w.key('k-public'),
        UserLocaleStore: createLocaleStore('es-es'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
    });
    await until(() => currentlyLoadedLocale.get() === 'es-es');
});
afterAll(async () => {
    await fx?.stop();
});
beforeEach(async () => {
    // Six addresses for seven cases: the last two store one hint each, four a minute between them.
    await fx.update(w, { caller: w.addressAt(Math.min(nextCase++, 5)) });
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
    ] as const)('%s: the API stores a hint for page B', async (_label, keepAlive, paths) => {
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

    it('without the call, the same layout records nothing for page B, although the API would store it', async () => {
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

    /**
     * `<KeepAlive>` keeps page A's instance when the navigation leaves it: its blocks stay in
     * memory, out of the page. Content no longer on the page records nothing at the new URL, as
     * the DOM classes already hold; the tree path is checked here through both wrappers.
     */
    it.each([
        ['<Translate>', () => h(Translate, { category: 'UI' }, () => [h('p', 'Only in cached block F')]), '/n6'],
        ['<Phrase>', () => h(Phrase, { category: 'UI' }, () => 'Only in cached phrase F'), '/n7'],
    ] as const)(
        'a %s on a page <KeepAlive> cached, deactivated by the navigation, records nothing at B',
        async (_label, block, base) => {
            await mountApp({
                layoutPhrase: 'Known phrase',
                pageA: defineComponent({ render: block }),
                pageB: says('Known phrase'),
                keepAlive: true,
                wire: true,
                paths: [`${base}a`, `${base}b`],
            });
            await runOutJitter();
            await until(() => hintFor(`${base}a`));

            await go(`${base}b`);
            await runOutJitter();
            await settle();
            expect(await hintFor(`${base}b`)).toBe(false);
        }
    );
});
