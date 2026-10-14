import { defineComponent, h, onActivated, onBeforeUnmount, onMounted, onUpdated, ref, watch } from 'vue';
import type { PropType } from 'vue';
import {
    CONTENT_BLOCK_MARKER_ATTR,
    Translate as VanillaTranslate,
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
 * Props for the Vue `Translate` component. Mirrors the React/Svelte components
 * 1:1 — Vue passes `class` through native attribute fallthrough, so no
 * `class`/`className` prop is declared.
 */
export interface TranslateProps {
    /** Optional category under which tokens are registered. Helps translators disambiguate. */
    category?: string;
    /** Optional stable id for the content block. If omitted, the SDK hashes category + tokens. */
    custom_id?: string;
    /** Optional human-readable label shown in the Translation Manager. */
    label?: string;
    /** Host element tag. Defaults to a `<translate>` custom element. */
    tag?: string;
    /**
     * Interpolation params for `{name}`-style placeholders in the content —
     * same single-brace syntax as `t()`. In markup, author the placeholders as
     * `%name%` (the base SDK normalizes `%name%` → `{name}` at capture); a bare
     * `{name}` also works in Vue templates but collides with `{{ }}` and other
     * frameworks, so `%name%` is the portable form.
     */
    params?: Record<string, ParamPrimitive>;
}

/**
 * A content block: its slot is translated as one unit by the base SDK's block renderer.
 *
 * The render converts the slot into the core's block tree, renders it with `renderBlock` over
 * the active catalog (a request scope's on the server, the page's in the browser) and stamps
 * the host attributes it returns, so served HTML carries the translation and the block's id and
 * hydration finds the same bytes. It re-renders when the catalog or locale changes, and
 * registers the block on mount and after each change. Tokenization, identity, interpolation and
 * `%name%`→`{name}` normalization all live in the base SDK.
 *
 * A slot holding a component or `v-html` has no markup to read until it renders, so it falls
 * back: served as source with only an explicit `custom_id` stamped, and handled by the core's
 * DOM class after mount. For dynamic per-string values that Vue owns, use `useT()` instead.
 */
export const Translate = defineComponent({
    name: 'Translate',
    props: {
        category: { type: String, default: '' },
        custom_id: { type: String, default: '' },
        label: { type: String, default: '' },
        tag: { type: String, default: 'translate' },
        params: { type: Object as PropType<Record<string, ParamPrimitive>>, default: undefined },
    },
    setup(props, { slots }) {
        const host = ref<HTMLElement | null>(null);
        const t = useT();
        /** The request scope this render serves, on a server; null in the browser. */
        const scope = serverScope();
        let instance: VanillaTranslate | undefined;
        /** What the last render converted: the block as the core's tree, or null when the slot fell back. */
        let tree: BlockNode[] | null = null;
        /** A slot holding a compiled variable (VAR-7): rendered from the catalog, never registered, no DOM class. */
        let unregistered = false;
        /** The tree last registered, serialized: a re-render that changed the slot registers again. */
        let registered: string | null = null;

        const options = () => ({
            category: props.category,
            label: props.label,
            params: props.params,
            ...(props.custom_id ? { id: props.custom_id } : {}),
        });

        // Fallback: a slot the tree cannot express (a component, v-html) is walked by the core's
        // DOM class after mount, as before.
        const create = () => {
            if (!host.value || tree || unregistered) return;
            instance?.destroy();
            instance = new VanillaTranslate(host.value, {
                category: props.category,
                custom_id: props.custom_id,
                label: props.label,
                params: props.params,
            });
        };
        // The tree path registers on mount, again whenever `t` changes — a locale or catalog
        // change, or a navigation (HINT-13) — and after an update that changed the tree (see
        // `sync`), since rendering registers nothing.
        const register = () => {
            // A block `<KeepAlive>` has taken out of the page records nothing (HINT-13); it registers
            // again when it is back (`onActivated`).
            if (!host.value?.isConnected || !tree) return;
            registered = JSON.stringify(tree);
            // Handing the core the host claims it, so the DOM class of a block this one is nested in
            // never takes it over with that block's params. A slot holding a compiled variable
            // (VAR-7) hands it over as a read: `register: false` registers nothing. Returned, so Vue
            // hands a rejection (an unconfigured client under `requireCredentials`) to the app's
            // errorHandler, from this component.
            return registerBlock(tree, {
                ...options(),
                host: host.value,
                ...(unregistered ? { register: false } : {}),
            });
        };
        // After a re-render the slot may have changed path or content: a slot that now converts
        // drops the DOM class and registers its new tree; one that now falls back gets the DOM class.
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
            () => [props.category, props.custom_id, props.label],
            () => (tree ? register() : create()),
            {
                flush: 'post',
            }
        );
        watch(
            () => props.params,
            (params) => instance?.setParams(params),
            { deep: true }
        );
        onBeforeUnmount(() => instance?.destroy());

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
                return h(
                    props.tag,
                    { ref: host, ...(props.custom_id ? { [CONTENT_BLOCK_MARKER_ATTR]: props.custom_id } : {}) },
                    slot
                );
            }
            const nodes = converted.nodes;
            unregistered = converted.variable;
            if (unregistered) warnUnregistered(UNREGISTERED_REASON);
            tree = nodes;
            // On a server, render and register inside the request scope, which may have been provided
            // to the app rather than entered (Nuxt): the core renders over its catalog, defers the
            // registration to `close()` and marks the block collected in the seed, so the client
            // never sends it again (SRV-3).
            const rendered = scope
                ? scope.run(() => {
                      if (!unregistered) registerBlock(nodes, options());
                      return renderBlock(nodes, options());
                  })
                : renderBlock(nodes, options());
            return h(props.tag, { ref: host, ...rendered.hostAttrs }, [
                ...translatedToVNodes(rendered.nodes, converted.elements),
                ...converted.teleports,
            ]);
        };
    },
});

export default Translate;
