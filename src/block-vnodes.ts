import {
    Comment,
    Fragment,
    Teleport,
    Text,
    cloneVNode,
    createCommentVNode,
    h,
    isVNode,
    type InjectionKey,
    type VNode,
    type VNodeArrayChildren,
} from 'vue';
import { TRANSLATABLE_ATTRIBUTES } from 'langsys-js-typescript/pure';

/**
 * Server rendering for `<Translate>` and `<Phrase>` (SRV-1, SRV-5, MARK-1) — the Vue half.
 *
 * The core's non-DOM block path (`renderBlock`, proposed) translates a serialized tree. This
 * module is the binding's two conversions around it: a default slot's vnodes into that tree,
 * and the translated tree back into vnodes that keep what the tree cannot carry — event
 * handlers, refs, directives, keys — by cloning each element's original vnode through the
 * `source` back-reference the core returns.
 *
 * Working against the proposed shape; not wired into the components until the core ships it.
 */

/**
 * A node of the serialized tree the core tokenizes and translates. `comment` carries another
 * framework's hydration markers; this binding skips Comment vnodes on input, so it never sends one.
 */
export type BlockNode =
    | { text: string }
    | { comment: string }
    | { tag: string; attrs?: Record<string, string | true>; children?: BlockNode[] };

/**
 * A node of the core's translated copy. An element's `source` is the document-order (pre-order)
 * index of the input element it came from, which survives the translation reordering markup.
 */
export type TranslatedNode =
    | { text: string }
    | { comment: string }
    | {
          tag: string;
          attrs?: Readonly<Record<string, string | true>>;
          children?: readonly TranslatedNode[];
          source?: number;
      };

export type SlotConversion =
    | {
          ok: true;
          /** The tree for the core. */
          nodes: BlockNode[];
          /** Each element's original vnode, at its document-order (pre-order) index. */
          elements: VNode[];
          /** Teleports: their content leaves the host on both sides, so it is not tokenized and is re-emitted untouched. */
          teleports: VNode[];
          /**
           * Vue compiled a value into the slot's text or a translatable attribute (VAR-7). The runtime
           * cannot tell which part is the value, so the block renders from the catalog and registers
           * nothing.
           */
          variable: boolean;
      }
    | { ok: false; reason: UnrenderedReason };

/** Why a slot is not rendered through the tree: a component or `v-html` has no markup to read until it renders. */
export type UnrenderedReason = 'component' | 'v-html';

/**
 * The reason a block holding a compiled variable names to the core's `warnUnregistered()`: the
 * transform that would have named the value.
 */
export const UNREGISTERED_REASON = 'enable langsysTransform from langsys-js-vue/compiler';

/** Vue's patch flags (runtime-core `PatchFlags`) that mark compiled dynamic content. */
const PATCH_TEXT = 1;
const PATCH_PROPS = 1 << 3;
const PATCH_FULL_PROPS = 1 << 4;
const TRANSLATABLE = new Set<string>(TRANSLATABLE_ATTRIBUTES);

/** Compiled dynamic text: `{{ name }}` inside the element, or a text vnode that is one. */
function isDynamicText(vnode: VNode): boolean {
    return vnode.patchFlag > 0 && (vnode.patchFlag & PATCH_TEXT) !== 0;
}

/** A translatable attribute (TOK-3) the template binds to a value. */
function hasDynamicTranslatableAttribute(vnode: VNode): boolean {
    if (vnode.patchFlag <= 0) return false;
    if (vnode.patchFlag & PATCH_FULL_PROPS)
        return Object.keys(vnode.props ?? {}).some((name) => TRANSLATABLE.has(name));
    if (vnode.patchFlag & PATCH_PROPS)
        return ((vnode as unknown as { dynamicProps?: string[] | null }).dynamicProps ?? []).some((name) =>
            TRANSLATABLE.has(name)
        );
    return false;
}

/** Props that are not attributes of the rendered element, or that hold content the tree cannot express. */
const NOT_ATTRIBUTES = new Set(['key', 'ref', 'ref_for', 'ref_key', 'innerHTML', 'textContent']);

/**
 * Convert a default slot's vnodes into the core's tree.
 *
 * A block whose slot holds a component or `v-html` cannot be converted. A component has not
 * rendered at slot time, and rendering it early would run it outside its place in the tree;
 * leaving it out would make the server's tokens differ from the ones the browser reads off the
 * rendered DOM. `v-html` is a string, not vnodes. Such a block is not server-rendered: the
 * caller serves it as source and lets the client derive its id on mount.
 */
export function slotToBlockNodes(children: VNodeArrayChildren | undefined): SlotConversion {
    const elements: VNode[] = [];
    const teleports: VNode[] = [];
    let failure: UnrenderedReason | null = null;
    let variable = false;

    const walk = (input: VNodeArrayChildren | string | undefined): BlockNode[] => {
        const out: BlockNode[] = [];
        const push = (node: BlockNode): void => void out.push(node);
        const visit = (child: unknown): void => {
            if (failure) return;
            if (child === null || child === undefined || typeof child === 'boolean') return;
            if (typeof child === 'string' || typeof child === 'number') return push({ text: String(child) });
            if (Array.isArray(child)) return child.forEach(visit);
            if (!isVNode(child)) return;
            const vnode = child as VNode;
            // A value marker (VAR-3) goes to the core as the tree form; any other comment is dropped.
            if (vnode.type === Comment) {
                const text = String(vnode.children ?? '');
                return /^(ls:[a-z][a-z0-9_]*|\/ls)$/.test(text) ? push({ comment: text }) : undefined;
            }
            if (vnode.type === Text) {
                if (isDynamicText(vnode)) variable = true;
                return push({ text: String(vnode.children ?? '') });
            }
            if (vnode.type === Fragment) return (vnode.children as VNodeArrayChildren | null)?.forEach(visit);
            if (vnode.type === Teleport) return void teleports.push(vnode);
            if (typeof vnode.type !== 'string') return void (failure = 'component');
            const props = vnode.props ?? {};
            if ('innerHTML' in props || 'textContent' in props) return void (failure = 'v-html');
            if (isDynamicText(vnode) || hasDynamicTranslatableAttribute(vnode)) variable = true;

            const attrs: Record<string, string | true> = {};
            for (const [name, value] of Object.entries(props)) {
                if (NOT_ATTRIBUTES.has(name) || /^on[A-Z]/.test(name)) continue;
                if (typeof value === 'string' || typeof value === 'number') attrs[name] = String(value);
                else if (value === true) attrs[name] = true;
            }
            elements.push(vnode); // pre-order: the element's index before its descendants'
            const kids = walk(vnode.children as VNodeArrayChildren | string | undefined);
            push({
                tag: vnode.type,
                ...(Object.keys(attrs).length ? { attrs } : {}),
                ...(kids.length ? { children: kids } : {}),
            });
        };
        if (typeof input === 'string') return [{ text: input }];
        input?.forEach(visit);
        return out;
    };

    const nodes = walk(children);
    return failure ? { ok: false, reason: failure } : { ok: true, nodes, elements, teleports, variable };
}

/** Vue's shape flags for a vnode's children (runtime-core `ShapeFlags`). */
const TEXT_CHILDREN = 1 << 3;
const ARRAY_CHILDREN = 1 << 4;

/**
 * Turn the core's translated copy back into vnodes. An element with a `source` is a clone of the
 * original vnode at that index — handlers, refs, directives and key kept — with its translated
 * attributes laid over and its translated children in place, wherever the translation moved it.
 */
export function translatedToVNodes(nodes: readonly TranslatedNode[], elements: VNode[]): VNodeArrayChildren {
    return nodes.map((node) => {
        if ('text' in node) return node.text;
        if ('comment' in node) return createCommentVNode(node.comment);
        const children = translatedToVNodes(node.children ?? [], elements);
        const original = node.source === undefined ? undefined : elements[node.source];
        if (!original) return h(node.tag, node.attrs ?? {}, children);
        const clone = cloneVNode(original, node.attrs ?? {}, false);
        clone.children = children;
        clone.shapeFlag = (clone.shapeFlag & ~TEXT_CHILDREN) | ARRAY_CHILDREN;
        return clone;
    });
}

/**
 * Whether a `<Translate>` or `<Phrase>` above this one fell back to the core's DOM class. That
 * class walks its whole host after mount and registers every nested marked host on its own
 * (MARK-4), so a block rendered inside it must not register itself as well, or the nested block
 * is sent twice (SRV-5). Provided by every block component, read by its descendants.
 */
export const FALLBACK_ANCESTOR = Symbol('langsys-js-vue.fallbackAncestor') as InjectionKey<{ owns: boolean }>;
