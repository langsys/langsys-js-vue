// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

/**
 * Rendered-output tests — assert what a **user sees**, not what a ref holds.
 *
 * The rest of the suite reads `.value` off the refs the composables return. That
 * is necessary but not sufficient: a ref holding the right value and a template
 * rendering the right thing are two claims, and only the second is the one that
 * matters to a person looking at the page. A binding could hold a correct
 * tri-state and still render a read-only UI to a write-enabled session.
 *
 * These mount real components into a real DOM and assert on `textContent`.
 *
 * The `writeEnabled` double is controllable so the three states can be driven
 * deliberately; everything else in the core stays real.
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
            update(fn: (v: boolean | undefined) => boolean | undefined) {
                value = fn(value);
                subs.forEach((r) => r(value));
            },
            get: () => value,
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
 * Fresh module registry per case: `useWriteEnabled` latches `pastHydration` at
 * module scope. Vue is re-imported through the SAME registry so the app created
 * here and the composable under test share one reactivity runtime — a component
 * mounted from the test file's own copy of Vue would not be driven by a
 * freshly-reset `composables.ts`, and these assertions would silently pass while
 * testing nothing.
 */
async function load() {
    vi.resetModules();
    const vue = await import('vue');
    const { useWriteEnabled } = await import('./composables.js');
    return { ...vue, useWriteEnabled };
}

let host: HTMLElement;

beforeEach(() => {
    vi.useFakeTimers();
    signal.reset(undefined);
    host = document.createElement('div');
    document.body.appendChild(host);
});

afterEach(() => {
    vi.useRealTimers();
    host.remove();
});

describe('useWriteEnabled — through rendered output', () => {
    /**
     * Renders the tri-state verbatim, so `undefined` and `false` stay
     * distinguishable in the DOM rather than collapsing to the same falsy
     * branch — which is the bug this whole surface exists to prevent.
     */
    async function mountProbe() {
        const { createApp, defineComponent, h, useWriteEnabled } = await load();
        const app = createApp(
            defineComponent({
                setup() {
                    const writeEnabled = useWriteEnabled();
                    return () => h('span', { id: 'probe' }, String(writeEnabled.value));
                },
            })
        );
        app.mount(host);
        return {
            app,
            text: () => host.querySelector('#probe')?.textContent,
        };
    }

    it('renders "undefined" during the hydration window, never "false"', async () => {
        // Authorization already resolved before mount — the race the latch guards.
        signal.set(true);
        const { text, app } = await mountProbe();

        expect(text()).toBe('undefined'); // NOT "false", and not yet "true"
        app.unmount();
    });

    it('renders the real value after the latch, in the DOM', async () => {
        signal.set(true);
        const { text, app } = await mountProbe();
        expect(text()).toBe('undefined');

        await vi.runAllTimersAsync();
        await Promise.resolve();
        expect(text()).toBe('true'); // the user now sees the write-enabled state

        app.unmount();
    });

    it('renders "false" and "undefined" as distinct states', async () => {
        const { text, app } = await mountProbe();
        await vi.runAllTimersAsync();
        expect(text()).toBe('undefined'); // unknown

        signal.set(false);
        await vi.runAllTimersAsync();
        expect(text()).toBe('false'); // genuinely read-only — a different render

        signal.set(true);
        await vi.runAllTimersAsync();
        expect(text()).toBe('true');

        app.unmount();
    });

    /**
     * The consumer-facing shape of the tri-state: three branches, not two.
     * A `v-if="writeEnabled"` / `v-else` pair would render the read-only branch
     * during the unknown window — the collapse this rule forbids. Asserting on
     * rendered text is the only way to catch that; the ref would look correct.
     */
    it('drives a three-way template branch, and the unknown branch is its own', async () => {
        const { createApp, defineComponent, h, useWriteEnabled } = await load();
        const app = createApp(
            defineComponent({
                setup() {
                    const w = useWriteEnabled();
                    return () =>
                        h(
                            'span',
                            { id: 'probe' },
                            w.value === undefined ? 'checking' : w.value ? 'editing' : 'read-only'
                        );
                },
            })
        );
        app.mount(host);
        const text = () => host.querySelector('#probe')?.textContent;

        expect(text()).toBe('checking');

        signal.set(false);
        await vi.runAllTimersAsync();
        expect(text()).toBe('read-only');

        signal.set(true);
        await vi.runAllTimersAsync();
        expect(text()).toBe('editing');

        app.unmount();
    });
});
