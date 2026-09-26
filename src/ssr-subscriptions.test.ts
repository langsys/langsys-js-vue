import { describe, expect, it } from 'vitest';
import { createSSRApp, defineComponent, effectScope, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { currentlyLoadedLocale, sTranslations, tSignal } from 'langsys-js-typescript';
import { useCurrentLocale, useT, useTranslations, useWriteEnabled } from './index.js';

/**
 * A server render leaves no subscription behind on the core's process-lifetime signals.
 *
 * Vue's server renderer never stops a component's effect scope, so a composable that
 * subscribed during a server render could never unsubscribe: each request would leave one
 * listener per composable on `tSignal`, `currentlyLoadedLocale` and `sTranslations`, growing
 * without bound. Nothing re-renders on the server, so the composables read once instead.
 *
 * Runs in the node environment, with no `window`, as a server does. Every subscribe on the
 * three signals is counted, opened and released.
 */

type Countable = { subscribe(run: (v: unknown) => void): () => void };
function count(signal: Countable) {
    const tally = { opened: 0, released: 0 };
    const original = signal.subscribe.bind(signal);
    signal.subscribe = (run) => {
        tally.opened++;
        const off = original(run);
        return () => {
            tally.released++;
            off();
        };
    };
    return { tally, restore: () => void (signal.subscribe = original) };
}

const Page = defineComponent({
    setup() {
        const t = useT();
        useCurrentLocale();
        useTranslations();
        useWriteEnabled();
        return () => h('h1', t.value('Pricing', 'UI') as string);
    },
});

describe('server renders leave no subscriptions behind', () => {
    it('control: the counter sees a subscription open and release when its scope stops', () => {
        // Outside a render, with a window, as in a browser: a composable subscribes and its
        // scope's disposal releases it. Without this, "0 open" below could mean a blind counter.
        const g = globalThis as { window?: unknown };
        const hadWindow = 'window' in g;
        g.window = g.window ?? {};
        const { tally, restore } = count(tSignal as unknown as Countable);
        try {
            const scope = effectScope();
            scope.run(() => useT());
            scope.stop();
            expect(tally).toEqual({ opened: 1, released: 1 });
        } finally {
            restore();
            if (!hadWindow) delete g.window;
        }
    });

    it('50 server renders open no subscription on any of the three signals', async () => {
        const counted = [tSignal, currentlyLoadedLocale, sTranslations].map((s) => count(s as unknown as Countable));
        try {
            for (let i = 0; i < 50; i++) await renderToString(createSSRApp(Page));
            expect(counted.map((c) => c.tally.opened - c.tally.released)).toEqual([0, 0, 0]);
        } finally {
            counted.forEach((c) => c.restore());
        }
    });
});
