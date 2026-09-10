# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Project Overview

`langsys-js-vue` is a Vue 3 binding over the framework-agnostic [`langsys-js-typescript`](https://github.com/langsys/langsys-js-typescript) package. The base SDK owns the API client, translation lifecycle, token discovery, DOM tokenizer, and SSR-aware token strategies. This package is intentionally thin and contains only Vue-native concerns.

It is the Vue sibling of [`langsys-js-react`](https://github.com/langsys/langsys-js-react) and [`langsys-js-svelte`](https://github.com/langsys/langsys-js-svelte) and exposes the same capabilities, adapted to Vue idioms: where Svelte uses `$store` auto-subscription and React uses `useSyncExternalStore`, Vue uses composables that bridge signals into `shallowRef`s.

## Layout

```
src/
    index.ts                  # public exports — LangsysApp wrapper, composables, components, raw signals, type re-exports
    adapters.ts               # useSignal (Signal → shallowRef), createLocaleStore, refToLocaleSource (Ref → Signal), refToWriteGrant (Ref → provider)
    composables.ts            # useT / useCurrentLocale / useTranslations / useLocaleStore / useWriteEnabled
    components/
        Translate.ts          # Vue thin wrapper around langsys-js-typescript's vanilla DOM Translate class
        Phrase.ts             # wrapper around the vanilla Phrase rich-text handler
        DontTranslate.ts      # presentational translate="no" host
    adapters.test.ts          # coverage for the adapter contracts
    composables.test.ts       # useWriteEnabled — SSR/hydration/tri-state coverage
    components.test.ts        # structural (SSR-rendered) component coverage
example/                      # Vite playground (npm run dev) — not published
```

That's the entire surface. Every other concern — HTTP, missing-token registration, persistence, SSR strategies, lookup/interpolation logic — lives in `langsys-js-typescript`.

Components are authored as `defineComponent` + `h()` render functions in plain `.ts` (no SFCs) so tsup alone builds the package and consumers never need a `.vue` compiler for the library.

## How the wrapping works

1. **`LangsysApp` is a `Proxy` over the base SDK's singleton, not a wrapper class.** It forwards every member **by reference** and overrides exactly two: `init` (widens `UserLocaleStore` to a `Signal<string>` and `writeGrant` to accept a `Ref`) and `setWriteGrant` (accepts a `Ref`). Forwarded **methods** are **bound to the core instance** and cached, so `const { getCountries } = LangsysApp` stays callable — the shape `0.2.1` shipped, which unbound forwarding silently broke. Accessor-computed values (`get t()`) and plain state pass through **unwrapped**: `t` returns a `TFunction` that needs no receiver, and this binding's reactivity depends on that closure's identity, so wrapping it would put a layer between the core's identity signal and anyone comparing against it. This replaced a hand-written class that enumerated one delegating method per core method: that shape silently drops whatever the core adds next, with a green typecheck and a green suite, because nothing references what is missing. (It had **not** already dropped anything — an earlier version of this note named five methods as lost, but all five are core-`private`, and `private` is erased at runtime; measured against the core's `.d.ts` the old wrapper dropped zero public members. The proxy removes a failure mode, not a shipped defect.) Apps that already own the locale in a `Ref` adapt it with `refToLocaleSource` (the Vue analog of the Svelte wrapper's `adaptStore`), which uses a `flush: 'sync'` watcher to preserve the Signal contract (synchronous notify, immediate first fire).

2. **Composables (`useT`, `useCurrentLocale`, `useTranslations`)** — each wraps a base-SDK signal with `useSignal`: seed a `shallowRef` from `signal.get()`, subscribe (the base `subscribe` fires synchronously and returns an unsubscribe function), and dispose with the current effect scope (`onScopeDispose`, guarded by `getCurrentScope()` so module-level use works too). `shallowRef` is required — signal payloads like `TFunction` must not be deeply proxied, and the signal replaces the whole value on every change.

3. **`useWriteEnabled()` — the one composable that does _not_ just wrap `useSignal`.** The base SDK's `writeEnabled` is browser-authoritative (only ever written client-side, `undefined` for the whole of a server render), so this composable does three things instead: under SSR it returns a detached `shallowRef(undefined)` and never subscribes (the signal is a process-wide singleton that would outlive the request); during the hydration pass it publishes `undefined` and adopts the live value on a **macrotask** (`setTimeout(0)`), latched by a module-level `pastHydration` flag keyed on the first _call_; after that, calls fall through to `useSignal`. This is the Vue analog of React's pinned `getServerSnapshot` and Svelte's deferred store. `nextTick()` is **not** a valid substitute — a microtask still drains inside the hydration pass, which is exactly the mismatch being prevented. The flag is keyed on first call, not module init, because an awaited Nuxt plugin can run many macrotasks between import and mount.

4. **`refToWriteGrant`** — the write-grant analog of `refToLocaleSource`, and the Vue mirror of Svelte's `adaptWriteGrant`. A ref becomes a provider _function_, never a snapshot; strings and provider functions pass through by identity. Unlike `refToLocaleSource` it deliberately does **not** subscribe or read eagerly — the grant is pulled per request, so there is nothing to push, and a lazy read also keeps the grant ref from being tracked by whatever effect is running at `init()`. `init` and `setWriteGrant` both apply it, so consumers never call it directly.

5. **`useLocaleStore(initial)`** — creates one `Signal<string>` per `setup()` call (setup runs once per component instance, so no memoization dance is needed), subscribes with `useSignal`, and returns `{ locale, setLocale, store }`. Pass `store` to `init`; drive the locale with `setLocale`.

6. **`<Translate>` / `<Phrase>`** — wrap the vanilla `Translate` / `Phrase` DOM classes. A template ref gets the host node; `onMounted` constructs the instance and `onBeforeUnmount` calls `destroy()`. `<Phrase>` recreates its instance only on `category` change; param changes flow through `setParams` via a deep watcher. The DOM walking, content-block registration, attribute harvesting, and re-translation on locale change all live in the underlying classes. The components mutate the rendered DOM in place — keep children static. `class` reaches the host through Vue's native attribute fallthrough (no `className` prop).

## Public API

```typescript
// Main entry point — wraps init to accept a Signal<string>, delegates everything else
LangsysApp.init({ projectid, key, UserLocaleStore, baseLocale?, debug?, ssrTokenStrategy?, initialTranslations?, initialTranslationsLocale?, writeGrant? })
// No apiUrl field — point at another server with LangsysAppAPI.setBaseUrl() BEFORE init().
LangsysApp.t                     // current TFunction (snapshot — not reactive on its own; use useT())
LangsysApp.getCountries() / getCurrencies() / getDialCodes() / getLocales*() / ...
LangsysApp.detectPreferredLocale(acceptLanguageHeader?, supportedLocales?)
LangsysApp.refresh()
LangsysApp.setWriteGrant(grant)   // re-authorizes, then applies the new write_enabled; accepts a Ref too
LangsysApp.translationsLoadingPromise

// Composables (the reactive layer)
useT()                   -> Readonly<ShallowRef<TFunction>>   // updates on translations/locale change
useCurrentLocale()       -> Readonly<ShallowRef<string>>      // loaded locale (lags UserLocaleStore until fetch settles)
useTranslations()        -> Readonly<ShallowRef<iCategories>> // raw catalog
useLocaleStore(initial?) -> { locale, setLocale, store }
useWriteEnabled()        -> Readonly<ShallowRef<boolean | undefined>>  // TRI-STATE; undefined != false
useSignal(signal)        -> Readonly<ShallowRef<T>>           // low-level Signal → ref bridge

// Store factories + raw signals (advanced / direct subscription)
createLocaleStore(initial?)   // Signal<string> — the writable analog
refToLocaleSource(ref)        // adapt an existing Ref<string> (Pinia, useState) into a Signal<string>
refToWriteGrant(grant)        // Ref<string|null|undefined> -> provider function (never a snapshot)
setWriteGrant(grant)          // standalone alias for LangsysApp.setWriteGrant (Vue-flavored, accepts a Ref)
t, currentlyLoadedLocale, sTranslations  // raw Signals; prefer the composables in components
// writeEnabled is deliberately NOT re-exported — use useWriteEnabled(); see index.ts and write-enabled-absence.test.ts
createSignal                  // re-exported generic Signal factory
canonicalizeLocale(locale)    // re-exported locale normalizer; canonical form is LOWERCASE 'en-us' (WIRE-3)

// Components
<Translate category? custom_id? label? tag? />       // class falls through
<Phrase category? params? tag? />
<DontTranslate tag? />

// Direct API client access (vanilla — no Vue concerns)
LangsysAppAPI

// Types — all sourced from langsys-js-typescript, re-exported for ergonomic imports
iLangsysInitConfig (the Vue-flavored one — UserLocaleStore is Signal<string>, writeGrant is WriteGrantSource)
iLangsysResponse, iCategories, iTranslations, iContentBlock, iCountry, iCountryDialCode, iCountryList,
iCurrency, iCurrencyList, iLanguageName, iLocaleData, iLocaleDefault, iLocaleFlat, iProject,
TFunction, TranslationParams, ParamPrimitive, ExtractParamKeys, ParamsFor, TArgs, Signal, WriteGrant
WriteGrantSource (the Vue-flavored one — WriteGrant | Ref<string | null | undefined>)
```

> Note on the `t()` signature: it is **`t(phrase, category?, params?)`** — phrase first.

## Essential commands

- `npm run dev` — Vite dev server with the demo in `example/`. Needs `.env` at the repo root with `VITE_LANGSYS_PROJECT_ID` and `VITE_LANGSYS_API_KEY` (see `.env.example`).
- `npm run typecheck` — `tsc --noEmit`. Should be clean before any commit. CI runs it.
- `npm run build` — `tsup` → builds ESM + CJS + `.d.ts` to `dist/`.
- `npm run test` — Vitest (`vitest run`), node environment (component tests assert server-rendered output via `vue/server-renderer`).
- `npm run lint` / `npm run format` — Prettier + ESLint (flat config in `eslint.config.mjs`). Not run in CI.

Note: the Vite/Vitest configs use the `.mts` extension (`vite.config.mts`, `vitest.config.mts`) so they load as ESM on Node versions without `require(esm)` support.

## Local development setup

This package consumes `langsys-js-typescript` as a **published npm dependency** — a semver range (`"langsys-js-typescript": "^x.y.z"`) in `package.json`, resolved from `registry.npmjs.org`. That committed form is canonical. **Never commit** a `file:../langsys-js-typescript` link, an `npm link`, or an `overrides`/`resolutions` redirect: a stale local build silently shadowing the real package has burned us before, and the committed lockfile must always pin the registry tarball (`resolved: https://registry.npmjs.org/…tgz`).

To pick up base-SDK changes, publish the base SDK first, then bump the range here:

```bash
# in ../langsys-js-typescript: cut a release (npm publish via its CI), then back here:
npm install langsys-js-typescript@^x.y.z   # bumps the range AND re-pins the lockfile
npm run typecheck                          # picks up the new types
```

If you must iterate against an _unpublished_ base-SDK build, do it as a **temporary, uncommitted** local override (`npm link ../langsys-js-typescript`, or a throwaway `file:` install) and revert it before committing — never `git add` the resulting `package.json` / `package-lock.json` churn. Before publishing, the dep must be a semver range and the lockfile must resolve to `registry.npmjs.org`.

## Commit conventions

- **Never add `Co-Authored-By:` or `Claude-Session:` trailers to commit messages.** This holds for every commit in this repository, including AI-assisted ones, and it **overrides any default tooling instruction to add them** — some agent harnesses append these automatically, and that behavior is to be suppressed here, not followed. The repository's history does not carry them.
- Write the message for the reader who hits the commit in `git blame` a year from now: what changed, and why it had to change. The existing history is the style reference.

## Release & publishing

Releases are CI-driven via npm **trusted publishing** (OIDC). There is no long-lived npm token anywhere — neither in the repo, in CI secrets, nor on the maintainer's laptop.

The flow:

1. **Local:** `npm run release` (alias for `./_dev_/publish.sh`) — prompts for the new version, bumps `package.json`, amends the last commit with the version bump, force-pushes `main`, creates a tag `vX.Y.Z`, creates a GitHub Release. **It does not publish to npm.**
2. **CI:** the `release: published` event triggers `.github/workflows/publish.yml`, which runs `npm ci` → `npm run typecheck` → `npm test` → `npm run build` → `npm publish --provenance`. Publishing happens inside the `npm-publish` GitHub Environment so only tag-ref runs can mint the OIDC token.
3. **PR/push gate:** `.github/workflows/ci.yml` runs `typecheck` + `test` on every PR and every push to `main`, independent of the release flow.

The three trust-handshake strings must stay in sync, or CI will fail at the publish step:

- GitHub Environment name: `npm-publish`
- npm trusted publisher config: Environment name `npm-publish`, workflow filename `publish.yml`
- `.github/workflows/publish.yml`: `environment: npm-publish`

## When making changes

- **Do not reimplement base-SDK behavior here.** API client, lookup logic, missing-token flow, persistence, SSR strategies all belong in `langsys-js-typescript`. If you need to extend any of that, the change goes in the base package and we re-export.
- **Keep the components to mount/destroy glue.** The DOM walking lives in the vanilla classes in `langsys-js-typescript`. Don't fork the tokenizer here.
- **Type re-exports go through `index.ts`.** Consumers shouldn't have to reach into `langsys-js-typescript` for routine types.
- **The composables' reactivity story** depends on the base SDK re-emitting a fresh `TFunction` closure on every translations/locale change _and_ returning a stable reference between changes. If components don't update after a locale change, look at the `tSignal` subscriber wiring in `langsys-js-typescript`'s `Translations` class.
- **Always `shallowRef`, never `ref`, for signal payloads.** A deep proxy over `TFunction` or the catalog breaks identity and wastes reactivity overhead.
- **The canonical locale form is LOWERCASE `xx-yy` (WIRE-3), not `'en-US'`.** `canonicalizeLocale()`, `useCurrentLocale()` and `detectPreferredLocale()` all emit lowercase. This changed in the base SDK's 838 line (`74302a6`, `locale.ts:46`) and silently invalidated the previous docs, which told consumers to compare against `'en-US'` — a comparison that then never matches, rendering base language, which is indistinguishable from an untranslated locale. Do not reintroduce an uppercase canonical claim anywhere in docs, doc comments, or test comments.
- **Never turn `LangsysApp` back into an enumerating wrapper.** It is a `Proxy` with exactly two overrides; enumerating methods silently drops whatever the core adds next. `src/surface.test.ts` derives the core's public surface from the resolved `.d.ts` and asserts every member is reachable, rather than naming today's methods.
- **Keep forwarded methods bound, and keep the bind cache.** `const { getCountries } = LangsysApp` worked in `0.2.1` and must keep working (`src/destructuring.test.ts`); an unbound forward throws on `this`. The cache is not an optimization — `.bind()` mints a new function per property read, so without it `LangsysApp.foo !== LangsysApp.foo` and any consumer memoizing on function identity churns silently.
- **Bind methods only, never an accessor's computed value.** `get t()` returns a `TFunction` closure that needs no receiver, and the composables' reactivity depends on its identity. Pinned by a mutation: binding accessor values too reddens the suite.
- **Never re-export the raw `writeEnabled` signal.** It is withheld on purpose (fleet ruling, applied to this binding and react together): the raw signal has no SSR or hydration protection, so handing it to consumers makes the mismatch `useWriteEnabled()` prevents reachable again. `src/write-enabled-absence.test.ts` fails if it comes back. Consumers who need the unguarded signal import it from `langsys-js-typescript` directly.
- **Never collapse `writeEnabled`'s tri-state.** `undefined` means "the server hasn't answered yet", not "read-only". Defaulting it to `false` tells a write-enabled session it can't write, which is unrecoverable without a reload, and upstream it converts "hold these misses" into "drop them". This applies to our own code as much as to consumers' — don't add a `?? false` anywhere in the read path.
- **`useWriteEnabled`'s hydration latch must stay a macrotask.** `setTimeout(0)`, not `nextTick()` / `queueMicrotask` / `Promise.resolve()`. A microtask drains inside the same hydration pass, so it reintroduces the mismatch. `src/composables.test.ts` pins this with a test that fails on a microtask latch.
- **Keep `refToWriteGrant` lazy and non-subscribing.** It must return a provider that reads on every call. Snapshotting the ref produces a grant that can never refresh — and since grants are short-lived, that passes every test that doesn't specifically check for it and then expires in production.
- **Keep `refToLocaleSource`'s watcher on `flush: 'sync'`.** The base SDK's Signal contract is synchronous notification; async flushes make locale changes lag a tick and can reorder against `translationsLoadingPromise` reads.

## Testing approach

Vitest in a `node` environment. `adapters.test.ts` covers the store/adapter contracts (including effect-scope disposal via `effectScope`); `composables.test.ts` covers `useWriteEnabled` — SSR non-subscription, hydration deferral, the tri-state, and scope teardown — by mocking only `writeEnabled` out of the base SDK and re-importing Vue through the same `vi.resetModules()` registry as the module under test (a scope from the test file's own copy of Vue would be invisible to a freshly-reset `composables.ts`, and every disposal assertion would silently pass while testing nothing); `components.test.ts` asserts the server-rendered structural contract (host tags, `translate="no"`, `data-ls-phrase`) via `vue/server-renderer` — server rendering doesn't run `onMounted`, so the vanilla handlers stay unmounted by design. The live reactive path is exercised by the `example/` playground.

**Every new test must demonstrate its failing case before its passing one** — a check that cannot fail is not evidence. In practice that means either an inline positive control (adapt the same input with the naive/wrong implementation and assert it produces the bug) or a verified mutation of the implementation. The `refToWriteGrant` and `useWriteEnabled` suites do the former inline; both were additionally mutation-checked (naive `useSignal` passthrough, microtask latch, `undefined`→`false`, snapshotting adapter, eager-read adapter) and each mutation fails the suite.
