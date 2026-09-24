// @vitest-environment jsdom
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue';
import { LangsysApp, resolveServerMessages, useServerMessage, type ServerMessage } from './index.js';

/**
 * MSG-5 through this binding, and MSG-12's page half.
 *
 * The render decision is the core's `renderServerMessage()`. What this file proves is that
 * the Vue wrapper hands it every entry unchanged and re-renders when the answer can change:
 * each shared render vector (`test/fixtures/server-message-vectors.json`, vendored byte-exact
 * from langsys-js-typescript, blob c8125549) is rendered through a mounted component and
 * asserted on the DOM.
 *
 * MSG-12's page half: an Inertia page receives the server's error body as a prop, resolves
 * the entries with the core's `resolveServerMessages()`, and renders them through this helper.
 */

interface RenderVector {
    id: string;
    locale: string;
    category: string;
    catalog: Record<string, Record<string, string>> | null;
    entry: ServerMessage;
    expected: string;
}
const VECTORS = JSON.parse(readFileSync(join(process.cwd(), 'test/fixtures/server-message-vectors.json'), 'utf8')) as {
    render: RenderVector[];
};

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);
const EMPTY = { __uncategorized__: {} };

/** A page component: entries arrive as a prop and render through the helper. */
const Messages = defineComponent({
    props: {
        entries: { type: Array as PropType<ServerMessage[]>, required: true },
        category: { type: String, default: undefined },
    },
    setup(props) {
        const render = useServerMessage(props.category);
        return () =>
            h(
                'ul',
                props.entries.map((e) => h('li', render.value(e)))
            );
    },
});

const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
    seed(EMPTY, 'en');
});

function mount(component: ReturnType<typeof defineComponent>, props: Record<string, unknown>): HTMLElement {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = createApp(component, props);
    app.mount(el);
    cleanups.push(() => {
        app.unmount();
        el.remove();
    });
    return el;
}
const texts = (el: HTMLElement) => [...el.querySelectorAll('li')].map((li) => li.textContent);

describe('MSG-5 — the shared render vectors, through a mounted component', () => {
    it('the vector file carries render cases', () => {
        expect(VECTORS.render.length).toBeGreaterThan(0);
    });

    it.each(VECTORS.render.map((v) => [v.id, v] as const))('%s', (_id, v) => {
        seed(v.catalog === null ? EMPTY : { ...EMPTY, ...v.catalog }, v.catalog === null ? 'en' : v.locale);
        expect(texts(mount(Messages, { entries: [v.entry], category: v.category }))).toEqual([v.expected]);
    });
});

describe('MSG-5 — reactivity', () => {
    it('re-renders when the catalog changes under a mounted component', async () => {
        const v = VECTORS.render.find((x) => x.catalog && x.expected !== x.entry.message)!;
        expect(v, 'control: a vector whose translation differs from its message').toBeDefined();
        seed(EMPTY, 'en');
        const el = mount(Messages, { entries: [v.entry], category: v.category });
        expect(texts(el)).toEqual([v.entry.message]);

        seed({ ...EMPTY, ...v.catalog }, v.locale);
        await nextTick();
        expect(texts(el)).toEqual([v.expected]);
    });
});

describe('MSG-12 — the page half of an Inertia hand-off', () => {
    const body = {
        status: false,
        error: {
            code: 'validation_failed',
            errors: [
                {
                    field: 'email',
                    code: 'required',
                    template: 'The email field is required.',
                    message: 'The email field is required.',
                },
            ],
        },
    };
    const Page = defineComponent({
        props: { errors: { type: Object, required: true } },
        setup(props) {
            const render = useServerMessage();
            return () =>
                h(
                    'ul',
                    resolveServerMessages(props.errors).map((e) => h('li', render.value(e)))
                );
        },
    });

    it('entries shared as a page prop resolve and render in the page locale', () => {
        seed({ ...EMPTY, Errors: { 'The email field is required.': 'El campo email es obligatorio.' } }, 'es');
        expect(texts(mount(Page, { errors: body }))).toEqual(['El campo email es obligatorio.']);
    });

    it('control: with no catalog, the same prop renders the server message', () => {
        seed(EMPTY, 'en');
        expect(texts(mount(Page, { errors: body }))).toEqual(['The email field is required.']);
    });
});
