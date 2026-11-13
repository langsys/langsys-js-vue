import { computed, inject, provide, type ComputedRef, type InjectionKey } from 'vue';

/**
 * The category a `<Translate>` or `<Phrase>` renders and registers under, and the one its content
 * was registered under before it moved (MOVE-1): absent or `null` when it did not move, `''` when
 * it had no category before.
 */
export interface UnitCategory {
    category: string;
    previousCategory?: string | null;
}

/** What a unit hands the units nested in it: its own resolved category and previous category. */
const BLOCK_CATEGORY: InjectionKey<ComputedRef<UnitCategory>> = Symbol.for('langsys-js-vue.block-category');

/**
 * A unit's category and previous category, given what it names itself, provided to the units
 * nested in it (MOVE-4).
 *
 * A unit that names no category (the prop is absent) takes the enclosing unit's category and,
 * unless it names a previous category of its own, that unit's previous category: it moved with the
 * block. One that names its own category, `''` included, takes neither, and moved only if it names
 * its own previous category. A unit outside any block, naming none, has no category (`''`).
 *
 * The block's tree carries a nested `<Phrase>` the same way (`phraseHost` in `block-vnodes.ts`), so
 * the core's walk of the block's nested hosts and the `<Phrase>` the block re-emits register it
 * alike. A unit nested in a block that falls back to the core's DOM class registers itself, with
 * this.
 */
export function useUnitCategory(named: {
    readonly category?: string;
    readonly previousCategory?: string | null;
}): ComputedRef<UnitCategory> {
    const outer = inject(BLOCK_CATEGORY, undefined);
    const resolved = computed<UnitCategory>(() => resolveUnitCategory(named, outer?.value));
    provide(BLOCK_CATEGORY, resolved);
    return resolved;
}

/** The resolution `useUnitCategory` applies, given the enclosing unit's (MOVE-4). */
export function resolveUnitCategory(
    named: { readonly category?: string; readonly previousCategory?: string | null },
    outer: UnitCategory | undefined
): UnitCategory {
    if (named.category !== undefined || !outer)
        return { category: named.category ?? '', previousCategory: named.previousCategory };
    return { category: outer.category, previousCategory: named.previousCategory ?? outer.previousCategory };
}
