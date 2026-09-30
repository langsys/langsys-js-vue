// @vitest-environment jsdom
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { createApp, defineComponent, h, nextTick, type PropType } from 'vue';
import { resolveServerMessages as coreResolve } from 'langsys-js-typescript';
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
 * MSG-12's page half: an Inertia page receives Laravel's own error body, with the entries the
 * server binding attached under `langsys_errors`, resolves them by that key with the core's
 * `resolveServerMessages()`, renders them through this helper, and leaves the body untouched.
 * The page object a failed form redirects to is Laravel's own, written by its
 * `InertiaPageFixtureTest` at langsys-php-laravel c5d14051 with Inertia's middleware installed, vendored byte-exact
 * (`test/fixtures/laravel-inertia-failed-form-page.json`, blob afcc37bf).
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
    resolve: Array<{ id: string; body: unknown; options: unknown; expected: unknown }>;
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
    /**
     * The page props are the shared vectors' `laravel-422-body` resolve row: Laravel's own 422
     * body, `message` and `errors` untouched, with the entries the server binding attached
     * beside them under `langsys_errors`.
     */
    const row = VECTORS.resolve.find((r) => r.id === 'laravel-422-body')!;
    const Page = defineComponent({
        props: { page: { type: Object, required: true } },
        setup(props) {
            const render = useServerMessage();
            return () =>
                h(
                    'ul',
                    resolveServerMessages(props.page, { key: 'langsys_errors' }).map((e) => h('li', render.value(e)))
                );
        },
    });

    it('control: the vector row exists and is the Laravel body', () => {
        expect(row, 'laravel-422-body is missing from the vectors').toBeDefined();
        expect(Object.keys(row.body as object)).toEqual(expect.arrayContaining(['errors', 'langsys_errors']));
    });

    it("the entries render in the page locale, and the framework's own errors prop is left untouched", () => {
        const page = structuredClone(row.body) as Record<string, unknown>;
        seed(
            {
                ...EMPTY,
                Errors: {
                    'The password field must be at least {min} characters.':
                        'La contraseña debe tener al menos {min} caracteres.',
                },
            },
            'es'
        );
        expect(texts(mount(Page, { page }))).toEqual([
            'La contraseña debe tener al menos 12 caracteres.',
            'The selected plan is invalid.',
        ]);
        expect(page).toEqual(row.body);
    });

    it('control: with no catalog, the page renders the messages the server filled', () => {
        seed(EMPTY, 'en');
        expect(texts(mount(Page, { page: structuredClone(row.body) }))).toEqual(
            (row.expected as Array<{ message: string }>).map((e) => e.message)
        );
    });

    it("resolveServerMessages is the core's own, found only under the configured key", () => {
        expect(resolveServerMessages).toBe(coreResolve);
        expect(() => resolveServerMessages(row.body, {} as never)).toThrow(TypeError);
        for (const r of VECTORS.resolve)
            expect(resolveServerMessages(r.body, r.options as never), r.id).toEqual(r.expected);
    });
});

describe('MSG-12 — the page a failed Laravel form redirects to', () => {
    const raw = readFileSync(join(process.cwd(), 'test/fixtures/laravel-inertia-failed-form-page.json'));
    const fixture = JSON.parse(raw.toString('utf8')) as { props: Record<string, unknown> };
    const Page = defineComponent({
        props: { props: { type: Object, required: true } },
        setup(p) {
            const render = useServerMessage();
            return () =>
                h(
                    'ul',
                    resolveServerMessages(p.props, { key: 'langsys_errors' }).map((e) => h('li', render.value(e)))
                );
        },
    });
    const ES = {
        ...EMPTY,
        Errors: {
            'The cc number field is required.': 'El número de tarjeta es obligatorio.',
            'The amount field must not be greater than {max}.': 'El importe no puede ser mayor que {max}.',
        },
    };

    it('control: the fixture is the vendored blob, carrying Inertia errors beside langsys_errors', () => {
        const blob = createHash('sha1').update(`blob ${raw.length}\0`).update(raw).digest('hex');
        expect(blob).toBe('afcc37bf7995dc528cd536e5ad238f387868b512');
        expect(Object.keys(fixture.props).sort()).toEqual(['errors', 'langsys_errors']);
    });

    it("control: Inertia's own errors prop holds no entries, so the configured key is what finds them", () => {
        expect(resolveServerMessages(fixture.props, { key: 'errors' })).toEqual([]);
        expect(resolveServerMessages(fixture.props, { key: 'langsys_errors' })).toHaveLength(2);
    });

    it('the page renders the entries in its locale, params filled, and leaves the props untouched', () => {
        const props = structuredClone(fixture.props);
        seed(ES, 'es');
        expect(texts(mount(Page, { props }))).toEqual([
            'El número de tarjeta es obligatorio.',
            'El importe no puede ser mayor que 100.',
        ]);
        expect(props).toEqual(fixture.props);
    });

    it('control: with no catalog, the page renders the messages Laravel filled', () => {
        seed(EMPTY, 'en');
        expect(texts(mount(Page, { props: structuredClone(fixture.props) }))).toEqual([
            'The cc number field is required.',
            'The amount field must not be greater than 100.',
        ]);
    });
});
