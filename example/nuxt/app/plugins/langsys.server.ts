import { createRequestScope, installRequestScopes, provideRequestScope } from 'langsys-js-vue/server';

// One request scope per request, handed to this request's Vue app. The seed is written after the
// render, since the render is what records the blocks it holds; the scope sends what the render
// missed once the response is out.
export default defineNuxtPlugin(async (nuxtApp) => {
    await (globalThis as Record<string, unknown>).__langsysReady;
    installRequestScopes();
    const event = useRequestEvent(nuxtApp)!;
    const url = useRequestURL();
    const scope = await createRequestScope({ locale: url.searchParams.get('lang') ?? 'en', url: url.href });
    provideRequestScope(nuxtApp.vueApp, scope);
    nuxtApp.hook('app:rendered', () => {
        nuxtApp.payload.langsys = scope.seed();
    });
    event.node.res.on('finish', () => void scope.close());
});
