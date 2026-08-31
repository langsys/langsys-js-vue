# CONFORMANCE — langsys-js-vue

Conformance of this **binding** against the SDK Behaviour Spec.

|                             |                                                                                                                                                 |
| --------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec version                | **7** (`specVersion: 7`)                                                                                                                        |
| Spec text read              | `docs/sdk-spec.mdx` blob `06ae105a0a1f7b5245ec32929f0b3885c63f0336`, from `langsys2` `origin/main` @ `7bee50d63e7889696b037aec313578d981c7354a` |
| Read at                     | 2026-08-31T14:59:54-06:00                                                                                                                       |
| Repo state                  | branch `feature/838_write_key_gating_reland`, 838 surface landed + this audit                                                                   |
| Suite                       | **32 tests / 3 files**, all passing                                                                                                             |
| Evidence grade of the suite | **`mock`** — node env, core doubled where it matters, zero network                                                                              |
| Core consumed               | `langsys-js-typescript` working copy @ `82678b6`, local `0.6.5` via a gitignored `node_modules` symlink — **not** the published `0.6.5`         |
| Profiles                    | `browser` · `binding` · `all`                                                                                                                   |

**What surfaced while writing this:** four things that were on nobody's list.
(1) `npm install` **silently replaced the core symlink with the registry `0.6.5`** mid-audit —
same version string, zero `setWriteGrant` — so every measurement after it would have run against
a core with no 838 surface and reported green. Caught only by asserting exported symbols at the
gate. (2) The locale-casing defect was **seven sites, not the three** it was reported as, and one
of them (`README` §Detecting the user's preferred locale) was a **copy-pasteable snippet that
silently discards the user's real locale** — `detectPreferredLocale()` returns lowercase, so
`supportedLocales.includes(detected)` against an `'en-US'` list never matches and every user gets
the fallback. (3) **14 pure pass-through wrappers** on `LangsysAppVue` — the identical BIND-6
shape Angular removed 14 of, arrived at independently. (4) Vue's route re-entry is **safe where
Angular's was not**, and the measurement says so in the opposite direction from the prediction:
under `<KeepAlive>` the component instance is genuinely cached (`setup()` does not re-run) and
`t()` is re-entered anyway, because the render function re-runs and templates call `t.value(…)`
fresh every render. The real gap is elsewhere — persistent layouts.

> **Nothing in this file is graded `implemented`, and that is correct.** CONF-2: the shared
> contract fixture does not exist, so `mock` evidence caps every behavioural row at
> `provisional` across all thirteen repos. A binding with no green ticks is the evidence model
> working, not a broken binding.

## Scope — why this file is short

This is a **binding**. It inherits the browser core's profile and adds nothing of its own, so
most of the spec is not its to satisfy: the core owns registration, discovery, interpolation and
identity outright. Grading those rules here would produce rows that cannot fail — the
green-proving-nothing failure CONF-1/CONF-3 exist to stop.

The spec defines **67 rule sections**. This file carries three things:

1. **BIND-1..6** — the binding backbone. Every row, no exceptions.
2. **Rules this binding could _interfere_ with** — where Vue code sits between the app and a core
   decision. Interference is the only way a binding fails a behavioural rule.
3. **One delegation block** for the families the core owns, each with a probe that could have
   found participation and did not.

A rule absent from this file is absent because this binding cannot reach it.

## Grades

| Grade         | Means                                                                                                                                                                                |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `implemented` | Behaviour present, evidence `live` or `contract`. **Unreachable today** — CONF-2.                                                                                                    |
| `provisional` | Behaviour present, evidence `mock`. The honest ceiling until the fixture lands.                                                                                                      |
| `partial`     | Present but incomplete or with a known gap, described in the row.                                                                                                                    |
| `delegated`   | The core owns it and **this binding demonstrably does not participate** — an absence probe plus a positive control proving the probe could have found something. Never a bare "n/a". |
| `n-a`         | Structurally unreachable, with the reason stated and the condition that would make it live.                                                                                          |
| `open`        | A conformance question that is not mine to answer alone. Named, routed, unresolved. **Never green.**                                                                                 |

`delegated` is the fleet program's addition (Reviewer, topic `838-audit-vue`). Its value is the
positive control: "we found nothing" is worthless unless the same search demonstrably finds
something when it is there.

**Two kinds of `n-a`, deliberately distinguished.** A _profile_ `n-a` says the rule belongs to a
profile this SDK is not in; it expires if the rule's Profiles line changes. An _architecture_
`n-a` says this binding's construction cannot reach the behaviour; it expires if the binding
grows the construct named in the row. Both carry their expiry condition, because per the spec an
`n-a` row is the most perishable in the file — nothing in code can ever contradict it.

## 1 — Binding rules (BIND-1..6)

| Rule                                                              | Grade         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| ----------------------------------------------------------------- | ------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **BIND-1** — adapt shape/timing, never meaning                    | `provisional` | Adaptation is confined to Vue's reactivity model: SDK `Signal` → `shallowRef` (`useSignal`), a `flush: 'sync'` watcher for `refToLocaleSource`, three lifecycle-bound components, and the hydration timing guard in `useWriteEnabled`. The guard adapts **when** the value may be read, never what it means — the value is the core's throughout, and the tri-state is passed on undefaulted. Mutation evidence: §Mutation evidence rows 1–3.                                                                                                                                          |
| **BIND-2** — never branch on server-computed capability           | `provisional` | Branches on nothing. `writeEnabled` is surfaced unchanged; no code path in `src/` reads it to decide anything. Probe for a capability branch (`if.*writeEnabled\|writeEnabled.*?\s*\?`): **0 in this binding**, positive control **24** in the core. `key_type` appears nowhere in this binding at all.                                                                                                                                                                                                                                                                                |
| **BIND-3** — owns no network behaviour                            | `delegated`   | Code-only probe (§3 method) for `fetch\|XMLHttpRequest\|setInterval\|retry\|backoff\|headers`: **0 in this binding, 13 in the core**. _(Raw grep returns 1 — a JSDoc sentence; the stripped filter is why the count is 0.)_ This binding issues no request and sets no header.                                                                                                                                                                                                                                                                                                         |
| **BIND-4** — introduces no configuration the core does not define | `provisional` | `iLangsysInitConfig` adds **zero** keys beyond the core's. It only _widens_ two existing ones: `UserLocaleStore` to `Signal<string>` and `writeGrant` to `WriteGrantSource` (`WriteGrant \| Ref<…>`). Both are strict supersets — every vanilla value is still accepted — and both are normalized back to the core's type before delegation. There is deliberately **no `apiUrl` key**; WIRE-5 is met through the core's `LangsysAppAPI.setBaseUrl()`, documented in the README.                                                                                                       |
| **BIND-5** — does not cache lookup results                        | `provisional` | **Zero memoization constructs in `src/`** — probe for `computed(\|memo\|cache\|useMemo\|WeakMap\|new Map(` returns 0. `useT()` returns a `shallowRef<TFunction>` and templates call `t.value(…)` on every render, so a re-render _is_ a re-entry. Measured under `vue-router`, both plain and `<KeepAlive>`: see §Route re-entry. One measured limitation, recorded as a gap rather than hidden: persistent layout components do not re-enter on navigation.                                                                                                                           |
| **BIND-6** — wrap the narrowest surface possible                  | `open`        | **14 pure pass-through wrappers** on `LangsysAppVue` (`refresh`, `getCountries`, `getCountryName`, `getCurrencies`, `getCurrencyName`, `getDialCodes`, `getLocales`, `getLocalesFlat`, `getLocalesData`, `getLocalesFormat`, `getLocaleName`, `getLocaleNameWithLookup`, `getLanguageName`, `detectPreferredLocale`) that add nothing over calling the core. `init` and `setWriteGrant` are **not** in that list — both genuinely adapt. Angular removed exactly 14 of this shape. Not fixed here: removing public surface is a decision for the operator, not an audit. Ranked gap 3. |

## 2 — Rules this binding could interfere with

Vue code sits between the app and the core on exactly two paths: the **composables** (every
programmatic translation) and the **components** (DOM tokenizing). Everything below is graded on
those.

| Rule                                                                  | Grade         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------------------------------------------- | ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GATE-1** — decide from `write_enabled`, never `key_type`            | `delegated`   | The binding makes no register-or-report decision. Probe: `write_enabled\|key_type\|keyType` → **0 in this binding, 24 in the core**.                                                                                                                                                                                                                                                                                                          |
| **GATE-2** — collect always; choose the lane at the send site         | `delegated`   | The binding neither collects nor sends. The one way it could interfere — starving the feed by memoizing in front of `t()` — is structurally absent (BIND-5: 0 memoization constructs). Lane-feed probe (`recordMissForDiscovery\|missingToken\|shouldQueueForWrite`): **0 here, 33 in the core**.                                                                                                                                             |
| **GATE-3** — never persist the write decision                         | `delegated`   | Probe for `localStorage\|sessionStorage\|persist`: **0 in this binding, 7 in the core**. This binding writes to no storage of any kind.                                                                                                                                                                                                                                                                                                       |
| **GATE-4** — strip the decision from what you cache                   | `delegated`   | Probe for `write_enabled\|authData\|envelope\|JSON.stringify\|structuredClone`: **0 in this binding, 35 in the core**. The binding caches no response envelope.                                                                                                                                                                                                                                                                               |
| **GATE-7** — every detecting path feeds exactly one lane              | `partial`     | The binding's detecting paths are `useT()` consumers and the two DOM components. Routed components re-enter `t()` on every navigation (measured, §Route re-entry), so their misses reach the core's lane selection once per URL. **Persistent layouts do not** — Vue does not re-render a component whose reactive dependencies did not change, so a layout's misses are recorded only against the URL present at first render. Ranked gap 2. |
| **GATE-8** — missing `write_enabled` is a version signal              | `provisional` | `useWriteEnabled()` publishes `boolean \| undefined` and never substitutes a default, on every path including SSR and the hydration window. Pinned by `composables.test.ts` ("never substitutes false for 'not known yet'"). Mutation evidence: §Mutation evidence row 3 — defaulting to `false` fails 6 of 10 tests.                                                                                                                         |
| **CAT-1..3** — presence, not truthiness                               | `delegated`   | The binding reads no catalog; presence-vs-value is decided inside `t()`. Probe `sTranslations\[\|categories\[\|hasOwnProperty`: **0 here, 4 in the core**. Nothing here can turn a present-but-null into an absent.                                                                                                                                                                                                                           |
| **GRANT-1** — provider callback, documented as the default form       | `provisional` | `refToWriteGrant` accepts `WriteGrant \| Ref<string\|null\|undefined>`; README and the config JSDoc both name the ref/function form as preferred and say a bare string is a snapshot that expires mid-session.                                                                                                                                                                                                                                |
| **GRANT-2** — resolve per request; never cache the token              | `provisional` | A ref becomes a provider **function**, never a snapshot, and is read lazily — no eager read, no subscribe. Pinned by two tests with inline positive controls. **Mutation evidence, both directions** (§Mutation evidence rows 4–5): too-tight (snapshot the value) fails 5 tests; too-loose (read eagerly at adapt time, still returning a function) fails 4.                                                                                 |
| **GRANT-3** — `setWriteGrant()` re-authorizes                         | `provisional` | `LangsysApp.setWriteGrant()` and the standalone `setWriteGrant()` both normalize then delegate to the core's re-authorizing implementation, and both return its promise so callers can await the new decision. The binding adds no configuration-only path.                                                                                                                                                                                   |
| **GRANT-4** — send the grant as `X-Write-Grant`                       | `delegated`   | Header construction is the core's; probe `headers\|X-Write-Grant` → **0 in this binding, 13 in the core**.                                                                                                                                                                                                                                                                                                                                    |
| **SSR-1** — under `client`, do not collect server-side                | `provisional` | `useWriteEnabled()` returns a detached ref and never subscribes when `typeof window === 'undefined'`; both DOM components construct their vanilla handlers in `onMounted`, which server rendering never runs. `components.test.ts` asserts the server-rendered structural output with the handlers unmounted by design.                                                                                                                       |
| **SSR-2/SSR-3** — degrade loudly; allow-list the origin               | `delegated`   | Strategy selection and the degrade warning are the core's; the binding passes `ssrTokenStrategy` through untouched and holds no strategy logic. Probe `ssrTokenStrategy` → 0 decision sites here.                                                                                                                                                                                                                                             |
| **WIRE-3** — lowercase `xx-yy` on the wire and internally             | `provisional` | The binding normalizes nothing itself — locale values pass through `createLocaleStore`/`refToLocaleSource` verbatim and the core canonicalizes. **This audit corrected seven documentation sites** that asserted the pre-838 uppercase form; see §The casing correction. `canonicalizeLocale` is re-exported so consumers can normalize their own values.                                                                                     |
| **WIRE-5** — reachable test double, documented where integrators look | `provisional` | No artifact edit is needed to point the SDK at a double: `LangsysAppAPI` is re-exported and the README carries a dedicated "Pointing the SDK at a different API server" section showing `setBaseUrl()` before `init()`. The README also states explicitly that no `apiUrl` init field exists, which is the trap this rule's absence would otherwise leave.                                                                                    |
| **OBS-1** — surface an unusable capability at least once              | `delegated`   | Core-owned by the same reasoning accepted for Angular: the core makes the gate decision, so the core emits the diagnostic; a binding duplicating it would be BIND-2's shape. Probe `logger\|console.warn` in `src/`: **0**, core control non-zero.                                                                                                                                                                                            |
| **CACHE-1** — cache keys namespaced by project                        | `n-a`         | _Architecture n-a._ The binding holds no cache of any kind — 0 memoization constructs in `src/` (BIND-5 probe). Nothing here is process-external or shared. **Expires if** this binding ever introduces a memo, a `Map`, or any cross-render store.                                                                                                                                                                                           |

## 3 — Delegation block: families the core owns

The binding does not participate in any of these. Each row states the probe and the positive
control that proves the probe works.

**Probe method.** Every count is **code only** — comment and JSDoc lines are stripped before
counting, because this binding's prose mentions "fetch", "discovery" and "registered" constantly
while its code does none of it. The exact filter:

```bash
probe() {  # $1 = pattern, $2 = tree
  grep -rnE "$1" "$2" --include='*.ts' | grep -v '\.test\.ts' | grep -vE ':[0-9]+: *(\*|//|/\*)'
}
```

| Family                       | Grade                                 | Probe pattern                                                | binding | core (control) |
| ---------------------------- | ------------------------------------- | ------------------------------------------------------------ | ------- | -------------- |
| **REG-1..12** (write lane)   | `delegated`                           | `batch\|flush\|queue\|keepalive\|sendBeacon`                 | **1**\* | 38             |
| **HINT-1..12** (report lane) | `delegated`                           | `window.location\|location.href\|pathname\|normalizeHintUrl` | **0**   | 3              |
| **ICU-1..5** (interpolation) | `delegated`                           | `interpolate\|isICU\|plural\|select,`                        | **0**   | 14             |
| **CID-1..4** (`custom_id`)   | `delegated`                           | `generateCustomId\|md5\|custom_id`                           | **4**†  | 31             |
| **CONF-1..3** (evidence)     | n/a — governs this file, not the code | —                                                            | —       |

\* The single REG hit is `adapters.ts:76`, `watch(localeRef, …, { flush: 'sync' })` — Vue's
watcher **scheduling** flush, not a network flush. Pattern false positive, kept visible rather
than tuned away.

† All four CID hits are `custom_id` **prop plumbing** in `components/Translate.ts` (`:14`, `:49`,
`:63`, `:70`) — the consumer's opt-in id passed through to the core. No hash is computed here;
`generateCustomId` and `md5` appear **0** times in this binding.

**HINT-6 / hash-mode routes specifically.** Raised as a Vue-shaped risk (vue-router's
`createWebHashHistory`). This binding does not participate: it never reads `window.location` and
never constructs a hint URL. The behaviour is the core's, at `discovery.ts:370`, and the core's
`fragmentParamNames()` already handles the hash-router cases deliberately — `#/callback?code=…`,
the OAuth implicit-flow `#access_token=…`, and `#/pricing` / `#section` explicitly not read as
parameters. Recorded as `delegated`, not as a Vue gap.

## Route re-entry — the BIND-5 / GATE-7 measurement

Angular's defect was an impure pipe memoizing in front of `t()`, so a route change did not
re-enter and discovery never saw the new URL. **Vue's shape is different and the difference is
measurable**, so it was measured rather than argued.

Harness: real `vue-router` (`createWebHashHistory`), jsdom, the binding's real `useT()`, the
core's `tSignal` doubled with a counting `TFunction`. Two routes, navigate A→B→A. Counts are
`t()` invocations observed by the double; `setup()` counts distinguish a re-created component
from a cached one.

| Configuration                       | nav A→B        | nav B→A        | `setup()` re-ran on B→A | persistent layout re-entered |
| ----------------------------------- | -------------- | -------------- | ----------------------- | ---------------------------- |
| plain `<RouterView>`                | `t()` ×1 (`B`) | `t()` ×1 (`A`) | yes                     | **no**                       |
| `<KeepAlive>` around `<RouterView>` | `t()` ×1 (`B`) | `t()` ×1 (`A`) | **no**                  | **no**                       |

Two findings:

1. **`<KeepAlive>` does not starve the lane.** The `setup()` column is the control that makes
   this meaningful: on B→A under `<KeepAlive>`, `setup()` did **not** re-run — the instance was
   genuinely cached, so the harness really did exercise keep-alive — and `t()` was re-entered
   anyway. Vue re-renders a reactivated component, and because `useT()` hands back a
   `shallowRef<TFunction>` that templates call on every render, re-render _is_ re-entry. There is
   no memo to key on `location.href`, which is why Angular's fix has no analogue here.
2. **Persistent layouts do not re-enter.** A component outside `<RouterView>` — a header, nav, or
   footer calling `t()` — is not re-rendered on navigation, because none of its reactive
   dependencies changed. Its misses are therefore recorded against the URL present at first
   render only. This is inherent to reactive rendering rather than a defect this binding
   introduced (it adds no memoization at all), but it is a real coverage limitation for GATE-7
   and is ranked as gap 2 rather than written off.

## The casing correction — WIRE-3

The base SDK's 838 line changed `canonicalizeLocale` to emit the lowercase wire form
(`74302a6`, `locale.ts:46`: `return canonical ?? cleaned` → `return (canonical ?? cleaned).toLowerCase()`).
Measured against both builds rather than read:

| call                                    | published `0.6.5` | 838 core  |
| --------------------------------------- | ----------------- | --------- |
| `canonicalizeLocale('en-us')`           | `'en-US'`         | `'en-us'` |
| `canonicalizeLocale('es-ES')`           | `'es-ES'`         | `'es-es'` |
| `detectPreferredLocale(hdr)`            | —                 | `'en-us'` |
| `detectPreferredLocale(hdr, ['en-US'])` | —                 | `'en-us'` |

The change is **correct** — WIRE-3 v4 says the canonical form is lowercase `xx-yy`, matching the
API. The defect was that it was silent, and this repo's documentation still taught the old form
in **seven** places. All seven are corrected on this branch:

| site                      | was                                                                   |
| ------------------------- | --------------------------------------------------------------------- |
| `README.md:90`            | "always return the canonical form (`'en-US'`)"                        |
| `README.md:361`           | "(`'en-us'` → `'en-US'`)"                                             |
| `README.md` §detect       | "Returns `'en-US'`, `'fr'`, etc."                                     |
| `README.md` §detect       | "exact match first (e.g. `en-US`)"                                    |
| `README.md` §detect       | the `\|\| 'en-US'` fallback example                                   |
| `CLAUDE.md:74`            | "re-exported BCP 47 normalizer (`'en-us'` → `'en-US'`)"               |
| `src/adapters.ts:44`      | "`currentlyLoadedLocale` always emits the canonical form (`'en-US'`)" |
| `src/adapters.test.ts:37` | "canonicalizes it to BCP 47 (`'en-us'` → `'en-US'`)"                  |

The worst of them was not a claim but a **working snippet**. The README's recommended guard read:

```typescript
const detected = LangsysApp.detectPreferredLocale(header, supportedLocales);
const locale = detected && supportedLocales.includes(detected) ? detected : 'en-US';
```

`detected` comes back `'en-us'`; a `supportedLocales` list holding `'en-US'` never contains it,
so the guard falls through for **every** user and silently discards the locale they actually
asked for — rendering base language, which is indistinguishable from a locale nobody has
translated yet. The snippet now canonicalizes both sides.

Stale-phrase verification, run after the edits:

```
grep -rnE "→ .?'en-US'|canonical form \(.?'en-US'|Returns 'en-US'|canonical BCP 47 \(" README.md CLAUDE.md src/*.ts
→ 0 matches (expected 0)
```

Locale literals that remain uppercase are **inputs**, not claims about canonical output —
`createLocaleStore('en-US')`, `baseLocale: 'en-US'`, and the pass-through test fixtures. Those
are legitimate: the binding's contract is that it forwards what it is given and the core
canonicalizes. One observation, not graded: `createLocaleStore`'s default parameter is `'en-US'`,
which the core lowercases on receipt. Harmless, but an uppercase default in a WIRE-3 world is a
smell; changing it is a behaviour change and was not made here.

## Hydration latch — the `useWriteEnabled` gate

`composables.ts` defers adopting the live `writeEnabled` value until a **macrotask**
(`setTimeout(0)`), latched by a module-level `pastHydration` flag keyed on the first _call_.

The identity contract this depends on is now pinned core-side: `cd07df1` — _"test: pin the
TFunction identity contract at both enforcing sites"_ — establishes that `Signal.set` drops a
value `Object.is`-equal to the current one, so a fresh `TFunction` per emit is what tells every
subscriber anything happened. Core `translations.ts:99-108` states it directly: identity **is**
the change signal every binding relies on. Vue's `shallowRef` bridge is exactly such a
subscriber, so a memoized `buildTFn` upstream would silently stop this binding re-rendering.

Why a macrotask and not `nextTick()`: a microtask still drains inside the same hydration pass,
which reintroduces the mismatch the latch exists to prevent. Pinned by a dedicated test that
fails on a microtask latch.

## Mutation evidence (CONF-3)

Each mutation was applied to the implementation, the suite run, and the implementation restored.
Counts are failures of the suite.

| #   | Mutation                                                                      | Target          | Result                   |
| --- | ----------------------------------------------------------------------------- | --------------- | ------------------------ |
| 1   | `useWriteEnabled` → naive `useSignal(writeEnabled)` passthrough               | SSR + hydration | **4 failed** / 6 passed  |
| 2   | Hydration latch → microtask (`Promise.resolve().then`)                        | latch shape     | **1 failed** / 9 passed  |
| 3   | Tri-state defaulted `undefined` → `false`                                     | GATE-8          | **6 failed** / 4 passed  |
| 4   | `refToWriteGrant` snapshots the ref instead of providing (too tight)          | GRANT-2         | **5 failed** / 10 passed |
| 5   | `refToWriteGrant` reads eagerly at adapt time, still returns a fn (too loose) | GRANT-2         | **4 failed** / 11 passed |
| —   | restored baseline                                                             | —               | 32 passed                |

Mutation 5 is the one worth keeping: it still returns a **function**, so a test asserting only
"the adapter produced a provider" stays green. Only the read-count assertion separates it from
the correct implementation — which is why the assertion, not the shape, is what the test pins.

## Ranked gaps

Ranked by what the gap costs, not by rule order.

1. **No upstream-precondition test (CONF-3, and it bit during this audit).** Nothing in the suite
   asserts that the core actually exports the 838 surface. `npm install` replaced the symlink
   with the registry `0.6.5` mid-audit — identical version string, **zero** `setWriteGrant` — and
   the suite would still have gone green, because the tests that touch `writeEnabled` double it.
   Cost: **false green on the whole 838 surface**, silently, whenever anyone runs `npm install`.
   The fix is Angular's `upstream-precondition.spec.ts` shape: assert `writeEnabled` is an
   object, `setWriteGrant` and `generateCustomId` are functions, `autoDiscovery` is an object —
   the last as a control. Not written here: this lane was authorized as audit-and-document.
2. **GATE-7 coverage for persistent layouts.** A header/nav/footer calling `t()` does not
   re-render on client-side navigation, so its misses are only ever attributed to the first URL
   of the session. Cost: **under-reported discovery** on exactly the components most likely to
   hold shared chrome copy. Needs a core-side or documented answer, not a binding memo — routing
   it to Typescript is the next step, since the core is where per-URL re-recording lives.
3. **BIND-6 — 14 pure pass-through wrappers.** `LangsysAppVue` re-implements 14 core methods that
   add nothing. Cost: **surface drift** — every core signature change needs a matching edit here,
   and a missed one silently narrows the binding. Angular removed 14 of the same shape. Removing
   public surface is an operator decision, not an audit's.
4. **No rendered-output capability assertion.** `components.test.ts` asserts server-rendered
   structure, and the route-re-entry harness asserted rendered text — but that harness is a
   scratch artifact, not committed, so per CONF-2 it is a memory, not a test. Nothing committed
   asserts a _capability_ (`writeEnabled`) through rendered output; the existing tests assert ref
   values. Cost: **"ref correct" ≠ "user sees it"** — low likelihood, but the whole tri-state
   exists to drive UI.
5. **Raw `writeEnabled` signal is exported.** Svelte exports its own hydration-safe store under
   that name and Angular withholds the raw signal entirely — but **React re-exports the raw core
   signal exactly as this binding does** (`react/src/index.ts:47`), so this is a two-of-five
   split, not a Vue outlier. The export carries a doc comment warning it has no hydration
   protection and directing consumers to `useWriteEnabled()`. It is also **unreleased** — it
   arrived with the 838 branch — so withdrawing it would break nobody. `open`: worth one fleet
   ruling covering Vue and React together rather than two local answers.

## Reproducing this file's evidence

```bash
# 0. Assert the core symlink is live AT THE GATE — npm install silently replaces it.
node --input-type=module -e "
const m = await import('langsys-js-typescript');
const want = {writeEnabled:'object', setWriteGrant:'function', autoDiscovery:'object', generateCustomId:'function'};
for (const [k,t] of Object.entries(want)) {
  if (!(k in m) || typeof m[k] !== t) { console.error('STALE CORE:', k); process.exit(1); }
}
console.log('core OK');"

# 1. Delegation probes (comment-stripped; see §3 for the filter)
probe() { grep -rnE "$1" "$2" --include='*.ts' | grep -v '\.test\.ts' | grep -vE ':[0-9]+: *(\*|//|/\*)'; }
probe 'fetch|XMLHttpRequest|setInterval|retry|backoff|headers' src/          # expect 0
probe 'fetch|XMLHttpRequest|setInterval|retry|backoff|headers' ../langsys-js-typescript/src   # control: 13

# 2. Stale-casing census (expect 0)
grep -rnE "→ .?'en-US'|canonical form \(.?'en-US'|Returns 'en-US'|canonical BCP 47 \(" README.md CLAUDE.md src/*.ts

# 3. Suite + gate
npm run typecheck && npm test && npm run build
```

The route-re-entry harness (§Route re-entry) needs `vue-router` and `jsdom`, which are **not**
dependencies of this package; it was run as a throwaway under
`npm install --no-save --no-package-lock` and removed. Per CONF-2 that makes its numbers
reproducible-with-setup but not a committed test — which is why gap 4 exists rather than a
`provisional` row claiming it.

## Summary

Counts computed from the tables above (BIND-1..6, §2, and the §3 delegation block counted as one
row per family).

| Grade          | Count  |
| -------------- | ------ |
| `implemented`  | 0      |
| `provisional`  | 11     |
| `partial`      | 1      |
| `delegated`    | 13     |
| `n-a`          | 1      |
| `open`         | 1      |
| **Total rows** | **27** |

`implemented` is 0 by construction (CONF-2, no contract fixture). The single `open` row is
BIND-6's wrapper surface. The raw-`writeEnabled`-export question (ranked gap 5) is deliberately
**not** a graded row — it is a fleet-consistency decision spanning Vue and React, not a claim
about this binding's behaviour, and grading it here would imply this repo can settle it alone.

These counts are computed from the tables above, not asserted. Writing them by hand first
produced `provisional 12 / delegated 13 / open 2 / total 29` and missed that **CAT-1..3 was
graded twice** — once in §2 and again in the §3 delegation block. Both are corrected above; the
duplicate row is removed and §2 holds the CAT grade, since its reasoning is binding-specific.
Recount with:

```bash
python3 - <<'EOF'
import re, collections, pathlib
GRADES={'implemented','provisional','partial','delegated','n-a','open'}
rows=[]
for line in pathlib.Path('CONFORMANCE.md').read_text().splitlines():
    if not line.startswith('|'): continue
    cells=[c.strip() for c in line.strip().strip('|').split('|')]
    if len(cells)>=2 and cells[1].strip('`') in GRADES and re.match(r'^\*{0,2}[A-Z]{2,}-', cells[0]):
        rows.append((cells[0], cells[1].strip('`')))
print(collections.Counter(g for _,g in rows), len(rows))
EOF
```
