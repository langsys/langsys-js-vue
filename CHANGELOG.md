## Unreleased

> **Requires an unpublished base SDK.** This release adds the Vue surface for ticket 838 (server-computed write gating), which depends on `writeEnabled` / `setWriteGrant` / `WriteGrant` from `langsys-js-typescript`. Those are **not** in any published version — the current floor, `^0.6.5`, predates them, and published `0.6.5` does not contain them despite sharing a version number with the development build. Raising the floor to the version that publishes 838 is a release step and has not been taken here; until then this branch builds only against a local checkout of the base SDK.

### Added

- **`useWriteEnabled()` — whether the current session may register content, as decided by the server.** Returns `Readonly<ShallowRef<boolean | undefined>>`, and the tri-state is load-bearing: `undefined` means authorization hasn't landed yet, `false` means a genuinely read-only session, `true` means writes go direct. The same key can be write-enabled from one IP and read-only from another, so the answer is not derivable client-side.

    **Do not collapse `undefined` to `false`.** Telling a write-enabled session it is read-only is unrecoverable without a full reload — nothing re-runs the decision — and upstream it converts "hold these misses until we know" into "drop them", silently discarding phrases that would have registered a moment later. The README documents the three-way branch; `?? false` and `!writeEnabled` are both wrong.

    SSR- and hydration-safe by construction. During server rendering it reports `undefined` and never subscribes — the underlying signal is a process-wide singleton that would outlive the request. During hydration it publishes `undefined`, matching what the server rendered, then adopts the live value on the next **macrotask**; a Nuxt app whose authorization resolves inside an awaited plugin therefore hydrates without a mismatch. A microtask (`nextTick()`) would not do — it drains inside the same hydration pass. Components mounted after a client-side navigation read through immediately, with no `undefined` flash.

- **`writeGrant` init option, for login-walled apps.** Accepts everything the base SDK does — a token string, or (preferred) a provider function — plus a Vue `Ref<string | null | undefined>`. The grant travels as an `X-Write-Grant` header and the server folds it into the `write_enabled` decision.

    A ref is adapted into a provider **function**, never a snapshot, by the new `refToWriteGrant` (the write-grant analog of `refToLocaleSource`, and the Vue mirror of the Svelte wrapper's `adaptWriteGrant`). This matters because grants are short-lived: a provider is read fresh for each request, so `grantRef.value = next` takes effect on the very next call, whereas a snapshot is captured at `init()` and expires mid-session — a failure that passes testing and only surfaces in production. The adapter deliberately does not read eagerly or subscribe, which also keeps a grant ref from being tracked by whatever effect is running at `init()` time.

- **`LangsysApp.setWriteGrant(grant)` and the standalone `setWriteGrant(grant)`** — supply or replace the grant after `init()`, for the case where the token only exists once the user has authenticated. Re-authorizes so the server re-evaluates the session, then applies the returned `write_enabled`; `await` it if you need to know the session flipped. Both accept a ref and normalize it the same way `init` does. The standalone form is a Vue-flavored wrapper rather than a bare re-export of the base SDK's function on purpose: two same-named entry points where one silently mishandles a ref would send `[object Object]` as the header.

- **The raw `writeEnabled` signal is deliberately NOT re-exported.** `useWriteEnabled()` is the only access path this package provides. The core's signal is browser-authoritative and carries none of the composable's SSR or hydration protection, so re-exporting it would put the unguarded value one import away from the guarded one with nothing at the call site to say which is safe where. Applied as one fleet ruling across this binding and `langsys-js-react`; Svelte and Angular already withheld it. Consumers who genuinely need the unguarded signal import it from `langsys-js-typescript` directly. The absence is pinned by `src/write-enabled-absence.test.ts`, which carries two positive controls — the core still exports it, and this package loaded and exposes `useWriteEnabled` — so the assertion cannot pass for the wrong reason.

- **Types `WriteGrant` and `WriteGrantSource`** re-exported, so consumers typing their own grant plumbing don't have to reach into `langsys-js-typescript`.

### Changed

- **`LangsysApp` is now a `Proxy` over the base SDK singleton rather than a hand-written wrapper class.** It forwards every core member **by reference** and overrides exactly two — `init` and `setWriteGrant`, the only two that adapt Vue shapes. Non-breaking: `LangsysApp.getCountries()` and every other call keep working, and now resolve to the core's own function rather than a copy of it.

    This removes a failure mode; it does not fix a shipped defect. An earlier version of this entry said the enumerating class "had already lost five" core methods and that "all five are reachable again". **That was wrong** — all five are declared `private` in the core, and TypeScript's `private` is erased at runtime, so a prototype walk finds them and a naive reading calls them lost API. Measured against the core's own `.d.ts`, the old wrapper dropped **zero** public members. What the proxy fixes is the mechanism: a hand-written list silently falls behind whatever the core adds next, with a green typecheck and a green suite, because nothing references what is missing.

    Forwarded members are returned unbound, so `LangsysApp.foo` and the core's `foo` are the same function object. Binding them would make a destructured method behave differently here than off the core singleton — a divergence BIND-1 forbids. This is safe only while the core uses no `#private` fields; that assumption is pinned by a test, both structurally and by calling through the proxy receiver.

    **Destructuring is preserved — forwarded methods are bound.** An interim revision of this proxy forwarded members unbound, which silently broke a shape this package had shipped: `const { getCountries } = LangsysApp; getCountries()` works on `0.2.1` (the old wrapper delegated in its own body and never read `this`) and threw `Cannot read properties of undefined (reading 'resolveLocale')` on the unbound proxy. A non-destructured call worked on both, which is why a suite full of ordinary calls stayed green. Forwarded methods are now bound to the core instance, so the `0.2.1` shape keeps working and **this release is not breaking on that axis**; `src/destructuring.test.ts` pins it, and was red before the fix. The bound functions are cached, because `.bind()` mints a new function on every property read and consumers memoize on function identity. Accessor-computed values (`get t()`) are deliberately **not** bound — a `TFunction` needs no receiver, and this binding's reactivity depends on that closure's identity. Ruled by the fleet reviewer on the measurement above (topic `838-bind6-v2-vue`); Svelte already binds.


- **`iLangsysInitConfig.writeGrant` is widened to `WriteGrantSource`** (`WriteGrant | Ref<string | null | undefined>`). Purely additive — every value the vanilla config accepted is still accepted, and `init` normalizes on the way through.
- **README: the API-key permissions section no longer says the SDK detects the key type itself.** It doesn't, and can't: the server computes `write_enabled` per session and returns it. The old wording implied a client-side determination that a reader could reasonably have branched on.

## 0.2.1 - 2026-08-18

### Fixed (documentation)

Documentation-only release. No code changes — `dist/` is identical to 0.2.0.

- **The `0.2.0` changelog heading shipped reading `unreleased`** while npm listed `0.2.0` as `latest`. `CHANGELOG.md` is in this package's `files` array, so the contradiction was visible on npmjs.com. The heading is now dated, and the release script stamps the date at publish time so a hand-written `unreleased` cannot survive a release again.
- **`0.1.2` had no changelog entry.** Documented as what it was: a version bump published from a branch point predating the 0.2.0 fixes, which re-published two documentation defects that existed only in git.
- **The `apiUrl` note cited "the current base SDK (`0.4.3`)"** while 0.2.0 depends on `^0.6.5`, so a reader checking `0.4.3` would draw the wrong conclusion about which versions the note covers. `apiUrl` is absent from every released base SDK, so the claim is version-independent and now says so.

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
