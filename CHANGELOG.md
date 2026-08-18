## 0.2.0 - 2026-08-18

### Breaking

- **`<Phrase>`'s `params` prop no longer accepts non-primitive values.** If you pass an object, array, or function as a param *value* — `:params="{ user: userObject }"` — it is now a compile error. Param values must be `string | number | Date | boolean` (`ParamPrimitive`), matching `<Translate>` and `t()`, which already required this. Nothing changes at runtime: those values were never renderable and interpolated as `[object Object]`, so this turns a silent display bug into a type error. Pass the primitive you actually want to render (`:params="{ name: user.name }"`).

### Changed

- **Base SDK floor raised to `langsys-js-typescript@^0.6.5`** (from `^0.4.1` as published in 0.1.1). No wrapper code is coupled to the bump. This is the significant half of the release for existing users: `^0.4.1` resolves `>=0.4.1 <0.5.0`, so **every fix below was unreachable from 0.1.1 by any install or update** — caret on a `0.x` version pins the minor, and only a republish moves it.
    - `0.6.5` — `debug: true` now warns when a locale tag isn't valid BCP 47. `canonicalizeLocale()` returns a string either way, so it cannot signal the fallback: a typo'd tag misses the catalog and renders base language, which is indistinguishable from a locale you haven't translated yet.
    - `0.6.4` — a missing ICU argument dumped the raw message source onto the page (`{name_gender, select, male {Bienvenido} …} Sarah` instead of `Bienvenide Sarah`). Reachable with no caller mistake: the ICU promoter *introduces* a select argument the source phrase never had, so an app cannot supply it. Any app translating into a gendered locale was exposed. A `null` param also no longer coerces to `0`, which had made a forgotten `count` render identically to a genuinely empty one.
    - `0.6.3` — `<select>` option text was harvested twice, diverging content-block ids from langsys-php; four attributes added, three of them ARIA strings a screen reader speaks.
    - `0.6.1` / `0.6.2` — langsys-php marker interop (`data-langsys-phrase` opt-out values, `data-notrans`, case-insensitive `translate="no"` — the last also affects plain Vue apps).
    - `0.6.0` — `md5` packed UTF-16 code units into byte lanes, so non-ASCII content-block ids diverged from langsys-php and distinct blocks could collide. Migration is automatic and lookup-only; ASCII ids are byte-identical.
    - `0.5.0` — the `PhraseOptions.params` narrowing this release matches.

### Fixed (documentation)

- **`README`: the harvested-attribute list was incomplete and the `value` rule was wrong.** It named four attributes where `TRANSLATABLE_ATTRIBUTES` carries fifteen, omitting `label`, four ARIA strings, and six `data-*` validation messages. It also described `value` as translated on "button/input", which implies every input — including text fields, where rewriting the value would corrupt what a user typed. The real rule is narrower and deliberate: `value` is translated on `<button>` and on `<input type="submit">` / `<input type="button">` only. Documents `value` as its own mechanism, since it comes from `VALUE_TRANSLATABLE_ELEMENTS` / `VALUE_TRANSLATABLE_INPUT_TYPES` and does not appear in `TRANSLATABLE_ATTRIBUTES` at all — reading that one constant would tell you `value` is never translated.

### Added

- **Debug diagnostic for eaten placeholders** (inherited from base SDK `0.4.3`, no wrapper code). With `debug: true`, passing `params` whose keys have no matching placeholder in the captured content now warns and names the fix — the fingerprint of a template compiler having substituted the braces before Langsys saw the text. In Vue that means `{{ name }}`: slot content is compiled by the *parent* component's compiler, so the value is already baked in by the time `<Translate>` mounts. Covers `<Translate>` and `<Phrase>`, treats ICU slots (`{n, plural, …}`) as legitimate, re-runs only when the params key-set changes, and is silent in production.

### Fixed

- **`README`: removed `apiUrl` from the `init()` documentation.** No such field exists in the base SDK — `LangsysAppAPI.setBaseUrl()` before `init()` is the only mechanism, and the README had documented it merely as the alternative. TypeScript always rejected `apiUrl` as an excess property, but a plain-JS caller had it silently dropped and kept talking to production while believing they were pointed at localhost. This included a commented-out `apiUrl` line inside the quickstart `init()` block — the copy-paste risk.
- **`README`: corrected the `detectPreferredLocale()` no-match contract.** It was documented as returning `false` when none of the user's preferences match `supportedLocales`, making `detectPreferredLocale(header, supported) || 'en-US'` a safe fallback. It does not: on a no-match it returns the user's own top preference, canonicalized. `false` is returned only when nothing is detectable at all (empty `Accept-Language`, no `navigator.languages`), so the fallback fires on the wrong one of the two failure modes and an unsupported locale propagates silently. Documents both paths and the guard that works.
- **`<Phrase>` examples now teach `%n%`, not a bare `{n}`** — in the component doc comments and the README. The bare form happens to work in Vue (only `{{ }}` is consumed), but it contradicted our own portability guidance, and pasted into a React or Svelte app it silently fails.

## 0.1.2 - 2026-08-17

No functional change. A version bump published from a branch point that predated the fixes in 0.2.0, so it re-published documentation defects that existed only in git — the nonexistent `apiUrl` init field and the inverted `detectPreferredLocale` no-match contract. Both are corrected in 0.2.0. `dist/` is byte-identical to 0.1.1; the dependency remained `^0.4.1`.

## 0.1.1 - 2026-07-09

### Fixed

- Point `repository`, `homepage`, and `bugs` URLs at the `langsys` org — the package's permanent home — after the repo migrated from `gcapra/langsys-js-vue` to [`github.com/langsys/langsys-js-vue`](https://github.com/langsys/langsys-js-vue).

## 0.1.0 - 2026-07-09

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
