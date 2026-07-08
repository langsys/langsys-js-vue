import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import { Translate as VanillaTranslate } from 'langsys-js-typescript';

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
 * harvesting, and re-translation lifecycle all live in the base SDK.
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
            });
        };

        onMounted(create);
        watch(() => [props.category, props.custom_id, props.label], create);
        onBeforeUnmount(() => instance?.destroy());

        return () => h(props.tag, { ref: host }, slots.default?.());
    },
});

export default Translate;
