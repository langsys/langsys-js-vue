import { notifyNavigation } from 'langsys-js-typescript';

/**
 * The part of a Vue Router instance this binding uses. Typed structurally so the package
 * takes no dependency on `vue-router`: any router with an after-navigation hook fits.
 */
export interface NavigationSource {
    afterEach(guard: (to: unknown, from: unknown, failure?: unknown) => unknown): () => void;
}

/**
 * HINT-13 — tell the core about every completed route change.
 *
 * The core records a discovery miss against the URL current at the moment `t()` runs, and a
 * component re-runs `t()` only when something it depends on changes. A layout that stays
 * mounted across a navigation — a header, a nav, a footer, or a child of a route component
 * that vue-router reuses when only a param changes — depends on nothing the route changed,
 * so without this it would never record a miss at the new URL. `notifyNavigation()` publishes
 * a fresh `t`, which every `useT()` consumer and every mounted `<Translate>` / `<Phrase>`
 * re-enters.
 *
 * Vue Router runs `afterEach` once the URL has moved, so the re-entry records at the new
 * URL. A failed or aborted navigation left the URL where it was, and is skipped.
 *
 * ```ts
 * const router = createRouter({ … });
 * syncNavigation(router);
 * ```
 *
 * Returns the hook's remover. With a different router, call `notifyNavigation()` from its
 * after-navigation hook instead.
 */
export function syncNavigation(router: NavigationSource): () => void {
    return router.afterEach((_to, _from, failure) => {
        if (!failure) notifyNavigation();
    });
}

export { notifyNavigation };
