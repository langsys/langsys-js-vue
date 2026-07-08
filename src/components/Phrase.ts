import { defineComponent, h, onBeforeUnmount, onMounted, ref, watch } from 'vue';
import type { PropType } from 'vue';
import { PHRASE_MARKER_ATTR, Phrase as VanillaPhrase } from 'langsys-js-typescript';

/**
 * Props for the Vue `Phrase` component. Mirrors the React/Svelte components —
 * `class` flows through native attribute fallthrough.
 */
export interface PhraseProps {
    /** Category the phrase registers under (disambiguation for translators). */
    category?: string;
    /** Interpolation params — `{n}` for pluralization, `{name}`, etc. */
    params?: Record<string, unknown>;
    /** Host element tag. Defaults to `<span>`. */
    tag?: string;
}

/**
 * Vue wrapper around the vanilla `Phrase` rich-text handler.
 *
 * Use it to keep a markup-bearing run as ONE translatable phrase — e.g. so a
 * count variable stays next to the noun it pluralizes:
 *
 *   <Phrase category="ProductCard" :params="{ n: reviewCount }">
 *     Based on {n} <strong>reviews</strong>
 *   </Phrase>
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
        params: { type: Object as PropType<Record<string, unknown>>, default: () => ({}) },
        tag: { type: String, default: 'span' },
    },
    setup(props, { slots }) {
        const host = ref<HTMLElement | null>(null);
        let instance: VanillaPhrase | undefined;

        const create = () => {
            if (!host.value) return;
            instance?.destroy();
            instance = new VanillaPhrase(host.value, { category: props.category, params: props.params });
        };

        onMounted(create);
        // Recreate only when the category changes; param changes flow through setParams below.
        watch(() => props.category, create);
        watch(
            () => props.params,
            (params) => instance?.setParams(params),
            { deep: true }
        );
        onBeforeUnmount(() => {
            instance?.destroy();
            instance = undefined;
        });

        return () => h(props.tag, { ref: host, [PHRASE_MARKER_ATTR]: '' }, slots.default?.());
    },
});

export default Phrase;
