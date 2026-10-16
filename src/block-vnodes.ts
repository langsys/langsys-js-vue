import {
    Comment,
    Fragment,
    Teleport,
    Text,
    cloneVNode,
    createCommentVNode,
    h,
    isVNode,
    mergeProps,
    type VNode,
    type VNodeArrayChildren,
} from 'vue';
import { isTranslationExcluded, PHRASE_MARKER_ATTR, tokenizeTree, type ParamPrimitive } from 'langsys-js-typescript';
import { NON_TRANSLATABLE_ELEMENTS, TRANSLATABLE_ATTRIBUTES, VAR_PARAM_ATTR } from 'langsys-js-typescript/pure';
import { DontTranslate } from './components/DontTranslate.js';
import { Phrase } from './components/Phrase.js';

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
    | {
          tag: string;
          attrs?: Record<string, string | true>;
          children?: BlockNode[];
          /** A nested host's own params: the core renders it with them in place of the block's. */
          params?: Record<string, ParamPrimitive>;
      };

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
          /**
           * Vue compiled a value into an excluded element (TOK-1). The value is no part of a phrase, but a
           * block's content keeps excluded text as written, so a block holding one registers nothing.
           */
          excluded: boolean;
      }
    | {
          ok: false;
          reason: UnrenderedReason;
          /** A compiled variable sits beside the raw HTML or component: the block registers nothing (VAR-7). */
          variable: boolean;
          /** A compiled value sits inside an excluded element: a block registers nothing. */
          excluded: boolean;
      };

/**
 * Why a slot is not rendered through the tree: a component or `v-html` has no markup to read until it
 * renders. Raw HTML alone is content, registered through the DOM class after mount (VAR-7).
 */
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
 * Whether an element and everything inside it are left out of the phrase (TOK-1): an author's
 * `translate="no"` or `data-notrans`, read by the core's own predicate, or code and notation.
 */
function isExcluded(vnode: VNode): boolean {
    const props = vnode.props ?? {};
    const present = (name: string) => props[name] !== undefined && props[name] !== null && props[name] !== false;
    return (
        NON_TRANSLATABLE_ELEMENTS.includes(String(vnode.type).toLowerCase()) ||
        isTranslationExcluded({
            tagName: String(vnode.type),
            getAttribute: (name) => (present(name) ? (props[name] === true ? '' : String(props[name])) : null),
            hasAttribute: present,
        })
    );
}

/** What the tree carries for a comment vnode: a value marker (VAR-3) in its comment form, or nothing. */
function commentNodes(vnode: VNode): BlockNode[] {
    const text = String(vnode.children ?? '');
    return /^(ls:[a-z][a-z0-9_]*|\/ls)$/.test(text) ? [{ comment: text }] : [];
}

/**
 * Whether the core's reader takes an element as a value marker (VAR-3). A marker alone in an element
 * is its own `{NAME}` token; a name outside VAR-2's grammar, or anything but text inside, makes it
 * ordinary markup. Asked of the core's tokenizer, over the element's shape — the one the block sends
 * — rather than re-read here.
 */
function isValueMarker(vnode: VNode): boolean {
    const name = String(vnode.props?.[VAR_PARAM_ATTR] ?? '').trim();
    const shape = (children: unknown): BlockNode[] => {
        if (typeof children === 'string' || typeof children === 'number') return [{ text: 'x' }];
        if (!Array.isArray(children)) return [];
        return children.flatMap((child): BlockNode[] => {
            if (child === null || child === undefined || typeof child === 'boolean') return [];
            if (!isVNode(child)) return shape(child);
            if (child.type === Text) return [{ text: 'x' }];
            if (child.type === Comment) return commentNodes(child);
            if (child.type === Fragment) return shape(child.children);
            return [{ tag: typeof child.type === 'string' ? child.type : 'span', children: shape(child.children) }];
        });
    };
    const probe: BlockNode = {
        tag: String(vnode.type),
        attrs: { [VAR_PARAM_ATTR]: name },
        children: shape(vnode.children),
    };
    return tokenizeTree([{ tag: 'p', children: [probe] }]).tokens.join('|') === `{${name}}`;
}

/**
 * The element a `<DontTranslate>` renders, built from its vnode: its tag, `translate="no"`, the
 * attributes that fall through to it, and its slot's content. The slot is the app's, so its
 * compiled values keep their patch flags.
 */
function dontTranslateElement(vnode: VNode): VNode {
    const { tag, ...attrs } = (vnode.props ?? {}) as { tag?: string } & Record<string, unknown>;
    const slots = vnode.children as { default?: () => VNodeArrayChildren } | null;
    return h(tag ?? 'span', mergeProps({ translate: 'no', 'data-ls-dont-translate': '' }, attrs), slots?.default?.());
}

/** The core's attribute for a nested host's own category (`hostCategory`); empty is a category of its own. */
const CATEGORY_MARKER_ATTR = 'data-ls-category';

/**
 * The phrase host a nested `<Phrase>` renders, built from its vnode for the enclosing block's tree:
 * phrase-marked, with its own category (the default `''` included, so the block's registration
 * records the phrase where the component does), the attributes that fall through to it, and its
 * slot's content. Its params go on the tree node.
 */
function phraseHost(vnode: VNode): VNode {
    const {
        tag,
        category,
        params: _params,
        ...attrs
    } = (vnode.props ?? {}) as {
        tag?: string;
        category?: string;
        params?: unknown;
    } & Record<string, unknown>;
    const slots = vnode.children as { default?: () => VNodeArrayChildren } | null;
    return h(
        tag ?? 'span',
        mergeProps({ [PHRASE_MARKER_ATTR]: '', [CATEGORY_MARKER_ATTR]: category ?? '' }, attrs),
        slots?.default?.()
    );
}

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
    let excluded = false;
    /**
     * Where the walk is: inside an excluded element, inside a value marker's element (VAR-3), whose
     * compiled value is named, not a variable, and inside a nested `<Phrase>`, a unit of its own
     * the enclosing block leaves out (MARK-4): a value excluded there never reaches the block.
     */
    interface At {
        inExcluded: boolean;
        inMarker: boolean;
        inPhrase: boolean;
    }
    const dynamic = ({ inExcluded, inMarker, inPhrase }: At): void => {
        if (inMarker) return;
        if (!inExcluded) variable = true;
        else if (!inPhrase) excluded = true;
    };

    const walk = (input: VNodeArrayChildren | string | undefined, at: At): BlockNode[] => {
        const out: BlockNode[] = [];
        const push = (node: BlockNode): void => void out.push(node);
        const visit = (child: unknown): void => {
            if (child === null || child === undefined || typeof child === 'boolean') return;
            if (typeof child === 'string' || typeof child === 'number') return push({ text: String(child) });
            if (Array.isArray(child)) return child.forEach(visit);
            if (!isVNode(child)) return;
            const vnode = child as VNode;
            if (vnode.type === Comment) return void out.push(...commentNodes(vnode));
            if (vnode.type === Text) {
                if (isDynamicText(vnode)) dynamic(at);
                return push({ text: String(vnode.children ?? '') });
            }
            if (vnode.type === Fragment) return (vnode.children as VNodeArrayChildren | null)?.forEach(visit);
            // A nested <Phrase> renders its own teleports.
            if (vnode.type === Teleport) return void (at.inPhrase ? undefined : teleports.push(vnode));
            // <DontTranslate> is read as the element it renders, and rendered back as itself. An
            // attribute bound on it falls through to that element.
            if (vnode.type === DontTranslate) {
                if (hasDynamicTranslatableAttribute(vnode)) dynamic({ ...at, inExcluded: true });
                return element(dontTranslateElement(vnode), vnode);
            }
            // A nested <Phrase> is read as the phrase host it renders, carrying its own params, and
            // rendered back as itself: it renders and registers its own phrase.
            if (vnode.type === Phrase) {
                const params = vnode.props?.params as Record<string, ParamPrimitive> | undefined;
                return element(phraseHost(vnode), vnode, { ...at, inPhrase: true }, params);
            }
            // A fallback does not end the walk: a compiled variable anywhere else in the slot still
            // decides that nothing registers.
            if (typeof vnode.type !== 'string') return void (failure ??= 'component');
            element(vnode, vnode);
        };
        const element = (
            vnode: VNode,
            original: VNode,
            within: At = at,
            params?: Record<string, ParamPrimitive>
        ): void => {
            const props = vnode.props ?? {};
            if ('innerHTML' in props || 'textContent' in props) return void (failure ??= 'v-html');
            const here: At = {
                inExcluded: within.inExcluded || isExcluded(vnode),
                inMarker: within.inMarker || (VAR_PARAM_ATTR in props && isValueMarker(vnode)),
                inPhrase: within.inPhrase,
            };
            if (isDynamicText(vnode) || hasDynamicTranslatableAttribute(vnode)) dynamic(here);

            const attrs: Record<string, string | true> = {};
            for (const [name, value] of Object.entries(props)) {
                if (NOT_ATTRIBUTES.has(name) || /^on[A-Z]/.test(name)) continue;
                if (typeof value === 'string' || typeof value === 'number') attrs[name] = String(value);
                else if (value === true) attrs[name] = true;
            }
            elements.push(original); // pre-order: the element's index before its descendants'
            const kids = walk(vnode.children as VNodeArrayChildren | string | undefined, here);
            push({
                tag: vnode.type as string,
                ...(Object.keys(attrs).length ? { attrs } : {}),
                ...(kids.length ? { children: kids } : {}),
                ...(params ? { params } : {}),
            });
        };
        if (typeof input === 'string') return [{ text: input }];
        input?.forEach(visit);
        return out;
    };

    const nodes = walk(children, { inExcluded: false, inMarker: false, inPhrase: false });
    return failure
        ? { ok: false, reason: failure, variable, excluded }
        : { ok: true, nodes, elements, teleports, variable, excluded };
}

/** Vue's shape flags for a vnode's children (runtime-core `ShapeFlags`). */
const TEXT_CHILDREN = 1 << 3;
const ARRAY_CHILDREN = 1 << 4;
const SLOTS_CHILDREN = 1 << 5;
/** Vue's patch flag (runtime-core `PatchFlags.BAIL`) for a vnode the compiler's hints do not describe. */
const BAIL = -2;

/**
 * The attributes the translation changed on `original`, under the names the vnode spells them
 * with. The core reads attribute names as HTML does, lowercased, so an SVG's `viewBox` comes back
 * as `viewbox`; laid over as returned, the element would carry both. An attribute the vnode does
 * not have (a nested host's markers) is added as the core names it.
 */
function changedAttrs(original: VNode, attrs: Readonly<Record<string, string | true>> | undefined) {
    const props = original.props ?? {};
    const own = new Map(Object.keys(props).map((name) => [name.toLowerCase(), name]));
    const changed: Record<string, string | true> = {};
    for (const [name, value] of Object.entries(attrs ?? {})) {
        const spelled = own.get(name.toLowerCase());
        const current: unknown = spelled === undefined ? undefined : props[spelled];
        if (spelled !== undefined && (current === value || (typeof current === 'number' && String(current) === value)))
            continue;
        changed[spelled ?? name] = value;
    }
    return changed;
}

/**
 * Turn the core's translated copy back into vnodes. An element with a `source` is a clone of the
 * original vnode at that index — handlers, refs, directives and key kept — with its translated
 * attributes laid over and its translated children in place, wherever the translation moved it.
 */
export function translatedToVNodes(nodes: readonly TranslatedNode[], elements: VNode[]): VNodeArrayChildren {
    return nodes.map((node) => {
        if ('text' in node) return node.text;
        if ('comment' in node) return createCommentVNode(node.comment);
        const original = node.source === undefined ? undefined : elements[node.source];
        // A nested <Phrase> renders and registers its own phrase.
        if (original?.type === Phrase) return cloneVNode(original);
        const children = translatedToVNodes(node.children ?? [], elements);
        // A <DontTranslate> renders itself around the content the core rendered for it: its source,
        // with a phrase's params filled. Its own slot would render the source again, unfilled.
        if (original?.type === DontTranslate) {
            const clone = cloneVNode(original, null, false);
            clone.children = { default: () => children };
            clone.shapeFlag |= SLOTS_CHILDREN;
            return clone;
        }
        if (!original) return h(node.tag, node.attrs ?? {}, children);
        const clone = cloneVNode(original, changedAttrs(original, node.attrs), false);
        clone.children = children;
        clone.shapeFlag = (clone.shapeFlag & ~TEXT_CHILDREN) | ARRAY_CHILDREN;
        // The children and attributes are the translation's, not what the compiler marked dynamic:
        // Vue diffs the clone in full. Kept, a TEXT flag patches the new children array as text.
        clone.patchFlag = BAIL;
        return clone;
    });
}
