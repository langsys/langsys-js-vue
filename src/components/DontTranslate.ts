import { defineComponent, h } from 'vue';

/**
 * Props for the Vue `DontTranslate` component. Mirrors the React/Svelte
 * components — `class` flows through native attribute fallthrough.
 */
export interface DontTranslateProps {
    /** Host element tag. Defaults to `<span>`. */
    tag?: string;
}

/**
 * Marks a region as never-translated, preserved verbatim:
 *
 *   Built with <DontTranslate>Kangen®</DontTranslate> on
 *   <DontTranslate>langsys.dev</DontTranslate>
 *
 * The host carries the standard `translate="no"` attribute, which both the
 * tokenizer and the renderer in the base SDK already honor — so its content is
 * never tokenized, registered, or replaced. Pure presentational glue; no
 * vanilla handler needed.
 */
export const DontTranslate = defineComponent({
    name: 'DontTranslate',
    props: {
        tag: { type: String, default: 'span' },
    },
    setup(props, { slots }) {
        return () => h(props.tag, { translate: 'no', 'data-ls-dont-translate': '' }, slots.default?.());
    },
});

export default DontTranslate;
