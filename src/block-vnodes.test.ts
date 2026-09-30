// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import {
    Comment,
    createApp,
    createCommentVNode,
    createVNode,
    defineComponent,
    Fragment,
    h,
    ref,
    Teleport,
    type VNode,
    type VNodeArrayChildren,
} from 'vue';
import { slotToBlockNodes, translatedToVNodes, type TranslatedNode } from './block-vnodes.js';

/**
 * The binding's half of the core's non-DOM block path (proposed `renderBlock`): a slot's vnodes
 * into the core's tree, and the translated copy back into vnodes that keep handlers and refs.
 * The core is stood in for by a hand-written translated copy, in the shape proposed, with the
 * `source` back-reference on each element.
 */

const cleanups: Array<() => void> = [];
afterEach(() => {
    while (cleanups.length) cleanups.pop()!();
});

describe('slot vnodes → the core tree', () => {
    it('maps elements, text and fragments; keeps string attributes; drops handlers', () => {
        const slot: VNodeArrayChildren = [
            h('p', { title: 'Hint', class: 'lead', onClick: () => {} }, ['Hello ', h('b', 'world'), ' again']),
            'bare text',
            h(Fragment, [h('em', 'in a fragment')]),
        ];
        const result = slotToBlockNodes(slot);
        expect(result.ok).toBe(true);
        if (!result.ok) return;
        expect(result.nodes).toEqual([
            {
                tag: 'p',
                attrs: { title: 'Hint', class: 'lead' },
                children: [{ text: 'Hello ' }, { tag: 'b', children: [{ text: 'world' }] }, { text: ' again' }],
            },
            { text: 'bare text' },
            { tag: 'em', children: [{ text: 'in a fragment' }] },
        ]);
        // Pre-order: p, then its b, then the fragment's em.
        expect(result.elements.map((v) => v.type)).toEqual(['p', 'b', 'em']);
    });

    it('a teleport is set aside, not tokenized', () => {
        const result = slotToBlockNodes([h('p', 'kept'), h(Teleport, { to: 'body' }, [h('p', 'teleported')])]);
        expect(result.ok && result.nodes).toEqual([{ tag: 'p', children: [{ text: 'kept' }] }]);
        expect(result.ok && result.teleports.length).toBe(1);
    });

    it('a component in the slot is not converted — the block falls back', () => {
        const Child = defineComponent({ setup: () => () => h('span', 'from a child') });
        expect(slotToBlockNodes([h('p', 'text'), h(Child)])).toEqual({
            ok: false,
            reason: 'component',
            variable: false,
        });
    });

    it('v-html is not converted — the block falls back', () => {
        expect(slotToBlockNodes([h('div', { innerHTML: '<i>raw</i>' })])).toEqual({
            ok: false,
            reason: 'v-html',
            variable: false,
        });
    });

    it('v-html beside a compiled variable, before it or after it, marks the block a variable (VAR-7)', () => {
        const raw = () => h('div', { innerHTML: '<i>raw</i>' });
        const value = () => createVNode('p', null, 'Hi Ana', 1 /* PatchFlags.TEXT */);
        expect(slotToBlockNodes([raw(), value()])).toMatchObject({ ok: false, reason: 'v-html', variable: true });
        expect(slotToBlockNodes([value(), raw()])).toMatchObject({ ok: false, reason: 'v-html', variable: true });
    });
});

describe('the translated copy → vnodes that keep what the tree cannot carry', () => {
    /** Mount `Hello <b>world</b> again` translated as `<b>mondo</b> ciao di nuovo`, markup moved. */
    function mountTranslated(reattach: boolean) {
        let clicked = 0;
        const bold = ref<HTMLElement | null>(null);
        const Host = defineComponent({
            setup() {
                return () => {
                    const slot = [
                        h('p', { title: 'Hint' }, [
                            'Hello ',
                            h('b', { ref: bold, onClick: () => clicked++ }, 'world'),
                            ' again',
                        ]),
                    ];
                    const converted = slotToBlockNodes(slot);
                    if (!converted.ok) throw new Error('unexpected fallback');
                    const translated: TranslatedNode[] = [
                        {
                            tag: 'p',
                            attrs: { title: 'Suggerimento' },
                            source: 0,
                            children: [
                                { tag: 'b', source: 1, children: [{ text: 'mondo' }] },
                                { text: ' ciao di nuovo' },
                            ],
                        },
                    ];
                    const strip = (n: TranslatedNode): TranslatedNode =>
                        'tag' in n ? { ...n, source: undefined, children: n.children?.map(strip) } : n;
                    return h(
                        'div',
                        translatedToVNodes(reattach ? translated : translated.map(strip), converted.elements)
                    );
                };
            },
        });
        const el = document.createElement('div');
        document.body.appendChild(el);
        const app = createApp(Host);
        app.mount(el);
        cleanups.push(() => {
            app.unmount();
            el.remove();
        });
        return { el, clicks: () => clicked, bold };
    }

    it('renders the translation, with the moved element still carrying its handler and ref', () => {
        const { el, clicks, bold } = mountTranslated(true);
        expect(el.querySelector('p')?.outerHTML).toBe('<p title="Suggerimento"><b>mondo</b> ciao di nuovo</p>');
        el.querySelector('b')!.dispatchEvent(new Event('click'));
        expect(clicks()).toBe(1);
        expect(bold.value).toBe(el.querySelector('b'));
    });

    it('control: rebuilt from the translated copy alone, the same element loses its handler and ref', () => {
        const { el, clicks, bold } = mountTranslated(false);
        expect(el.querySelector('p')?.outerHTML).toBe('<p title="Suggerimento"><b>mondo</b> ciao di nuovo</p>');
        el.querySelector('b')!.dispatchEvent(new Event('click'));
        expect(clicks()).toBe(0);
        expect(bold.value).toBeNull();
    });
});

describe('value markers (VAR-3) reach the core', () => {
    it('the comment pair passes through as the tree form; the span form as an element; other comments are dropped', () => {
        const result = slotToBlockNodes([
            h('p', [
                'Hello ',
                createCommentVNode('ls:name'),
                'Ana',
                createCommentVNode('/ls'),
                createCommentVNode('an ordinary comment'),
                ', welcome back',
            ]),
            h('p', ['Hi ', h('span', { 'data-ls-param': 'name' }, 'Bo')]),
        ]);
        expect(result.ok && result.nodes).toEqual([
            {
                tag: 'p',
                children: [
                    { text: 'Hello ' },
                    { comment: 'ls:name' },
                    { text: 'Ana' },
                    { comment: '/ls' },
                    { text: ', welcome back' },
                ],
            },
            {
                tag: 'p',
                children: [
                    { text: 'Hi ' },
                    { tag: 'span', attrs: { 'data-ls-param': 'name' }, children: [{ text: 'Bo' }] },
                ],
            },
        ]);
    });
});

describe('comment nodes', () => {
    it('a Comment vnode on input is skipped; a comment node on output becomes a Comment vnode', () => {
        const result = slotToBlockNodes([h('p', 'kept'), createCommentVNode('marker')]);
        expect(result.ok && result.nodes).toEqual([{ tag: 'p', children: [{ text: 'kept' }] }]);
        const [out] = translatedToVNodes([{ comment: 'hydration marker' }], []) as VNode[];
        expect(out.type).toBe(Comment);
        expect(out.children).toBe('hydration marker');
    });
});

// Keep the VNode type import used when the file is type-checked in isolation.
export type _VNode = VNode;
