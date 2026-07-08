import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { Translate as VanillaTranslate, type ParamPrimitive } from 'langsys-js-typescript';

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
 * Vue wrapper around the vanilla `Translate` DOM class from
 * `langsys-js-typescript`. It renders a host element, then on mount lets the
 * vanilla class walk and tokenize the rendered children (text nodes plus
 * translatable attributes), register the content block, and re-translate on
 * locale change. On unmount it tears the instance down.
 *
 * This is the Vue analog of the React/Svelte `<Translate>` components — pure
 * mount/destroy glue. The DOM walking, content-block registration, attribute
 * harvesting, `%name%`→`{name}` normalization, and re-translation lifecycle all
 * live in the base SDK.
 *
 * The SDK mutates the rendered DOM in place, so keep the children static:
 * prose, marketing copy, CMS-rendered HTML — the content-block use case. For
 * dynamic per-string values that Vue owns and re-renders, use `useT()` instead.
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
        let instance: VanillaTranslate | undefined;

        const create = () => {
            if (!host.value) return;
            instance?.destroy();
            instance = new VanillaTranslate(host.value, {
                category: props.category,
                custom_id: props.custom_id,
                label: props.label,
                params: props.params,
            });
        };

        onMounted(create);
        watch(() => [props.category, props.custom_id, props.label], create);
        // Param changes (e.g. a changed count) flow through setParams without recreating.
        watch(
            () => props.params,
            (params) => instance?.setParams(params),
            { deep: true }
        );
        onBeforeUnmount(() => instance?.destroy());

        return () => h(props.tag, { ref: host }, slots.default?.());
    },
});

export default Translate;
