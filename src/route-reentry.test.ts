// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * BIND-5 / GATE-7 — does a client-side navigation re-enter `t()`?
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
 * That assertion is the control that makes the `t()` count mean something.
 */

const { calls, setups, tSignalMock } = vi.hoisted(() => {
    const calls: string[] = [];
    const setups: string[] = [];
    const subs = new Set<(v: unknown) => void>();
    const fn = (phrase: string) => {
        calls.push(phrase);
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

import { createApp, defineComponent, h, KeepAlive } from 'vue';
import { createRouter, createWebHashHistory, RouterView } from 'vue-router';
import { useT } from './composables.js';

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

async function mount(keepAlive: boolean) {
    const router = createRouter({
        history: createWebHashHistory(),
        routes: [
            { path: '/', component: page('A') },
            { path: '/b', component: page('B') },
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
        async go(path: string) {
            calls.length = 0;
            setups.length = 0;
            await router.push(path);
            await new Promise((r) => setTimeout(r, 0));
            return { t: [...calls], setup: [...setups] };
        },
    };
}

describe.each([
    ['plain <RouterView>', false],
    ['<KeepAlive> <RouterView>', true],
])('route re-entry — %s', (_label, keepAlive) => {
    it('re-enters t() for the newly routed page, so discovery sees the new URL', async () => {
        const app = await mount(keepAlive);
        expect(app.rendered()).toBe('phrase-A'); // rendered output, not a ref read

        const toB = await app.go('/b');
        expect(toB.t).toContain('phrase-B');
        expect(app.rendered()).toBe('phrase-B');

        app.app.unmount();
    });

    it('re-enters t() on the way back, even when the instance is cached', async () => {
        const app = await mount(keepAlive);
        await app.go('/b');
        const back = await app.go('/');

        if (keepAlive) {
            // The control: keep-alive really did cache, so the t() count below is
            // evidence about re-render rather than about a fresh mount.
            expect(back.setup).toEqual([]);
        } else {
            expect(back.setup).toEqual(['A']);
        }

        // Either way the render function re-runs, and `t.value(...)` with it.
        expect(back.t).toContain('phrase-A');

        app.app.unmount();
    });

    /**
     * The measured limitation, pinned so it cannot regress silently in either
     * direction. A component outside `<RouterView>` is not re-rendered on
     * navigation — none of its reactive dependencies changed — so its misses are
     * attributed only to the URL present at first render.
     *
     * This is inherent to reactive rendering rather than something this binding
     * introduced (it adds no memoization at all), and the fix belongs in the
     * core's per-URL re-recording rather than in a binding-side memo. Asserted
     * as the current, known behaviour: if it ever starts re-entering, this test
     * fails and the conformance row needs revisiting.
     */
    it('does NOT re-enter t() for a persistent layout (known GATE-7 limitation)', async () => {
        const app = await mount(keepAlive);
        const toB = await app.go('/b');

        expect(toB.t).not.toContain('phrase-layout');

        app.app.unmount();
    });
});
