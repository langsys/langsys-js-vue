# SSR Usage Guide (Nuxt)

This guide shows how to use `langsys-js-vue` with Server-Side Rendering (SSR) to eliminate duplicate API calls and improve performance.

## The problem

In a traditional SSR flow:
1. The server fetches translations during render.
2. The client re-fetches the same translations after hydration.
3. Duplicate API calls, slower initial render, possible flash of untranslated content.

## The solution

Pass pre-fetched translations from server to client using the `initialTranslations` config option. The client SDK uses them as-is and skips the initial fetch. Because `useSignal` seeds its ref synchronously from the signal's current value, the first paint already reflects the seeded translations.

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

### Step 2: Load the payload during SSR and initialize on the client

```vue
<!-- app.vue -->
<script setup lang="ts">
import { LangsysApp, refToLocaleSource } from 'langsys-js-vue';

// Runs on the server during SSR; the payload transfers to the client for free.
const { data } = await useAsyncData('langsys', () => $fetch('/api/langsys', { query: { locale: 'en' } }));

// Nuxt-owned locale state, adapted to the SDK's store contract.
const locale = useState('locale', () => data.value?.locale ?? 'en');

onMounted(() => {
    const config = useRuntimeConfig();
    LangsysApp.init({
        projectid: config.public.langsysProjectId,
        key: config.public.langsysApiKey, // read-only key on the client
        UserLocaleStore: refToLocaleSource(locale),
        baseLocale: 'en',
        initialTranslations: data.value?.translations,
        initialTranslationsLocale: data.value?.locale,
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

The same handoff works with any Vue SSR setup: fetch the catalog in your server entry, serialize `{ locale, translations }` into the page payload, and call `LangsysApp.init` with `initialTranslations` / `initialTranslationsLocale` in your client entry before mounting.

## Benefits

### Performance
- No duplicate API calls (server + client).
- Translations ready immediately on hydration.
- Faster Time to Interactive (TTI).
- Reduced API usage and costs.

### User experience
- No flash of untranslated content.
- Instant translation display.
- Better SEO with server-rendered translations.

### Developer experience
- Simple configuration.
- Full TypeScript support, including compile-time-checked interpolation params on `t()`.

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

1. **One-time use.** `initialTranslations` is consumed only at init. Locale changes after init go through the normal fetch path.
2. **Matching locales.** Always provide `initialTranslationsLocale` with `initialTranslations` so the SDK knows what locale the data represents.
3. **Data format.** The translations payload must match the `iCategories` shape returned by `LangsysAppAPI.getTranslations()`.
4. **Cache.** The 60-second locale cache still applies. Pre-fetched translations count as cached.
5. **Token creation.** Use a read-only API key for the client in production — missing tokens won't be sent. Keep the write key on the server (and ideally pre-populate tokens via your local dev environment).
6. **Client-side init.** `LangsysApp.init` belongs in `onMounted` (client-only) so the server render and the first client render agree; the seeded signals cover the server output.

## Troubleshooting

### Translations not appearing
- Check that `initialTranslationsLocale` matches the `UserLocaleStore` value at init.
- Verify the translations payload matches the `iCategories` shape.
- Enable `debug: true` and look for the messages above.

### Still seeing duplicate API calls
- Confirm both `initialTranslations` *and* `initialTranslationsLocale` are passed.
- Confirm init runs before any rendering that calls `t(...)`.
- Confirm the locale hasn't drifted between server and client.

### Hydration mismatch warnings
- Make sure the `locale` you seed on the server matches the initial value of the locale state on the client.
- Keep `LangsysApp.init` inside `onMounted` (client-only) so the server render and the first client render agree.

### TypeScript errors on `t()`
- Placeholders are compile-time-checked: `t('Hello, {name}!', 'Cat')` *requires* a params object with `name`. Either add the key or remove the placeholder.
- Allowed param value types: `string | number | Date | boolean`.
