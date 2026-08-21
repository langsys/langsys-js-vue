# Langsys SDK - Vue

[![npm](https://img.shields.io/npm/v/langsys-js-vue.svg?style=flat)](https://www.npmjs.com/package/langsys-js-vue)
[![build](https://img.shields.io/github/actions/workflow/status/langsys/langsys-js-vue/ci.yml?style=flat)](https://github.com/langsys/langsys-js-vue/actions)
[![last commit](https://img.shields.io/github/last-commit/langsys/langsys-js-vue.svg?style=flat)](https://github.com/langsys/langsys-js-vue/commits)
[![commit activity](https://img.shields.io/github/commit-activity/m/langsys/langsys-js-vue.svg?style=flat)](https://github.com/langsys/langsys-js-vue/pulse)
[![bundle size](https://img.shields.io/bundlejs/size/langsys-js-vue?style=flat)](https://bundlejs.com/?q=langsys-js-vue)
[![types](https://img.shields.io/npm/types/langsys-js-vue.svg?style=flat)](https://www.npmjs.com/package/langsys-js-vue)
[![downloads](https://img.shields.io/npm/dm/langsys-js-vue.svg?style=flat)](https://www.npmjs.com/package/langsys-js-vue)
[![license](https://img.shields.io/npm/l/langsys-js-vue.svg?style=flat)](./LICENSE)

Langsys revolutionizes localization for apps with easy to integrate, realtime, continuous translations. Read more about Langsys Translation Manager [at the website](https://Langsys.dev/).

Integrate the Langsys Translation Manager into your Vue 3, Nuxt, or Vite applications using this SDK.

## Requirements

- **Vue 3.4+** (the reactive layer is built on `shallowRef` + effect-scope disposal).

## How it's layered

`langsys-js-vue` is a thin Vue binding over the framework-agnostic [`langsys-js-typescript`](https://github.com/langsys/langsys-js-typescript) package — which owns the API client, translation lifecycle, token discovery, DOM tokenizer, and SSR-aware token strategies. This package adds only the Vue-native concerns:

- A `LangsysApp` whose `init` accepts a `Signal<string>` (made with `createLocaleStore`, or adapted from a ref with `refToLocaleSource`) for the user locale
- Composables — `useT`, `useCurrentLocale`, `useTranslations`, `useLocaleStore` — that update components when translations or the loaded locale change
- Components — `<Translate>` (HTML content blocks), `<Phrase>` (markup-bearing phrases for pluralization), `<DontTranslate>` (never-translated regions)

If you need the SDK outside Vue (a Node script, a non-Vue web app), import from `langsys-js-typescript` directly.

## Install

```bash
npm install langsys-js-vue
```

`langsys-js-typescript` is installed automatically as a transitive dependency. `vue` is a peer dependency you already have.

## Creating a Langsys project

Visit [Langsys.dev](https://Langsys.dev/) to create your account, then create your project. Take note of your project ID and API key.

### API key permissions

- **Write key** (development): the SDK auto-creates new translation tokens and content blocks as they appear in your app.
- **Read-only key** (production): the SDK fetches translations only — no token creation, no content-block writes.

**The server decides, not the SDK, and it decides per session.** Authorization returns a `write_enabled` flag that the SDK applies; the same key can come back write-enabled from one IP and read-only from another, so the answer isn't derivable from the key you hold. Read it with [`useWriteEnabled()`](#write-gating), and note that it is *tri-state* — there is a window before authorization lands where the answer is genuinely unknown.

A read-only session isn't necessarily silent: depending on the key's auto-discovery permission the SDK may still report the page URL so the phrases can be picked up server-side. A read-only key with discovery disallowed reports nothing at all. That lane is entirely internal to the base SDK — there is nothing to wire up here.

## Initialization

Initialize once, high in your tree. Create the user-locale store with `useLocaleStore` and pass it to `LangsysApp.init`:

```vue
<!-- src/LangsysGate.vue -->
<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { LangsysApp, useLocaleStore } from 'langsys-js-vue';

const { store } = useLocaleStore('en-US');
const ready = ref(false);
const error = ref<string | null>(null);

onMounted(() => {
    LangsysApp.init({
        projectid: import.meta.env.VITE_LANGSYS_PROJECT_ID,
        key: import.meta.env.VITE_LANGSYS_API_KEY,
        UserLocaleStore: store,
        baseLocale: 'en-US',
        debug: false,
        ssrTokenStrategy: 'client',
        // For a local/self-hosted server, call LangsysAppAPI.setBaseUrl(url) before init().
    }).then((res) => {
        if (res.status) ready.value = true;
        else error.value = res.errors?.join(', ') ?? 'Init failed';
    });
});
</script>

<template>
    <p v-if="error">Langsys init failed: {{ error }}</p>
    <p v-else-if="!ready">Loading…</p>
    <slot v-else />
</template>
```

`UserLocaleStore` is a `Signal<string>` — switch it with `setLocale(...)` (from the same `useLocaleStore` call) or `store.set('fr-FR')`, and the SDK reacts. If you'd rather keep the locale store at module scope, `const localeStore = createLocaleStore('en-US')` works too. And if your app already owns the locale in a `ref` (Pinia state, Nuxt's `useState`), adapt it with `refToLocaleSource(localeRef)` instead.

Locale identifiers are canonicalized to BCP 47 by the base SDK (v0.3.0+): lowercase input like `'en-us'` still works, but `useCurrentLocale()` and `detectPreferredLocale()` always return the canonical form (`'en-US'`) — compare against that, or normalize your own values with the re-exported `canonicalizeLocale()`.

> **A malformed locale tag fails silently.** `canonicalizeLocale()` can't reject bad input — it falls back to best-effort casing and returns a string either way, so a typo like `'en-USA'` or `'english'` sails through, misses the catalog, and renders base language. That looks identical to a locale you simply haven't translated yet, which is why it survives testing. Since base SDK `0.6.5`, running with `debug: true` warns when a tag isn't valid BCP 47 (silent in production). If a locale renders untranslated and you can't see why, check the tag before checking the catalog.

### Pointing the SDK at a different API server

By default the SDK talks to `https://api.langsys.dev/api`. To test against a local or self-hosted instance, call `LangsysAppAPI.setBaseUrl()` **before** `init()`:

```typescript
import { LangsysApp, LangsysAppAPI } from 'langsys-js-vue';

// Must run before init() — init() starts fetching immediately.
LangsysAppAPI.setBaseUrl('http://localhost:8000/api');

await LangsysApp.init({ projectid, key, UserLocaleStore: store });
```

> There is **no `apiUrl` field on `init()`** in any released version of the base SDK — `setBaseUrl()` is the only mechanism. TypeScript rejects `apiUrl` as an excess property, but a plain-JS caller would have it silently dropped and keep talking to production, so don't reach for it.

### SSR token strategy

`ssrTokenStrategy` (default `'client'`) controls when missing tokens are sent during server rendering:

- `'client'` — tokens collected on the server are flushed from the client after hydration. Best for performance.
- `'server'` — tokens are sent immediately during SSR. Best for reliability and immediate registration.
- `'auto'` — small batches (≤5) sent from server, larger queued for client.

## Write gating

`useWriteEnabled()` reports whether the current session may register content, as computed by the server:

```vue
<script setup lang="ts">
import { useWriteEnabled } from 'langsys-js-vue';

const writeEnabled = useWriteEnabled();
</script>

<template>
    <span v-if="writeEnabled === undefined">Checking…</span>
    <span v-else-if="writeEnabled">Editing enabled</span>
    <span v-else>Read-only</span>
</template>
```

### The tri-state is load-bearing

| Value | Meaning |
|---|---|
| `undefined` | Authorization hasn't landed yet. **Not** the same as read-only. |
| `false` | Read-only session. The SDK may report the page URL instead, subject to the key's auto-discovery permission. |
| `true` | This session registers content directly. |

> **Never write `writeEnabled ?? false`, `!writeEnabled`, or `v-if="!writeEnabled"` against this value.** Collapsing `undefined` into `false` tells a write-enabled session it is read-only, and it is unrecoverable without a full reload — nothing re-runs the decision. It also discards tokens: upstream, `undefined` means "hold these misses until we know", so treating it as `false` drops phrases that would have registered a moment later. Branch on all three states, or gate on `writeEnabled === true` and render a neutral state for the rest.

The composable is SSR-safe. During server rendering it reports `undefined` without subscribing (the underlying signal is a process-wide singleton, and it is only ever written client-side); during hydration it publishes `undefined` — matching what the server rendered — and adopts the real value on the next macrotask, so a Nuxt app whose authorization resolves in an awaited plugin doesn't hydrate into a mismatch. Components mounted later, after a client-side navigation, read through immediately with no flash.

`writeEnabled` is also exported as a raw signal for direct subscription outside Vue's reactivity. It has none of the protections above — in components, use the composable.

### Write grants (login-walled apps)

If writes should only be possible once a user has authenticated, pass a short-lived grant. It travels as an `X-Write-Grant` header and the server folds it into the `write_enabled` decision.

```typescript
import { ref } from 'vue';
import { LangsysApp, setWriteGrant } from 'langsys-js-vue';

const grant = ref<string | null>(null);

await LangsysApp.init({
    projectid,
    key,
    UserLocaleStore: store,
    writeGrant: grant, // a ref, a provider function, or a bare token string
});

// After login — the ref form needs no further call:
grant.value = tokenFromLogin;

// Or set it imperatively, which re-authorizes and awaits the new decision:
await LangsysApp.setWriteGrant(tokenFromLogin);
```

**Prefer the ref or the provider function over a bare string.** Grants are short-lived. A ref or a function is read fresh for every request, so rotating the token takes effect on the very next call; a string is a snapshot captured at `init()` and will eventually expire mid-session. A ref is adapted into a provider for you by `refToWriteGrant` — the write-grant analog of `refToLocaleSource`.

`setWriteGrant()` re-authorizes so the server re-evaluates the session, then applies the returned `write_enabled`. `await` it if you need to know the session flipped. Misses that occur after it lands register directly; earlier ones were already handled by the discovery lane.

## Using translations

### `useT()` — the everyday API

`useT()` returns the current translation function as a reactive ref, updating the component whenever translations or the loaded locale change.

```vue
<script setup lang="ts">
import { useT } from 'langsys-js-vue';

const t = useT();
</script>

<template>
    <h1>{{ t('Welcome to my app', 'UI') }}</h1>
    <p>{{ t('Hello, {name}!', 'UI', { name: 'Sarah' }) }}</p>
</template>
```

In templates the ref auto-unwraps, so `t(...)` calls the function directly. In script code, call `t.value(...)`.

The translation function signature is **`t(phrase, category?, params?)`**:

```typescript
t('Save');                                       // no category, no params
t('Save', 'UI');                                 // categorized
t('Hello, {name}!', { name: 'X' });              // no category, with params
t('Hello, {name}!', 'Greetings', { name: 'X' }); // category + params
```

The **phrase itself is the lookup key** *and* the base-language default — there's no separate keys file to maintain. The first render of a phrase registers it in the Translation Manager (when using a write key); from then on, translations are fetched and rendered automatically as locales change.

#### Interpolation

Curly-brace placeholders are substituted from the params argument:

```typescript
t('You have {count} new messages', 'Notifications', { count: 3 });
```

Placeholder names are extracted from the phrase at compile time and **type-checked**: omitting a required key or adding an extra one is a TypeScript error.

```typescript
t('You have {count} new messages', 'Notifications', {});
// ❌ Property 'count' is missing in type '{}'

t('You have {count} new messages', 'Notifications', { count: 3, extra: 'x' });
// ❌ Object literal may only specify known properties, and 'extra' does not exist
```

Allowed value types: `string | number | Date | boolean`. Since base SDK 0.3.0, values are locale-formatted: numbers go through `Intl.NumberFormat` (`1234.5` → `1.234,5` in `de-DE`) and `Date` values through `Intl.DateTimeFormat` with the medium date style. Pass a string to opt out of formatting. Formatting always uses the catalog locale (falling back to `en`), never the host's default locale, so server and client render identically.

> Future versions will swap the simple `{name}` runtime for full ICU MessageFormat — adding plural / select — without changing the public signature. Style-less ICU arguments (`{n, number}`, `{d, date}`, `{t, time}`) already format as of base SDK 0.3.0. Today's `t('{count} items', 'Cart', { count })` will evolve to `t('{count, plural, one {# item} other {# items}}', 'Cart', { count })`.

#### Categorization disambiguates context

Different categories give the *same* phrase different translations:

```vue
<strong>{{ t('Home', 'Main Menu') }}</strong>     <!-- "Inicio" in Spanish -->
<strong>{{ t('Home', 'Home repairs') }}</strong>  <!-- "Hogar" in Spanish -->
```

Without categorization, "Home" would only have one translation — which can't work for both contexts. Langsys's philosophy is *translate once, use everywhere*; categorize when the same phrase legitimately means different things.

A good rule for category names: the module or feature the phrase lives in (`Account`, `Errors`, `Checkout`, `UI`).

### `<Translate>` — HTML content blocks

For larger blocks of HTML where the structure should be preserved for the translator:

```vue
<script setup lang="ts">
import { Translate } from 'langsys-js-vue';
</script>

<template>
    <Translate category="Blog" tag="article">
        <h1 class="title">My article title</h1>
        <p>My content <strong>is the best</strong> when internationalized by Langsys.</p>
        <p>Translators see this exactly as users do — same styling, same structure.</p>
    </Translate>
</template>
```

The component:
- Recursively tokenizes text nodes and translatable attributes: user-visible text (`placeholder`, `alt`, `title`, `label`), the ARIA strings a screen reader speaks (`aria-label`, `aria-placeholder`, `aria-description`, `aria-valuetext`, `aria-roledescription`) — worth knowing these exist, since an untranslated `aria-label` has no visible symptom and won't be caught by looking at the page — and form validation messages (`data-error`, `data-error-message`, `data-validation-message`, `data-invalid-message`, `data-required-message`, `data-pattern-message`). Those come from `TRANSLATABLE_ATTRIBUTES` in `langsys-js-typescript`, which grows over time — treat the list as illustrative, not exhaustive.
- Translates `value` only where it is a label rather than data: on `<button>`, and on `<input type="submit">` / `<input type="button">`. Every other input type is left alone, so a text field's value is never rewritten. This is a separate mechanism from the attribute list above (`VALUE_TRANSLATABLE_ELEMENTS` / `VALUE_TRANSLATABLE_INPUT_TYPES`) — `value` does **not** appear in `TRANSLATABLE_ATTRIBUTES`.
- Translates `<option>` text.
- Captures semantic CSS so translators see the styled appearance in the Translation Manager.
- Registers the whole thing as a **content block** that translators handle as one unit while still translating the individual phrases inside.
- Auto re-translates on locale change.

`<Translate>` mounts the SDK's DOM walker on its host element and lets it mutate the rendered output in place, so **keep its children static** — prose, marketing copy, CMS-rendered articles, forms with placeholders. For dynamic per-string values that Vue owns, use `useT()`.

```vue
<!-- CMS content goes through Translate as-is -->
<Translate category="News" tag="div">
    <div v-html="article?.content ?? ''" />
</Translate>
```

#### Runtime values with `params` — write placeholders as `%name%`

`<Translate>` accepts a `params` prop for runtime interpolation across its content — text nodes, translatable attributes, and `<select>` options. In markup, **write placeholders with percent delimiters (`%name%`), not `{name}`**:

```vue
<Translate category="Dashboard" tag="section" :params="{ name: user.name, count: unread }">
    <p>Welcome back, %name%. You have %count% new messages.</p>
</Translate>
```

Why `%name%`: the base SDK normalizes `%name%` back to canonical `{name}` at capture time, so **translators still only ever see `{name}`** and both spellings register the same content block. A single `{name}` actually works in Vue markup (Vue only consumes `{{ }}`, not single braces) — but `%name%` is the portable form the React/Svelte bindings require too, and it avoids the `{{ }}` collision entirely. Only identifiers between the percents match (`%[A-Za-z_][A-Za-z0-9_]*%`), so literal `%` in prose ("50% off", "width: 100%") is left untouched. To keep a *literal* `%WORD%` (e.g. a Windows env var like `%PATH%` in docs text), wrap it in `<DontTranslate>`. The `params` prop is reactive — a changed `count` re-renders via the base SDK's `setParams()`. Placeholders inside `$t()` stay single-brace `{name}` (they live in a JS string, no collision).

**Debug mode catches the `{{ name }}` mistake.** The trap in Vue is reaching for the interpolation you use everywhere else:

```vue
<!-- WRONG — Vue substitutes {{ name }} before Langsys ever sees the text -->
<Translate :params="{ name: user.name }">
    <p>Welcome back, {{ name }}.</p>
</Translate>
```

Slot content is compiled by the **parent** component's template compiler, so `{{ name }}` is already replaced with its value by the time `<Translate>` mounts and hands the DOM to the SDK. The token registers with the name baked in, no placeholder survives, and `params` silently does nothing. With `debug: true` the base SDK (≥ 0.4.3) now flags it:

```
<Translate> received params with no matching placeholder in its content: %name%.
If you wrote {name} or {{ name }} in markup, your framework's template compiler
substituted it before Langsys saw the text — write %name% instead.
```

The check fires for `<Translate>` and `<Phrase>`, treats ICU slots (`{n, plural, …}`) as legitimate, re-runs only when the params *key set* changes (a ticking count won't spam), and is silent in production. Note the warning names both brace spellings because it's shared across bindings — in Vue only `{{ }}` is eaten; a single `{name}` survives and works, so it never trips this warning.

`<Translate>` props: `category?`, `custom_id?`, `label?`, `tag?` (defaults to `translate`), `params?`. `class` and other attributes fall through to the host element.

### `<Phrase>` — markup-bearing phrases (pluralization)

Keeps a run that contains inline markup as **one** translatable phrase — so a count variable stays next to the noun it pluralizes, and the translator sees the whole sentence:

```vue
<script setup lang="ts">
import { Phrase } from 'langsys-js-vue';
</script>

<template>
    <Phrase category="ProductCard" :params="{ n: reviewCount }">
        Based on %n% <strong>reviews</strong>
    </Phrase>
</template>
```

The inline elements never reach the translator — they're replaced with neutral markup tokens (`{m0o}`…`{m0c}`) and the real framework-owned elements are reconstituted around the translated text at render. This is also what lets reordering languages move emphasis correctly (`<span>White</span> House` → `Casa <span>Blanca</span>`). Pass interpolation values via `params`; keep the markup children static.

> Write the placeholder as `%n%` (the base SDK normalizes it to `{n}` at capture). A single `{n}` also passes through in Vue templates since Vue only consumes `{{ }}` — but `%n%` is the portable form shared with the React/Svelte bindings. Writing `{{ n }}` here fails the same way it does in `<Translate>`, and [debug mode flags it](#runtime-values-with-params--write-placeholders-as-name).

`<Phrase>` props: `category?`, `params?`, `tag?` (defaults to `span`). `class` falls through to the host.

### `<DontTranslate>` — never-translated regions

Marks content that must be preserved verbatim (brand names, domains, code):

```vue
Built with <DontTranslate>Kangen®</DontTranslate> on <DontTranslate>langsys.dev</DontTranslate>
```

Renders the host with `translate="no"`, which the base SDK's tokenizer and renderer already honor — the content is never tokenized, registered, or replaced.

`<DontTranslate>` props: `tag?` (defaults to `span`). `class` falls through to the host.

## Composables & reactive primitives

| Export | Type | Notes |
|---|---|---|
| `useT()` | `() => Readonly<ShallowRef<TFunction>>` | Updates on translations/locale change. Template: `{{ t('Phrase', 'Cat', params?) }}`; script: `t.value(...)`. |
| `useCurrentLocale()` | `() => Readonly<ShallowRef<string>>` | The locale whose translations are currently loaded (lags the user-selected locale until the fetch completes). |
| `useTranslations()` | `() => Readonly<ShallowRef<iCategories>>` | Raw translation catalog. Rarely needed in app code. |
| `useLocaleStore(initial?)` | `() => { locale, setLocale, store }` | Creates a user-locale `Signal<string>`, reads it reactively, returns a setter. Pass `store` to `init`. |
| `useWriteEnabled()` | `() => Readonly<ShallowRef<boolean \| undefined>>` | Server-computed write capability. **Tri-state** — `undefined` means "not yet known", never read it as `false`. SSR- and hydration-safe. See [Write gating](#write-gating). |
| `useSignal(signal)` | `<T>(s: Signal<T>) => Readonly<ShallowRef<T>>` | Low-level: subscribe the current scope to any base-SDK signal. |
| `createLocaleStore(initial?)` | `(s?: string) => Signal<string>` | Make a user-locale store outside components (module scope). |
| `refToLocaleSource(ref)` | `(r: Ref<string>) => Signal<string>` | Adapt an existing Vue ref (Pinia, `useState`) into the SDK's locale-store contract. |
| `refToWriteGrant(ref)` | `(g?: WriteGrantSource) => WriteGrant \| undefined` | Adapt a Vue ref holding a write grant into the provider the SDK reads per request. Applied for you by `init` / `setWriteGrant`. |
| `setWriteGrant(grant)` | `(g?: WriteGrantSource) => Promise<void>` | Supply or replace the grant after `init()`; re-authorizes and applies the new decision. Also available as `LangsysApp.setWriteGrant`. |
| `t` / `currentlyLoadedLocale` / `sTranslations` / `writeEnabled` | `Signal<…>` | Raw signals for direct subscription outside Vue. In components, prefer the composables — `writeEnabled` especially, whose raw form has no hydration protection. |
| `canonicalizeLocale(locale)` | `(s: string) => string` | Normalize a locale identifier to canonical BCP 47 (`'en-us'` → `'en-US'`) — the same normalization the SDK applies internally. |

## Server-Side Rendering (Nuxt)

The SDK is SSR-compatible. The main pattern is to pre-fetch translations server-side and seed them through `initialTranslations` / `initialTranslationsLocale` so the client doesn't refetch on hydration. `useSignal` seeds its ref synchronously from the signal's current value, so components hydrate without a flash of untranslated content when seeded.

📖 **See [README-SSR.md](./README-SSR.md)** for a complete Nuxt walkthrough.

## Utilities

`LangsysApp` exposes localized helpers (call them from lifecycle hooks / event handlers):

```typescript
import { LangsysApp, type iCountryList, type iCurrencyList, type iLocaleDefault } from 'langsys-js-vue';

const countries: iCountryList   = await LangsysApp.getCountries();     // [{ code: "US", label: "United States" }, ...]
const dialCodes                 = await LangsysApp.getDialCodes();     // [{ country_code: "US", dial_code: "+1", name: "United States" }, ...]
const currencies: iCurrencyList = await LangsysApp.getCurrencies();    // [{ code: "USD", name: "US Dollar", symbol: "$", ... }, ...]
const locales: iLocaleDefault   = await LangsysApp.getLocales();       // { "English": [{ code: "en-US", name: "English (US)" }, ...], ... }
const localeName                = await LangsysApp.getLocaleNameWithLookup('es-ES', true, 'fr-FR'); // "espagnol"
```

`getLocaleName()` (the synchronous variant) only reads an in-memory cache, populated once `await LangsysApp.getLocalesData(inLocale)` — or a `getLocaleNameWithLookup()` call — has settled for that display locale. Called before that, it warns and returns `''`; prefer `getLocaleNameWithLookup()` unless you've already loaded the data.

### Detecting the user's preferred locale

```typescript
// Browser: navigator.languages → fallback to navigator.language
const locale = LangsysApp.detectPreferredLocale();
// Returns 'en-US', 'fr', etc., or false only when nothing can be detected at all

// SSR (server route / middleware): parses Accept-Language
const locale = LangsysApp.detectPreferredLocale(event.node.req.headers['accept-language']);

// Matched against your app's supported locales
const supportedLocales = (await LangsysApp.getLocalesFlat()).map((l) => l.code);
const locale = LangsysApp.detectPreferredLocale(acceptLanguage, supportedLocales);
```

The matcher tries exact match first (e.g. `en-US`), then language-only (`en` matches `en-GB`), and is script-aware via CLDR likely-subtags (base SDK 0.3.0+): `zh-TW` matches `zh-Hant` and never falls back to `zh-Hans`. Results are always canonical BCP 47.

**On no match, it does *not* return `false`.** `false` is returned in exactly one case: no user preference could be detected at all (empty `Accept-Language`, no `navigator.languages`). When you pass `supportedLocales` and none of the user's preferences match, it falls back to **the user's own top preference**, canonicalized — an unsupported locale. So this is a trap:

```typescript
// WRONG — the || branch only fires when nothing was detected, never on a no-match,
// so an unsupported locale propagates silently.
const locale = LangsysApp.detectPreferredLocale(header, supported) || 'en-US';
```

Guard the result against your own list instead:

```typescript
const detected = LangsysApp.detectPreferredLocale(header, supportedLocales);
const locale = detected && supportedLocales.includes(detected) ? detected : 'en-US';
```

Without a `supportedLocales` list, it returns the user's first preference, or `false` when none can be detected.

### Waiting for translations to load

When changing locale mid-session, you may want to re-run dependent code after the new translations arrive:

```typescript
watch(locale, () => {
    LangsysApp.translationsLoadingPromise.then(() => {
        // re-render content / regenerate UI here
    });
});
```

## License

MIT © Langsys
