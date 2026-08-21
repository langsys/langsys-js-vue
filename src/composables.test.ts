import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Controllable stand-in for the base SDK's `writeEnabled` signal, so these
 * tests exercise this package's deferral logic rather than the SDK's
 * authorization flow. Everything else in the module stays real.
 */
const { signal } = vi.hoisted(() => {
    let value: boolean | undefined;
    const subs = new Set<(v: boolean | undefined) => void>();
    return {
        signal: {
            subscribe(run: (v: boolean | undefined) => void) {
                subs.add(run);
                run(value);
                return () => subs.delete(run);
            },
            set(v: boolean | undefined) {
                value = v;
                subs.forEach((r) => r(v));
            },
            // Unused here, but the real `writeEnabled` is a full Signal and the
            // positive controls below hand this double to `useSignal`.
            update(fn: (v: boolean | undefined) => boolean | undefined) {
                value = fn(value);
                subs.forEach((r) => r(value));
            },
            get: () => value,
            subscriberCount: () => subs.size,
            reset(v: boolean | undefined) {
                subs.clear();
                value = v;
            },
        },
    };
});

vi.mock('langsys-js-typescript', async (importOriginal) => ({
    ...(await importOriginal<typeof import('langsys-js-typescript')>()),
    writeEnabled: signal,
}));

/**
 * `composables.ts` latches `pastHydration` at module scope, so every case needs
 * a fresh module instance.
 *
 * `vue` is re-imported through the same reset registry on purpose: `effectScope`
 * and `onScopeDispose` communicate through module-level state inside
 * `@vue/reactivity`, so a scope created from the test file's own copy of Vue
 * would be invisible to a freshly-reset `composables.ts`, and every disposal
 * assertion below would silently test nothing.
 */
async function load({ browser }: { browser: boolean }) {
    vi.resetModules();
    if (browser) (globalThis as Record<string, unknown>).window = {};
    else delete (globalThis as Record<string, unknown>).window;

    const vue = await import('vue');
    const { useWriteEnabled } = await import('./composables.js');
    const { useSignal } = await import('./adapters.js');
    return { useWriteEnabled, useSignal, ...vue };
}

beforeEach(() => {
    vi.useFakeTimers();
    signal.reset(undefined);
});

afterEach(() => {
    vi.useRealTimers();
    delete (globalThis as Record<string, unknown>).window;
});

describe('useWriteEnabled — SSR', () => {
    it('reports undefined and never subscribes the process-wide signal', async () => {
        signal.set(true); // as if another request on this server had resolved
        const { useWriteEnabled, useSignal, effectScope } = await load({ browser: false });

        // The failing case: the obvious implementation — wrap the signal like
        // every other composable does. Under SSR it both leaks a client-only
        // value into server HTML and attaches a subscriber to a singleton that
        // outlives the request.
        const naiveScope = effectScope();
        const naive = naiveScope.run(() => useSignal(signal))!;
        expect(naive.value).toBe(true); // leaked into the server render
        expect(signal.subscriberCount()).toBe(1); // subscription outliving the request
        naiveScope.stop();
        expect(signal.subscriberCount()).toBe(0);

        // The passing case: unknown on the server, and nothing subscribed.
        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        expect(enabled.value).toBeUndefined();
        expect(signal.subscriberCount()).toBe(0);
        expect(() => scope.stop()).not.toThrow();
    });
});

describe('useWriteEnabled — hydration pass', () => {
    it('publishes undefined even when the signal is already concrete', async () => {
        // The hazard: an awaited Nuxt plugin or `useAsyncData` resolves
        // authorization BEFORE the first client render, so the raw signal is
        // already `true` while the server rendered from `undefined`. Reading
        // through here is the mismatch.
        signal.set(true);
        const { useWriteEnabled, useSignal, effectScope } = await load({ browser: true });

        // The failing case, again the obvious implementation.
        const naiveScope = effectScope();
        expect(naiveScope.run(() => useSignal(signal))!.value).toBe(true);
        naiveScope.stop();

        const scope = effectScope();
        expect(scope.run(() => useWriteEnabled())!.value).toBeUndefined();
        scope.stop();
    });

    it('does not adopt on a microtask — nextTick() still lands inside hydration', async () => {
        // Why the latch is a macrotask and not `nextTick()`: Vue drains the
        // microtask queue as part of the same hydration pass, so a microtask
        // deferral would flip the value before hydration finished and
        // reintroduce the mismatch it was meant to prevent.
        signal.set(true);
        const { useWriteEnabled, effectScope, nextTick } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;

        await nextTick();
        expect(enabled.value).toBeUndefined(); // a microtask is not enough

        await vi.runAllTimersAsync();
        expect(enabled.value).toBe(true); // the macrotask is
        scope.stop();
    });

    it('adopts the real value on the first macrotask after hydration', async () => {
        signal.set(true);
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        expect(enabled.value).toBeUndefined();

        await vi.runAllTimersAsync();
        expect(enabled.value).toBe(true);
        scope.stop();
    });

    it('never substitutes false for "not known yet"', async () => {
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        const seen: (boolean | undefined)[] = [enabled.value];
        await vi.runAllTimersAsync();
        seen.push(enabled.value);

        // Nothing has resolved, so every observed value must be the honest
        // "unknown" — a `false` here would tell a write-enabled session it is
        // read-only, unrecoverably until reload.
        expect(seen).not.toContain(false);
        expect(seen.every((v) => v === undefined)).toBe(true);
        scope.stop();
    });

    it('keeps false and undefined distinct, and tracks later changes', async () => {
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        await vi.runAllTimersAsync();
        expect(enabled.value).toBeUndefined(); // unknown, NOT read-only

        signal.set(false);
        expect(enabled.value).toBe(false); // now genuinely read-only

        signal.set(true);
        expect(enabled.value).toBe(true);
        scope.stop();
    });
});

describe('useWriteEnabled — after hydration', () => {
    it('later callers read through immediately, with no undefined flash', async () => {
        signal.set(true);
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        // First call completes the handover, latching pastHydration.
        const first = effectScope();
        first.run(() => useWriteEnabled());
        await vi.runAllTimersAsync();

        // A component mounted by client-side navigation must not flash unknown.
        const later = effectScope();
        expect(later.run(() => useWriteEnabled())!.value).toBe(true);

        first.stop();
        later.stop();
    });
});

describe('useWriteEnabled — teardown', () => {
    it('disposing before handover cancels it and leaks no subscription', async () => {
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        scope.stop(); // component unmounted inside the deferral window

        await vi.runAllTimersAsync();
        signal.set(true);

        expect(enabled.value).toBeUndefined();
        expect(signal.subscriberCount()).toBe(0);
    });

    it('disposing after handover detaches from the signal', async () => {
        const { useWriteEnabled, effectScope } = await load({ browser: true });

        const scope = effectScope();
        const enabled = scope.run(() => useWriteEnabled())!;
        await vi.runAllTimersAsync();
        expect(signal.subscriberCount()).toBe(1);

        scope.stop();
        signal.set(true);

        expect(signal.subscriberCount()).toBe(0);
        expect(enabled.value).toBeUndefined(); // no update after disposal
    });

    it('works outside any scope, staying subscribed for the app lifetime', async () => {
        const { useWriteEnabled } = await load({ browser: true });

        const enabled = useWriteEnabled(); // module-level use, no scope to dispose
        await vi.runAllTimersAsync();
        signal.set(true);

        expect(enabled.value).toBe(true);
    });
});
