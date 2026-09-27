import { defineComponent, h, inject, onBeforeUnmount, onMounted, provide, ref, watch } from 'vue';
import type { PropType, VNode } from 'vue';
import {
    PHRASE_MARKER_ATTR,
    Phrase as VanillaPhrase,
    registerBlock,
    renderBlock,
    warnUnrenderedBlock,
    type BlockNode,
    type ParamPrimitive,
} from 'langsys-js-typescript';
import { FALLBACK_ANCESTOR, slotToBlockNodes, translatedToVNodes } from '../block-vnodes.js';
import { useT } from '../composables.js';

/**
 * Props for the Vue `Phrase` component. Mirrors the React/Svelte components —
 * `class` flows through native attribute fallthrough.
 */
export interface PhraseProps {
    /** Category the phrase registers under (disambiguation for translators). */
    category?: string;
    /** Interpolation params. Write placeholders as `%n%` / `%name%` in the markup — the portable form (see the note on the component). */
    params?: Record<string, ParamPrimitive>;
    /** Host element tag. Defaults to `<span>`. */
    tag?: string;
}

/**
 * A markup-bearing run translated as ONE phrase, rendered through the base SDK's block renderer
 * on the server and in the browser alike (a slot holding a component or `v-html` falls back to the
 * core's DOM class after mount).
 *
 * Use it to keep a markup-bearing run as ONE translatable phrase — e.g. so a
 * count variable stays next to the noun it pluralizes:
 *
 *   <Phrase category="ProductCard" :params="{ n: reviewCount }">
 *     Based on %n% <strong>reviews</strong>
 *   </Phrase>
 *
 * Write placeholders as `%n%`, not `{{ n }}`: Vue's template compiler
 * substitutes `{{ n }}` before the SDK ever sees the text, so the placeholder
 * is gone by mount and `params` silently does nothing (debug mode warns). A
 * bare `{n}` does survive in Vue — Vue only consumes `{{ }}` — but `%n%` is
 * the portable form the React/Svelte bindings require, where a literal `{n}`
 * is eaten by the compiler. The SDK normalizes `%n%` to canonical `{n}` at
 * capture, so translators only ever see `{n}` either way.
 *
 * The inline markup never reaches the translator — it's replaced with neutral
 * tokens and the real elements are reconstituted at render (see richtext.ts in
 * the base SDK). The host carries `data-ls-phrase` so a wrapping `<Translate>`
 * skips it and lets this handler own it.
 *
 * Keep children static (literal markup): the handler takes over the rendered
 * subtree. For values Vue owns and re-renders, pass them through `params`.
 */
export const Phrase = defineComponent({
    name: 'Phrase',
    props: {
        category: { type: String, default: '' },
        params: { type: Object as PropType<Record<string, ParamPrimitive>>, default: () => ({}) },
        tag: { type: String, default: 'span' },
    },
    setup(props, { slots }) {
        const host = ref<HTMLElement | null>(null);
        const t = useT();
        const ancestor = inject(FALLBACK_ANCESTOR, null);
        const mode = { owns: false };
        provide(FALLBACK_ANCESTOR, mode);
        let instance: VanillaPhrase | undefined;
        /** The phrase host as the core's tree, from the last render; null when the slot fell back. */
        let tree: BlockNode[] | null = null;

        // Fallback: a slot the tree cannot express (a component, v-html) is handled by the core's
        // DOM class after mount, as before.
        const create = () => {
            if (!host.value || tree) return;
            instance?.destroy();
            instance = new VanillaPhrase(host.value, { category: props.category, params: props.params });
        };
        // The tree path registers on mount and whenever `t` changes, since rendering registers nothing.
        const register = () => {
            // An ancestor that fell back to the DOM class registers this block with its own walk.
            if (ancestor?.owns) return;
            if (host.value && tree)
                registerBlock(tree, { category: props.category, params: props.params, host: host.value });
        };

        onMounted(() => (tree ? register() : create()));
        watch(t, register, { flush: 'post' });
        watch(
            () => props.category,
            () => (tree ? register() : create())
        );
        watch(
            () => props.params,
            (params) => instance?.setParams(params),
            { deep: true }
        );
        onBeforeUnmount(() => {
            instance?.destroy();
            instance = undefined;
        });

        return () => {
            void t.value; // re-render when the catalog or locale changes
            const slot = slots.default?.() ?? [];
            const converted = slotToBlockNodes(slot);
            if (!converted.ok) {
                mode.owns = true;
                tree = null;
                warnUnrenderedBlock(converted.reason);
                return h(props.tag, { ref: host, [PHRASE_MARKER_ATTR]: '' }, slot);
            }
            // The phrase is its host's content: render it as a phrase-marked host, the unit the
            // core translates as one rich phrase, and put that host's translated children here.
            mode.owns = false;
            tree = [{ tag: props.tag, attrs: { [PHRASE_MARKER_ATTR]: '' }, children: converted.nodes }];
            const [rendered] = renderBlock(tree, { category: props.category, params: props.params }).nodes;
            const children =
                rendered && 'tag' in rendered
                    ? // The wrapper is source 0, so the slot's elements start at 1.
                      translatedToVNodes(rendered.children, [null as unknown as VNode, ...converted.elements])
                    : slot;
            return h(props.tag, { ref: host, [PHRASE_MARKER_ATTR]: '' }, [...children, ...converted.teleports]);
        };
    },
});

export default Phrase;
