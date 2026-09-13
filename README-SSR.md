# SSR Usage Guide (Nuxt)

This guide shows how to use `langsys-js-vue` with Server-Side Rendering (SSR) to eliminate duplicate API calls and improve performance.

## The problem

In a traditional SSR flow:
1. The server fetches translations during render.
2. The client re-fetches the same translations after hydration.
3. Duplicate API calls, slower initial render, possible flash of untranslated content.

## The solution

Render with the catalog on the server, and hand the **same** catalog to the client **synchronously, before hydration**, with `LangsysApp.seedCatalog(translations, locale)`.

Two properties decide whether that works, and both are measured by this repo's tests rather than assumed:

- **The seed must be synchronous.** `useT()` reads the catalog at the moment a component renders, so whatever the catalog holds when the first client render happens is what that render shows — and hydration does not wait. `seedCatalog()` returns nothing and needs no `await`: call it before the app mounts and the first client render is byte-identical to the served HTML. **`LangsysApp.init({ initialTranslations })` is not a substitute.** `init()` applies `initialTranslations` only after its authorization round trip, so however fast that is, the first client render has already happened: called before mount, it leaves hydration to mismatch. `src/hydration-handoff-init.test.ts` pins both halves — the mismatch, and that `init()` does seed once the round trip resolves.
- **Seed both sides, with the same catalog.** A server that renders Italian and a client that hydrates unseeded disagree on the first render. So do the reverse.

> **The server-side seed is process-global.** This binding reads the base SDK's module-level catalog, so `seedCatalog()` on the server sets it for **every request that process is rendering** — not just yours. Two concurrent renders in different locales serve each other's text. That is measured, not hypothetical: an Italian and a German render interleaved across a single `await` both served German. Only server-render translated HTML with this binding where a process never renders two locales at the same time — a per-locale deployment, or rendering serialized. Request-scoped server rendering is not implemented in this binding; `CONFORMANCE.md` records it under SRV-1–SRV-5.

## Nuxt

### Step 1: Fetch translations on the server

Expose a server route that proxies the Langsys API using a **server-only** key (never ship the write key to the browser):

```typescript
// server/api/langsys.get.ts
import type { iCategories } from 'langsys-js-vue';

export default defineEventHandler(async (event) => {
    const config = useRuntimeConfig();
    const locale = getQuery(event).locale?.toString() ?? 'en';

    const res = await $fetch<{ data: iCategories }>(
        `https://api.langsys.dev/api/projects/${config.langsysProjectId}/translations`,
        {
            query: { locale },
            headers: { 'x-Authorization': config.langsysApiKey, 'Content-Type': 'application/json' },
        }
    );

    return { locale, translations: res.data };
});
```

```typescript
// nuxt.config.ts
export default defineNuxtConfig({
    runtimeConfig: {
        langsysProjectId: '', // NUXT_LANGSYS_PROJECT_ID (server-only)
        langsysApiKey: '',    // NUXT_LANGSYS_API_KEY (server-only)
        public: {
            langsysProjectId: '', // NUXT_PUBLIC_LANGSYS_PROJECT_ID
            langsysApiKey: '',    // NUXT_PUBLIC_LANGSYS_API_KEY (read-only key!)
        },
    },
});
```

### Step 2: Seed both sides, then initialize on the client

```vue
<!-- app.vue -->
<script setup lang="ts">
import { LangsysApp, refToLocaleSource } from 'langsys-js-vue';

// Runs on the server during SSR; the payload transfers to the client for free.
const { data } = await useAsyncData('langsys', () => $fetch('/api/langsys', { query: { locale: 'en' } }));

// Seed before anything renders — on the server AND on the client, with the same catalog.
// Synchronous by design: the first client render must match the served HTML.
// Read the process-global warning above before doing this on a server that renders
// more than one locale at a time.
if (data.value) LangsysApp.seedCatalog(data.value.translations, data.value.locale);

// Nuxt-owned locale state, adapted to the SDK's store contract.
const locale = useState('locale', () => data.value?.locale ?? 'en');

onMounted(() => {
    const config = useRuntimeConfig();
    // init() owns everything after the first paint — authorization, locale changes,
    // discovery. It will not re-seed a locale that is already seeded.
    LangsysApp.init({
        projectid: config.public.langsysProjectId,
        key: config.public.langsysApiKey, // read-only key on the client
        UserLocaleStore: refToLocaleSource(locale),
        baseLocale: 'en',
        ssrTokenStrategy: 'client',
    });
});
</script>

<template>
    <NuxtPage />
</template>
```

### Step 3: Use translations in any component

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

### Detecting the visitor's locale on the server

```typescript
// server/api/langsys.get.ts (variation)
import { LangsysApp } from 'langsys-js-vue';

const acceptLanguage = getHeader(event, 'accept-language');
const locale = LangsysApp.detectPreferredLocale(acceptLanguage) || 'en';
```

## Locale switching

Write to the same locale state the SDK was initialized with; the SDK reacts and fetches the new locale's translations:

```vue
<script setup lang="ts">
import { LangsysApp } from 'langsys-js-vue';

const locale = useState<string>('locale');

function changeLocale(next: string) {
    locale.value = next; // subscribers in the SDK trigger a fetch
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

> Keep one locale store for the app (created where you call `init`) and share it via `useState`/Pinia, rather than creating fresh stores in unrelated trees.

## Plain Vite SSR (no Nuxt)

The same hand-off works with any Vue SSR setup. In your server entry, call `LangsysApp.seedCatalog(translations, locale)` before `renderToString`, and serialize `{ locale, translations }` into the page payload. In your client entry, read that payload and call `LangsysApp.seedCatalog(translations, locale)` **before** `app.mount()`. Call `LangsysApp.init(...)` afterwards for everything after the first paint. The process-global warning above applies to the server entry.

## What this buys you — and what it does not

With the catalog seeded on both sides:

- No duplicate catalog fetch on hydration.
- The first client render matches the served HTML, so there is no hydration mismatch and no flash of untranslated `useT()` text.
- The served bytes carry translated `useT()` text, so crawlers index the translated page.

Not yet, and worth knowing before you rely on it:

- **`<Translate>` and `<Phrase>` serve base language.** Their translation runs in the base SDK's DOM classes, which only run when a component mounts. Served HTML carries the source text and the client translates it after hydration. `<Translate>` with an explicit `custom_id` does carry its identity (`data-ls-contentblock`) in the served HTML; a block with a derived id does not.
- **Mixed-locale concurrency leaks.** See the process-global warning above.

## Configuration options

### SSR token strategy

```typescript
{ ssrTokenStrategy: 'client' | 'server' | 'auto' }
```

- `'client'` (default) — queue tokens, send from client after hydration.
- `'server'` — send tokens immediately from server.
- `'auto'` — small batches (≤5) from server, larger batches from client.

### Debug mode

```typescript
{ debug: true, initialTranslations: translations, initialTranslationsLocale: locale }
```

Look for:
- `SSR initial translations config:` on init — confirms pre-fetched data is detected.
- `Using pre-fetched translations for locale` — confirms the initial fetch was skipped.
- `Locale change detected!` — fires on a subsequent locale switch.

## Important notes

1. **`initialTranslations` is not the hand-off.** It is consumed at `init()`, which is asynchronous, so it cannot seed the first client render. Use `seedCatalog()` for that. Locale changes after init go through the normal fetch path.
2. **Matching locales.** Always provide `initialTranslationsLocale` with `initialTranslations` so the SDK knows what locale the data represents.
3. **Data format.** The translations payload must match the `iCategories` shape returned by `LangsysAppAPI.getTranslations()`.
4. **Cache.** The 60-second locale cache still applies. Pre-fetched translations count as cached.
5. **Token creation.** Use a read-only API key for the client in production — missing tokens won't be sent. Keep the write key on the server (and ideally pre-populate tokens via your local dev environment).
6. **Seed, then init.** `seedCatalog()` is the hand-off: synchronous, on both sides, before anything renders. `LangsysApp.init` belongs in `onMounted` (client-only) and owns everything after the first paint; it will not re-seed a locale you already seeded.

## Troubleshooting

### Translations not appearing
- Check that `initialTranslationsLocale` matches the `UserLocaleStore` value at init.
- Verify the translations payload matches the `iCategories` shape.
- Enable `debug: true` and look for the messages above.

### Still seeing duplicate API calls
- Confirm `seedCatalog()` ran with the locale the client starts in, before `init()`.
- Confirm the locale hasn't drifted between server and client.

### Hydration mismatch warnings
- Seed the client with the **same** catalog and locale the server rendered with, **synchronously, before mount** — `seedCatalog()`, not `init({ initialTranslations })`.
- If you seed the server, seed the client too; if you don't seed the server, don't seed the client before hydration either.
- Make sure the `locale` you seed on the server matches the initial value of the locale state on the client.

### TypeScript errors on `t()`
- Placeholders are compile-time-checked: `t('Hello, {name}!', 'Cat')` *requires* a params object with `name`. Either add the key or remove the placeholder.
- Allowed param value types: `string | number | Date | boolean`.
