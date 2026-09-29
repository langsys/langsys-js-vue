import { AsyncLocalStorage } from 'node:async_hooks';
import type { App } from 'vue';
import {
    clearSharedCatalogs,
    createRequestScope,
    currentRequestScope,
    setRequestScopeStorage,
    type RequestScope,
    type RequestScopeOptions,
    type RequestSeed,
} from 'langsys-js-typescript';

/**
 * `langsys-js-vue/server` — server rendering through the base SDK's request scope (SRV-7).
 *
 * Each request renders inside its own scope: its own locale, its own view of the catalog, its
 * own missing-phrase collection and its own hydration seed, so concurrent requests in different
 * locales never see each other's text. The scope is the base SDK's; this entry wires Vue's
 * per-request rendering to it and keeps no request state of its own.
 *
 * Server-only: it imports `node:async_hooks`, so it is a separate entry that never reaches a
 * browser bundle.
 */

/** Must equal `REQUEST_SCOPE_KEY` in the main entry; `Symbol.for` makes the two bundles agree. */
const REQUEST_SCOPE_KEY = Symbol.for('langsys-js-vue.requestScope');

let installed = false;

/**
 * Give the base SDK the async-context storage it resolves the current scope from, so a render
 * that awaits (async `setup`, `serverPrefetch`, `<Suspense>`) still reads its own request's
 * scope afterwards, and so `scope.enter()` works. Idempotent; the helpers below call it.
 */
export function installRequestScopes(): void {
    if (installed) return;
    setRequestScopeStorage(new AsyncLocalStorage());
    installed = true;
}

/**
 * Hand a request's scope to that request's Vue app, so its components translate from the scope
 * wherever the render runs — for a framework whose render this code cannot wrap, such as a Nuxt
 * server plugin, which runs inside a render Nuxt has already started. Uses Vue's own per-app
 * injection, so it needs no async-context tracking and cannot reach another request's app.
 */
export function provideRequestScope(app: App, scope: RequestScope): void {
    app.provide(REQUEST_SCOPE_KEY, scope);
}

/**
 * Open a scope for one request and run `render` inside it — for a server that calls
 * `renderToString` itself, as plain Vite SSR does. Write `scope.seed()` into the page for
 * `LangsysApp.seedCatalog()` before hydration, and `await scope.close()` once the response
 * has been sent.
 */
export async function renderInRequestScope<T>(
    options: RequestScopeOptions,
    render: (scope: RequestScope) => Promise<T>
): Promise<{ result: T; scope: RequestScope }> {
    installRequestScopes();
    const scope = await createRequestScope(options);
    const result = await scope.run(() => render(scope));
    return { result, scope };
}

export {
    clearSharedCatalogs,
    createRequestScope,
    currentRequestScope,
    setRequestScopeStorage,
    type RequestScope,
    type RequestScopeOptions,
    type RequestSeed,
};
