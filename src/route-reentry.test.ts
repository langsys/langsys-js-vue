// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BIND-5 / GATE-7 / HINT-4 — does a client-side navigation re-enter `t()`, at the new URL?
 *
 * ## Why this exists
 *
 * The core re-records a discovery miss **per URL**, and it does so *before* its
 * registration dedup — so a miss on page B is reported against page B only if
 * `t()` is actually called again after the route changes. Anything a binding
 * puts in front of `t()` that returns a cached answer starves that lane
 * silently: translations keep rendering correctly, and discovery quietly stops
 * seeing new pages.
 *
 * This is not hypothetical. The Angular binding's impure pipe memoized
 * translation results, so a route change did not re-enter and every page after
 * the first went unreported; its fix was to put the raw `location.href` into the
 * memo key.
 *
 * Vue's shape is different — `useT()` hands back a `shallowRef<TFunction>` and
 * templates call `t.value(...)` on every render, so there is no memo at all —
 * but "different shape, therefore fine" is an argument, not evidence. These
 * tests measure it.
 *
 * ## What the `setup()` assertions are for
 *
 * `<KeepAlive>` is the sharpest version of the hazard: it caches component
 * instances across navigation. A test that only counted `t()` calls could not
 * tell "keep-alive re-entered anyway" from "keep-alive was never actually
 * engaged", and the second would make the whole case vacuous. Counting `setup()`
 * invocations separates them: a cached instance does **not** re-run `setup()`.
 * The same count proves a param-only navigation really reused its instance.
 *
 * ## The two controls every verdict rests on
 *
 * A harness can produce "does not re-enter" from a correct binding, and the
 * Angular lane hit both ways of doing it with a real router (Reviewer, topic
 * `838-vue-push-to-100`):
 *
 *   1. **A URL that never moves.** A memory history, or any router that does not
 *      update `window.location`, leaves the URL where it was, so a correct
 *      re-entry captures the old URL and reads as a non-capture. The fake `t()`
 *      therefore records `window.location.href` at the moment of each call — the
 *      value the core's discovery capture reads — and every case asserts that the
 *      URL moved to the new route.
 *   2. **A navigation that never re-renders.** Reading the result before
 *      `router.push()` settles and Vue flushes sees no render at all. Every case
 *      therefore asserts that a component inside `<RouterView>` re-entered `t()`
 *      at the new URL.
 *
 * A case's own verdict, and above all a "does not re-enter", counts only after
 * both controls hold. The last block reproduces each trap and asserts that the
 * controls catch it; the mutation runner applies both traps to the graded cases
 * (M22, M23).
 */

const { calls, setups, tSignalMock } = vi.hoisted(() => {
    const calls: { phrase: string; href: string }[] = [];
    const setups: string[] = [];
    const subs = new Set<(v: unknown) => void>();
    const fn = (phrase: string) => {
        // The URL at the moment of the call is what the core's discovery capture reads.
        calls.push({ phrase, href: window.location.href });
        return phrase;
    };
    return {
        calls,
        setups,
        tSignalMock: {
            get: () => fn,
            subscribe(run: (v: unknown) => void) {
                subs.add(run);
                run(fn);
                return () => subs.delete(run);
            },
            set() {},
            update() {},
        },
    };
});

vi.mock('langsys-js-typescript', async (importOriginal) => ({
    ...(await importOriginal<typeof import('langsys-js-typescript')>()),
    tSignal: tSignalMock,
}));

import { computed, createApp, defineComponent, h, KeepAlive } from 'vue';
import {
    createMemoryHistory,
    createRouter,
    createWebHashHistory,
    RouterView,
    useRoute,
    type RouterHistory,
} from 'vue-router';
import { useT } from './composables.js';

/** What one navigation did: the URL before and after, each `t()` call with its URL, and each `setup()`. */
interface Nav {
    before: string;
    after: string;
    t: { phrase: string; href: string }[];
    setup: string[];
}

/** A routed page that translates one phrase, so its renders are countable. */
function page(name: string) {
    return defineComponent({
        name,
        setup() {
            setups.push(name);
            const t = useT();
            return () => h('span', { class: 'probe' }, t.value(`phrase-${name}`) as string);
        },
    });
}

/**
 * A routed page that also memoizes one translation in `computed()` — a memo a
 * consumer writes in front of `t()`, Vue's counterpart of Angular's
 * `computed(() => t()(…))`.
 */
function computedPage(name: string) {
    return defineComponent({
        name,
        setup() {
            setups.push(name);
            const t = useT();
            const label = computed(() => t.value(`phrase-${name}-computed`) as string);
            return () =>
                h('div', [h('span', { class: 'probe' }, t.value(`phrase-${name}`) as string), h('i', label.value)]);
        },
    });
}

/** Rendered inside a routed page, and reads nothing from the route. */
const StaticChild = defineComponent({
    name: 'StaticChild',
    setup() {
        const t = useT();
        return () => h('em', t.value('phrase-static-child') as string);
    },
});

/**
 * A routed page on a param route. vue-router reuses the instance when only the
 * param changes; the page reads the param, so it re-renders, and its child does not.
 */
function paramPage(name: string) {
    return defineComponent({
        name,
        setup() {
            setups.push(name);
            const t = useT();
            const route = useRoute();
            return () =>
                h('div', [
                    h('span', { class: 'probe' }, `${t.value(`phrase-${name}`) as string}:${String(route.params.id)}`),
                    h(StaticChild),
                ]);
        },
    });
}

/** Stays mounted across navigation — the persistent-chrome case (header/nav/footer). */
function layout(keepAlive: boolean) {
    return defineComponent({
        setup() {
            const t = useT();
            return () =>
                h('div', [
                    h('span', { id: 'layout' }, t.value('phrase-layout') as string),
                    keepAlive
                        ? h(RouterView, null, {
                              default: ({ Component }: { Component: unknown }) =>
                                  h(KeepAlive, null, [Component ? h(Component as never) : null]),
                          })
                        : h(RouterView),
                ]);
        },
    });
}

let host: HTMLElement;

beforeEach(() => {
    calls.length = 0;
    setups.length = 0;
    host = document.createElement('div');
    document.body.appendChild(host);
});

afterEach(() => {
    host.remove();
    window.location.hash = '';
});

async function mount(keepAlive: boolean, history: RouterHistory = createWebHashHistory()) {
    const router = createRouter({
        history,
        routes: [
            { path: '/', component: page('A') },
            { path: '/b', component: page('B') },
            { path: '/c', component: computedPage('C') },
            { path: '/p/:id', component: paramPage('P') },
        ],
    });
    const app = createApp(layout(keepAlive));
    app.use(router);
    await router.isReady();
    app.mount(host);
    await new Promise((r) => setTimeout(r, 0));

    return {
        app,
        router,
        rendered: () => host.querySelector('.probe')?.textContent,
        /**
         * Navigate and report what happened. `settle` awaits the navigation and a
         * macrotask, so Vue has flushed before anything is read. Reading without it
         * is the second harness trap, kept reachable so the controls can be shown to
         * catch it; the navigation is still awaited afterwards, so the next step
         * starts from a settled router either way.
         */
        async go(path: string, settle = true): Promise<Nav> {
            calls.length = 0;
            setups.length = 0;
            const before = window.location.href;
            const navigation = router.push(path);
            if (settle) {
                await navigation;
                await new Promise((r) => setTimeout(r, 0));
            }
            const nav: Nav = { before, after: window.location.href, t: [...calls], setup: [...setups] };
            await navigation;
            await new Promise((r) => setTimeout(r, 0));
            return nav;
        },
    };
}

/** Did `phrase` go through `t()` during this navigation, at any URL? */
const reentered = (nav: Nav, phrase: string) => nav.t.some((c) => c.phrase === phrase);

/**
 * The two controls. `routedPhrase` belongs to a component inside `<RouterView>`
 * that must re-render for the new route, and its call must carry that route's URL.
 */
function controls(nav: Nav, path: string, routedPhrase: string) {
    const atNewRoute = (href: string) => href.endsWith(`#${path}`);
    return {
        urlMoved: nav.before !== nav.after && atNewRoute(nav.after),
        routedReenteredAtNewUrl: nav.t.some((c) => c.phrase === routedPhrase && atNewRoute(c.href)),
    };
}
const BOTH_HOLD = { urlMoved: true, routedReenteredAtNewUrl: true };

describe.each([
    ['plain <RouterView>', false],
    ['<KeepAlive> <RouterView>', true],
])('route re-entry — %s', (_label, keepAlive) => {
    it('re-enters t() for the newly routed page, at the new URL', async () => {
        const app = await mount(keepAlive);
        expect(app.rendered()).toBe('phrase-A'); // rendered output, not a ref read

        const toB = await app.go('/b');
        expect(controls(toB, '/b', 'phrase-B')).toEqual(BOTH_HOLD);
        expect(app.rendered()).toBe('phrase-B');

        app.app.unmount();
    });

    it('re-enters t() on the way back, even when the instance is cached', async () => {
        const app = await mount(keepAlive);
        await app.go('/b');
        const back = await app.go('/');

        expect(controls(back, '/', 'phrase-A')).toEqual(BOTH_HOLD);
        // Keep-alive really did cache, so the re-entry above is evidence about
        // re-render rather than about a fresh mount.
        expect(back.setup).toEqual(keepAlive ? [] : ['A']);

        app.app.unmount();
    });

    /**
     * The measured limitation, pinned so it cannot regress silently in either
     * direction. A component outside `<RouterView>` is not re-rendered on
     * navigation — none of its reactive dependencies changed — so its misses are
     * attributed only to the URL present at first render. This file measures Vue
     * with no navigation hook; `syncNavigation(router)` closes the gap by calling
     * the core's `notifyNavigation()`, proven in `navigation-contract.test.ts`
     * (HINT-13). If Vue itself ever starts re-entering here, this test fails.
     */
    it('does NOT re-enter t() for a persistent layout outside <RouterView> (HINT-4 non-capture)', async () => {
        const app = await mount(keepAlive);
        const toB = await app.go('/b');

        expect(controls(toB, '/b', 'phrase-B')).toEqual(BOTH_HOLD);
        expect(reentered(toB, 'phrase-layout')).toBe(false);

        app.app.unmount();
    });

    /**
     * A `computed()` over `t()` is a memo keyed on the TFunction's identity, which a
     * navigation does not change. It re-enters only when the instance is re-created,
     * so under `<KeepAlive>` a revisited page's memoized phrase is not re-entered.
     */
    it('a computed() over t() re-enters only when the routed instance is re-created', async () => {
        const app = await mount(keepAlive);
        await app.go('/c');
        await app.go('/');
        const back = await app.go('/c');

        expect(controls(back, '/c', 'phrase-C')).toEqual(BOTH_HOLD);
        expect(back.setup).toEqual(keepAlive ? [] : ['C']);
        expect(reentered(back, 'phrase-C-computed')).toBe(!keepAlive);

        app.app.unmount();
    });

    /**
     * A param-only navigation keeps the routed instance, with or without
     * `<KeepAlive>`. The page re-renders because it reads the param; a child that
     * reads nothing from the route is not re-rendered, which is the persistent-layout
     * shape inside `<RouterView>`.
     */
    it('a param-only navigation reuses the instance, and a child that ignores the route does not re-enter', async () => {
        const app = await mount(keepAlive);
        await app.go('/p/1');
        const next = await app.go('/p/2');

        expect(controls(next, '/p/2', 'phrase-P')).toEqual(BOTH_HOLD);
        expect(next.setup).toEqual([]); // the instance really was reused
        expect(reentered(next, 'phrase-static-child')).toBe(false);

        app.app.unmount();
    });
});

describe('the controls catch both harness traps', () => {
    it('trap 1: a history that never moves the URL — the page re-renders at the old URL, and the controls fail', async () => {
        const app = await mount(false, createMemoryHistory());
        const toB = await app.go('/b');

        // The page did re-render; only the URL it saw is wrong. A check for the new
        // URL without the URL control would record this as a non-capture.
        expect(reentered(toB, 'phrase-B')).toBe(true);
        expect(controls(toB, '/b', 'phrase-B')).toEqual({ urlMoved: false, routedReenteredAtNewUrl: false });

        app.app.unmount();
    });

    it('trap 2: reading before the navigation settles — nothing has re-rendered, and the controls fail', async () => {
        const app = await mount(false);
        const early = await app.go('/b', false);

        // The verdict a vacuous harness would record for the persistent layout.
        expect(reentered(early, 'phrase-layout')).toBe(false);
        expect(controls(early, '/b', 'phrase-B')).toEqual({ urlMoved: false, routedReenteredAtNewUrl: false });

        app.app.unmount();
    });
});
