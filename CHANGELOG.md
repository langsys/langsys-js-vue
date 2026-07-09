## 0.1.1

### Fixed

- Point `repository`, `homepage`, and `bugs` URLs at the `langsys` org — the package's permanent home — after the repo migrated from `gcapra/langsys-js-vue` to [`github.com/langsys/langsys-js-vue`](https://github.com/langsys/langsys-js-vue).

## 0.1.0

Initial release. `langsys-js-vue` is a thin Vue 3 binding over the framework-agnostic [`langsys-js-typescript`](https://github.com/langsys/langsys-js-typescript) package — the Vue sibling of `langsys-js-react` and `langsys-js-svelte`. The base SDK owns the API client, translation lifecycle, token discovery, DOM tokenizer, and SSR-aware token strategies; this package adds only the Vue-native concerns.

### Added

- **`LangsysApp`** — wrapper whose `init` accepts a `Signal<string>` as `UserLocaleStore` and delegates every other method to the base SDK singleton.
- **Composables** bridging base-SDK signals into `shallowRef`s with effect-scope disposal:
    - `useT()` — the current translation function, updating on translations/locale change. Signature: `t(phrase, category?, params?)` with compile-time-checked interpolation params.
    - `useCurrentLocale()` — the loaded locale.
    - `useTranslations()` — the raw catalog.
    - `useLocaleStore(initial?)` — all-in-one `{ locale, setLocale, store }` for the user-locale store.
    - `useSignal(signal)` — low-level Signal → ref bridge.
- **`createLocaleStore(initial?)`** — user-locale `Signal<string>` factory (the `writable` analog), and **`refToLocaleSource(ref)`** — adapt an existing Vue `Ref<string>` (Pinia, Nuxt `useState`) into the SDK's store contract with a `flush: 'sync'` watcher.
- **`<Translate>`** — Vue component wrapping the base SDK's vanilla DOM `Translate` class: tokenizes children into a content block, registers it, re-translates on locale change. Props: `category?`, `custom_id?`, `label?`, `tag?` (default `translate`), `params?` (runtime `{name}` interpolation across content-block text, attributes, and select options, re-applied reactively via `setParams()`); `class` falls through. In markup, author placeholders as `%name%` — the base SDK normalizes them to canonical `{name}` at capture, sidestepping the framework `{{ }}`/`{ }` collision.
- **`<Phrase>`** — wraps the vanilla `Phrase` rich-text handler. Keeps a markup-bearing run as ONE translatable phrase, encoding inline markup as neutral tokens and reconstituting the real elements at render. Props: `category?`, `params?`, `tag?` (default `span`).
- **`<DontTranslate>`** — marks a region as never-translated (renders `translate="no"` + `data-ls-dont-translate`), preserved verbatim. Props: `tag?` (default `span`).
- **Re-exports** from the base SDK: raw signals (`t`, `currentlyLoadedLocale`, `sTranslations`), `createSignal`, `canonicalizeLocale`, `LangsysAppAPI`, and the framework-agnostic types.
- **SSR (Nuxt) support** via `initialTranslations` / `initialTranslationsLocale` seeding — see `README-SSR.md`.

### Notes

- Built against `langsys-js-typescript` `^0.4.1` — includes `TranslateOptions.params` / `Translate.setParams()` (content-block interpolation) and the `%name%` → `{name}` markup normalization, both surfaced through `<Translate params>` / `<Phrase params>` with no Vue-side placeholder handling.
