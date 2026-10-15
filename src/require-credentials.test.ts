// @vitest-environment jsdom
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createApp, createVNode, defineComponent, h, type ComponentPublicInstance } from 'vue';
import { createLocaleStore, LangsysApp, LangsysConfigurationError, Phrase, Translate, useT } from './index.js';

/**
 * WIRE-4 under `requireCredentials`: `init()` without a key leaves the client unconfigured, and the
 * core's `registerBlock` rejects with `LangsysConfigurationError`. `<Translate>` and `<Phrase>` on
 * the tree path hand that promise back to Vue's lifecycle, so the failure reaches the app's
 * `errorHandler`, attributed to the component, and the page still shows the text as written —
 * also for blocks mounted before `init()`, once it refuses. Its own file: a second `init()` in one
 * process is a no-op.
 */

/** Vue's patch flag for text the compiler marks dynamic (runtime-core `PatchFlags.TEXT`). */
const TEXT = 1;

type Caught = { error: unknown; component: string | undefined; info: string };
const mounted: HTMLElement[] = [];

/** Mount a tree-path `<Translate>` and `<Phrase>` in their own app; return what its errorHandler receives. */
function mountBlocks(): { caught: Caught[]; el: HTMLElement } {
    const caught: Caught[] = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    mounted.push(el);
    const app = createApp(
        defineComponent({
            render: () =>
                h('div', [
                    h(Translate, { category: 'UI' }, () => [h('p', 'Hello'), h('p', 'World')]),
                    h(Phrase, { category: 'UI' }, () => ['Hello ', h('b', 'world')]),
                    // A compiled variable (VAR-7): read from the catalog, never registered.
                    h(Translate, { category: 'UI' }, () => [createVNode('p', null, `Good night, ${'Ana'}`, TEXT)]),
                ]),
        })
    );
    app.config.errorHandler = (error, instance: ComponentPublicInstance | null, info) =>
        void caught.push({ error, component: instance?.$options.name, info });
    app.mount(el);
    return { caught, el };
}

/** Mount a component that calls the framework's t(); return what its errorHandler receives. */
function mountFirstUse(): Caught[] {
    const caught: Caught[] = [];
    const el = document.createElement('div');
    document.body.appendChild(el);
    mounted.push(el);
    const Greeting = defineComponent({
        name: 'Greeting',
        setup() {
            const t = useT();
            return () => h('p', t.value('Hello {name}', 'UI', { name: 'Ana' }) as string);
        },
    });
    const app = createApp(Greeting);
    app.config.errorHandler = (error, instance: ComponentPublicInstance | null, info) =>
        void caught.push({ error, component: instance?.$options.name, info });
    app.mount(el);
    return caught;
}

let before: ReturnType<typeof mountBlocks>;
let after: ReturnType<typeof mountBlocks>;
let firstUse: Caught[];
let booted: boolean;

beforeAll(async () => {
    // A page whose blocks mount before the app calls init(), as when init() runs in a layout's onMounted.
    before = mountBlocks();
    const res = await LangsysApp.init({
        projectid: 'p1',
        key: '',
        UserLocaleStore: createLocaleStore('it'),
        requireCredentials: true,
    });
    booted = true;
    expect(res.status, 'control: the client is unconfigured').toBe(false);
    after = mountBlocks();
    firstUse = mountFirstUse();
    await new Promise((r) => setTimeout(r, 50));
});
afterAll(() => mounted.forEach((el) => el.remove()));

const expectBoth = (caught: Caught[]) => {
    expect(caught.map((c) => c.component).sort()).toEqual(['Phrase', 'Translate']);
    for (const c of caught) {
        expect(c.error).toBeInstanceOf(LangsysConfigurationError);
        expect(c.info).toMatch(/mounted/);
    }
};

describe('requireCredentials with no credentials, on the tree path', () => {
    it("each block's registration failure reaches the app's errorHandler, from the component that registered it", () => {
        expectBoth(after.caught);
    });

    it('blocks mounted before init() report it once init() refuses', () => {
        expectBoth(before.caught);
    });

    it('a block holding a compiled variable only reads, so it reports nothing, before init() or after', () => {
        // expectBoth above admits exactly one Translate per app: the one that registers.
        expect([...before.caught, ...after.caught].filter((c) => c.component === 'Translate')).toHaveLength(2);
    });

    it('the page still shows the text as written', () => {
        expect(after.el.textContent).toBe('HelloWorldHello worldGood night, Ana');
        expect(before.el.textContent).toBe('HelloWorldHello worldGood night, Ana');
    });

    it("the exception surfaces at first use, from the framework's t(), not at boot", () => {
        expect(booted, 'init() resolved instead of throwing').toBe(true);
        expect(firstUse).toHaveLength(1);
        expect(firstUse[0]!.error).toBeInstanceOf(LangsysConfigurationError);
        expect(firstUse[0]!.component).toBe('Greeting');
        expect(firstUse[0]!.info).toMatch(/render/);
    });
});
