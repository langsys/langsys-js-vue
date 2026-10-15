import { defineComponent, h, onActivated, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';
import type { PropType, VNode } from 'vue';
import {
    PHRASE_MARKER_ATTR,
    Phrase as VanillaPhrase,
    registerBlock,
    renderBlock,
    warnUnrenderedBlock,
    warnUnregistered,
    type BlockNode,
    type ParamPrimitive,
} from 'langsys-js-typescript';
import { UNREGISTERED_REASON, slotToBlockNodes, translatedToVNodes } from '../block-vnodes.js';
import { serverScope, useT } from '../composables.js';

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
        /** The request scope this render serves, on a server; null in the browser. */
        const scope = serverScope();
        let instance: VanillaPhrase | undefined;
        /** The phrase host as the core's tree, from the last render; null when the slot fell back. */
        let tree: BlockNode[] | null = null;
        /** A slot holding a compiled variable (VAR-7): rendered from the catalog, never registered, no DOM class. */
        let unregistered = false;
        /** The tree last registered, serialized: a re-render that changed the slot registers again. */
        let registered: string | null = null;

        // Fallback: a slot the tree cannot express (a component, v-html) is handled by the core's
        // DOM class after mount, as before.
        const create = () => {
            if (!host.value || tree || unregistered) return;
            instance?.destroy();
            instance = new VanillaPhrase(host.value, { category: props.category, params: props.params });
        };
        // The tree path registers on mount, whenever `t` changes, and after an update that changed
        // the tree (see `sync`), since rendering registers nothing.
        const register = () => {
            // A block `<KeepAlive>` has taken out of the page records nothing (HINT-13); it registers
            // again when it is back (`onActivated`).
            if (!host.value?.isConnected || !tree) return;
            registered = JSON.stringify(tree);
            // Claims the host, as a read for a compiled variable; returned for Vue's errorHandler (see <Translate>).
            return registerBlock(tree, {
                category: props.category,
                params: props.params,
                host: host.value,
                ...(unregistered ? { register: false } : {}),
            });
        };
        // After a re-render the slot may have changed path or content (see <Translate>).
        const sync = () => {
            if (tree || unregistered) {
                instance?.destroy();
                instance = undefined;
                if (tree && JSON.stringify(tree) !== registered) return register();
            } else if (!instance) create();
        };

        onMounted(() => (tree ? register() : create()));
        onUpdated(sync);
        onActivated(register);
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
                // Raw HTML or a component alone falls back to the DOM class; beside a compiled
                // variable, the block is served as written and registers nothing (VAR-7).
                unregistered = converted.variable;
                tree = null;
                if (unregistered) warnUnregistered(UNREGISTERED_REASON);
                else warnUnrenderedBlock(converted.reason);
                return h(props.tag, { ref: host, [PHRASE_MARKER_ATTR]: '' }, slot);
            }
            // The phrase is its host's content: render it as a phrase-marked host, the unit the
            // core translates as one rich phrase, and put that host's translated children here.
            const phrase: BlockNode[] = [
                { tag: props.tag, attrs: { [PHRASE_MARKER_ATTR]: '' }, children: converted.nodes },
            ];
            // A compiled value inside an excluded element is one empty markup pair in the phrase
            // (TOK-1), so it is no variable here: the phrase registers.
            unregistered = converted.variable;
            if (unregistered) warnUnregistered(UNREGISTERED_REASON);
            tree = phrase;
            const opts = { category: props.category, params: props.params };
            // On a server, inside the request scope, provided or entered (see <Translate>).
            const [rendered] = (
                scope
                    ? scope.run(() => {
                          if (!unregistered) registerBlock(phrase, opts);
                          return renderBlock(phrase, opts);
                      })
                    : renderBlock(phrase, opts)
            ).nodes;
            const element = rendered && 'tag' in rendered ? rendered : null;
            const children = element
                ? // The wrapper is source 0, so the slot's elements start at 1.
                  translatedToVNodes(element.children, [null as unknown as VNode, ...converted.elements])
                : slot;
            // The host carries what the core set on the phrase host: a translation from the catalog
            // is marked resolved (GATE-10), so no DOM reader, on the client or in an enclosing
            // block's walk, files it as source.
            return h(props.tag, { ref: host, ...element?.attrs, [PHRASE_MARKER_ATTR]: '' }, [
                ...children,
                ...converted.teleports,
            ]);
        };
    },
});

export default Phrase;
