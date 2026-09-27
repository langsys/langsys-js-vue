# SSR Usage Guide

This guide shows how to server-render translated pages with `langsys-js-vue`, in Nuxt or plain Vite SSR.

## How it works

A server process renders pages for many visitors at once, often in different locales. So every request renders inside its own **request scope** from the base SDK. A scope has its own locale, its own view of the catalog, its own list of phrases the render missed, and its own hydration seed. Concurrent requests in different locales never see each other's text. The catalog for a locale is fetched at most once per request and shared read-only between concurrent requests in that locale.

Around each request:

1. **Open** a scope for the request's locale: `createRequestScope({ locale, url })`.
2. **Render** inside it. `useT()`, `useCurrentLocale()` and `useTranslations()` read the scope.
3. **Hand off** `scope.seed()` in the page payload. On the client, call `LangsysApp.seedCatalog(seed.catalog, seed.locale)` **before the app mounts**, so the first client render matches the served HTML.
4. **Close** the scope once the response is sent: `await scope.close()`. With a key that may write and `ssrTokenStrategy: 'server'`, this registers the phrases the render missed; otherwise the browser discovers them after hydration.

The seed must be synchronous. `seedCatalog()` returns nothing and needs no `await`. `LangsysApp.init({ initialTranslations })` is not a substitute: `init()` applies it only after its authorization round trip, and by then the first client render has happened.

The server helpers live in a server-only entry, `langsys-js-vue/server`, which never reaches a browser bundle.

## Server setup

Initialize the SDK once per server process, with a server-only key:

```typescript
// server/plugins/langsys.ts (Nuxt: a Nitro plugin; plain Vite SSR: your server entry)
import { LangsysApp, createLocaleStore } from 'langsys-js-vue';

export default defineNitroPlugin(() => {
    const config = useRuntimeConfig();
    LangsysApp.init({
        projectid: config.langsysProjectId,
        key: config.langsysApiKey, // server-only
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        ssrTokenStrategy: 'server', // register what a render misses, when the scope closes
    });
});
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
    runtimeConfig: {
        langsysProjectId: '', // NUXT_LANGSYS_PROJECT_ID (server-only)
        langsysApiKey: '', // NUXT_LANGSYS_API_KEY (server-only)
        public: {
            langsysProjectId: '', // NUXT_PUBLIC_LANGSYS_PROJECT_ID
            langsysApiKey: '', // NUXT_PUBLIC_LANGSYS_API_KEY (read-only key)
        },
    },
});
```

## Nuxt

A Nuxt plugin runs inside a render Nuxt has already started, so it cannot wrap that render. It hands the request's scope to that request's Vue app with `provideRequestScope`, and every component in the app reads it:

```typescript
// plugins/langsys.server.ts
import { createRequestScope, installRequestScopes, provideRequestScope } from 'langsys-js-vue/server';

export default defineNuxtPlugin(async (nuxtApp) => {
    installRequestScopes();
    const event = nuxtApp.ssrContext!.event;
    const locale = resolveLocale(event); // your locale resolution: URL, cookie, Accept-Language
    const scope = await createRequestScope({ locale, url: getRequestURL(event).href });

    provideRequestScope(nuxtApp.vueApp, scope);
    nuxtApp.payload.langsys = scope.seed();
    event.node.res.on('finish', () => void scope.close());
});
```

```typescript
// plugins/langsys.client.ts
import { LangsysApp, refToLocaleSource } from 'langsys-js-vue';

export default defineNuxtPlugin((nuxtApp) => {
    const seed = nuxtApp.payload.langsys as { locale: string; catalog: object } | undefined;
    if (seed) LangsysApp.seedCatalog(seed.catalog, seed.locale); // before the app mounts

    const config = useRuntimeConfig();
    const locale = useState('locale', () => seed?.locale ?? 'en');
    nuxtApp.hook('app:mounted', () => {
        LangsysApp.init({
            projectid: config.public.langsysProjectId,
            key: config.public.langsysApiKey, // read-only key on the client
            UserLocaleStore: refToLocaleSource(locale),
            baseLocale: 'en',
        });
    });
});
```

Do not call `scope.enter()` from a Nuxt plugin. `enter()` makes a scope current for the rest of the async context it is called in, and a plugin is an async function Nuxt awaits: entered after the plugin's own `await`, it does not isolate the request, and under concurrent requests an Italian page can render German. `provideRequestScope` uses Vue's per-app injection instead, so a request's app can only ever see its own scope. `enter()` is safe only in the function that goes on to render, before the render starts — never in a helper that function awaits, where it sets the scope for the helper alone.

Use translations in components as usual:

```vue
<script setup lang="ts">
import { useT } from 'langsys-js-vue';

const t = useT();
</script>

<template>
    <h1>{{ t('Welcome', 'HomePage') }}</h1>
    <p>{{ t('Hello, {name}!', 'HomePage', { name: 'Sarah' }) }}</p>
</template>
```

## Plain Vite SSR

When your server calls `renderToString` itself, render inside the scope with `renderInRequestScope`:

```typescript
// server entry
import { createSSRApp } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { renderInRequestScope } from 'langsys-js-vue/server';

app.get('*', async (req, res) => {
    const { result: html, scope } = await renderInRequestScope({ locale: localeOf(req), url: req.originalUrl }, () =>
        renderToString(createSSRApp(App))
    );
    res.send(page(html, JSON.stringify(scope.seed())));
    res.on('finish', () => void scope.close());
});
```

```typescript
// client entry
import { LangsysApp } from 'langsys-js-vue';

const seed = window.__LANGSYS__; // the seed you serialized into the page
if (seed) LangsysApp.seedCatalog(seed.catalog, seed.locale);
app.mount('#app');
LangsysApp.init({/* … read-only key … */});
```

## Locale switching

On the client, write to the same locale state the SDK was initialized with; the SDK reacts and fetches the new locale's translations:

```vue
<script setup lang="ts">
import { LangsysApp } from 'langsys-js-vue';

const locale = useState<string>('locale');

function changeLocale(next: string) {
    locale.value = next;
    return LangsysApp.translationsLoadingPromise; // optional: await the in-flight fetch
}
</script>

<template>
    <select :value="locale" @change="changeLocale(($event.target as HTMLSelectElement).value)">
        <option value="en">English</option>
        <option value="es">Español</option>
        <option value="fr">Français</option>
    </select>
</template>
```

## What server rendering covers

- The served bytes carry the request locale's translations for everything rendered through `useT()`, `<Translate>` and `<Phrase>`, so crawlers index the translated page, and concurrent requests in different locales each get their own. Every `<Translate>` host carries its block id (`data-ls-contentblock`).
- The first client render matches the served HTML, with no duplicate catalog fetch and no flash of untranslated `useT()` text.
- `useCurrentLocale()` and `useTranslations()`, and the raw `currentlyLoadedLocale` and `sTranslations` signals, read the request's scope on the server.

Limits:

- **A block whose slot holds a component or `v-html` is served as source text.** The base SDK renders `<Translate>` and `<Phrase>` from their markup, and neither has markup to read until it renders. Such a block carries only an explicit `custom_id` in the served HTML, is translated in the browser after mount, and the base SDK logs a warning once per reason.

## `ssrTokenStrategy`

Decides what happens to the phrases a server render missed when its scope closes:

- `'server'` — registered from the server, when the key may write.
- `'auto'` — registered from the server when there are fewer than 5; otherwise left to the browser.
- `'client'` (default) — left to the browser, which discovers them after hydration.

## Troubleshooting

### Hydration mismatch warnings

- Seed the client with `scope.seed()` from the same request, **synchronously, before mount** — `seedCatalog()`, not `init({ initialTranslations })`.
- Make sure the client's initial locale state matches the seed's locale.

### A page renders another visitor's language

- In Nuxt, hand the scope to the app with `provideRequestScope`; do not call `scope.enter()` from a plugin.
- In plain Vite SSR, render inside `renderInRequestScope`; if you call `scope.enter()` yourself, call it in the function that renders, never in a helper that function awaits.

### TypeScript errors on `t()`

- Placeholders are compile-time-checked: `t('Hello, {name}!', 'Cat')` _requires_ a params object with `name`. Either add the key or remove the placeholder.
- Allowed param value types: `string | number | Date | boolean`.
