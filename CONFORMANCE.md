# CONFORMANCE — langsys-js-vue

Conformance of this **binding** against the SDK Behaviour Spec.

|                             |                                                                                                                                                                                                                                                                                                                                                                                                                           |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Spec version                | **7** (`specVersion: 7`)                                                                                                                                                                                                                                                                                                                                                                                                  |
| Spec text read              | `docs/sdk-spec.mdx` blob `45cdddf8e9136a85143dc5a5169d59b3355d7dc1`, from `langsys2` `origin/main` @ `f1179ad6a0816af7a0163e87e30b1c3ac9ca207b` (re-derived at write time: `git -C ~/Documents/dev/langsys2 ls-tree origin/main docs/sdk-spec.mdx`)                                                                                                                                                                       |
| Read at                     | 2026-09-09T20:42:09-06:00                                                                                                                                                                                                                                                                                                                                                                                                 |
| Repo state                  | branch `feature/838_write_key_gating_reland`, 838 surface landed + this audit + fix lane complete (all in-repo gaps closed)                                                                                                                                                                                                                                                                                               |
| Suite                       | **88 tests / 10 files**, all passing (includes the 5-test upstream precondition, the 29-test BIND-6 surface guard, the 3-test exported-type probe and the 5-test destructuring pin)                                                                                                                                                                                                                                       |
| Evidence grade of the suite | **`mock`** — node env, core doubled where it matters, zero network                                                                                                                                                                                                                                                                                                                                                        |
| Core consumed               | `langsys-js-typescript` working copy @ `c010f32`, local `0.6.5` via a gitignored `node_modules` symlink — **not** the published `0.6.5`. Every probe count below is re-derived at the tip of this branch against this SHA, with the filter published in §3 — **not carried from a previous revision**. Two changed with the bind commit: BIND-5 and CACHE-1, both because that commit edited the file the probe runs over |
| Profiles                    | `browser` · `binding` · `all`                                                                                                                                                                                                                                                                                                                                                                                             |

**What surfaced while writing this:** four things that were on nobody's list.
(1) `npm install` **silently replaced the core symlink with the registry `0.6.5`** mid-audit —
same version string, zero `setWriteGrant` — so every measurement after it would have run against
a core with no 838 surface and reported green. Caught only by asserting exported symbols at the
gate. (2) The locale-casing defect was **nine sites, not the three** it was reported as, and one
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

The spec defines **67 rule sections**. Note that spec blob `45cdddf8` re-profiled **GRANT-1..4 from `all` to `browser`** and added a server clause (a server SDK MUST NOT send `X-Write-Grant`). This binding is `browser`, so every GRANT row below still applies and none changed grade; the header records which blob the counts were computed against.

This file carries three things:

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

| Rule                                                              | Grade         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| ----------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| **BIND-1** — adapt shape/timing, never meaning                    | `provisional` | Adaptation is confined to Vue's reactivity model: SDK `Signal` → `shallowRef` (`useSignal`), a `flush: 'sync'` watcher for `refToLocaleSource`, three lifecycle-bound components, and the hydration timing guard in `useWriteEnabled`. The guard adapts **when** the value may be read, never what it means — the value is the core's throughout, and the tri-state is passed on undefaulted. Mutation evidence: §Mutation evidence rows 1–3.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **BIND-2** — never branch on server-computed capability           | `provisional` | Branches on nothing. `writeEnabled` is surfaced only through `useWriteEnabled()`, which passes the core's value on undefaulted (the raw signal is withheld — see the fix-lane note under Ranked gaps); no code path in `src/` reads it to decide anything. Probe for a capability branch (`if.*writeEnabled\|writeEnabled.*?\s*\?`): **1 in this binding†**, positive control **5** in the core. `key_type` appears nowhere in this binding at all.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **BIND-3** — owns no network behaviour                            | `delegated`   | Code-only probe (§3 method) for `fetch\|XMLHttpRequest\|setInterval\|retry\|backoff\|headers`: **0 in this binding, 13 in the core**. _(Raw grep returns 1 — a JSDoc sentence; the stripped filter is why the count is 0.)_ This binding issues no request and sets no header.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **BIND-4** — introduces no configuration the core does not define | `provisional` | `iLangsysInitConfig` adds **zero** keys beyond the core's. It only _widens_ two existing ones: `UserLocaleStore` to `Signal<string>` and `writeGrant` to `WriteGrantSource` (`WriteGrant \| Ref<…>`). Both are strict supersets — every vanilla value is still accepted — and both are normalized back to the core's type before delegation. There is deliberately **no `apiUrl` key**; WIRE-5 is met through the core's `LangsysAppAPI.setBaseUrl()`, documented in the README.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **BIND-5** — does not cache lookup results                        | `provisional` | Probe for `computed(\|memo\|cache\|useMemo\|WeakMap\|new Map(` returns **2**, both in the proxy's bound-member cache (`index.ts:286-287`). **Re-derived at the tip; this row said 0 and that was true only up to `bf949b0`.** The cache holds _bound function wrappers keyed by member name_, never a lookup result — `t()` is not memoized and no translation, catalog entry or locale is stored, so the rule's subject is untouched. It exists because `.bind()` mints a new function per property read; see the CACHE-1 row for why it is not a cache in that rule's sense either. `useT()` returns a `shallowRef<TFunction>` and templates call `t.value(…)` on every render, so a re-render _is_ a re-entry. Measured under `vue-router`, both plain and `<KeepAlive>`, by `route-reentry.test.ts` (6 tests): see §Route re-entry. Mutation evidence: a module-level memo in front of `t()` — Angular's shipped shape — fails **3 of 6**; a per-instance memo fails the discriminating keep-alive case. One measured limitation, pinned by a test rather than hidden: persistent layout components do not re-enter on navigation.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **BIND-6** — wrap the narrowest surface possible                  | `provisional` | `LangsysApp` is a **`Proxy` over the core singleton**, forwarding every member by reference with exactly two overrides (`init`, `setWriteGrant` — the only two that adapt Vue shapes under accepted deviation A). The 14 pure pass-through wrappers are gone. **Corrected 2026-09-09:** this row previously said the change fixed a live defect in which the old class had "already silently dropped five core methods". It had not — see §The five that were never dropped. Measured against the core's `.d.ts`, the old wrapper dropped **0 public members**; the five named are core-`private`. The proxy removes a _failure mode_ — a hand-written list cannot fail when the core grows a member — not a shipped defect. Forwarded **methods** are **bound to the core instance** and cached (fleet ruling, topic `838-bind6-v2-vue`): `0.2.1` shipped `const { getCountries } = LangsysApp` working, and unbound forwarding threw on it for installed consumers — BIND-1 forbids widening what the core offers, not keeping what this binding already shipped. Accessor values (`get t()`) pass through unwrapped, since `TFunction` identity is load-bearing for reactivity. Identity assertions became forwarding assertions: a spy proves a detached call runs with the core as receiver. `surface.test.ts` (29 tests) derives the public/private split from the resolved `.d.ts` and names no private member; `surface-types.test.ts` pins that the exported type still excludes them. Mutation evidence, re-derived against the bound implementation: removing `.bind` **6F**, removing the identity cache **1F**, binding accessor values too **1F**, hiding an override **1F**, dropping one public member **3F**. |

## 2 — Rules this binding could interfere with

Vue code sits between the app and the core on exactly two paths: the **composables** (every
programmatic translation) and the **components** (DOM tokenizing). Everything below is graded on
those.

| Rule                                                                  | Grade         | Evidence                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                        |
| --------------------------------------------------------------------- | ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| **GATE-1** — decide from `write_enabled`, never `key_type`            | `delegated`   | The binding makes no register-or-report decision. Probe: `write_enabled\|key_type\|keyType` → **0 in this binding, 25 in the core**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                            |
| **GATE-2** — collect always; choose the lane at the send site         | `delegated`   | The binding neither collects nor sends. The one way it could interfere — starving the feed by memoizing in front of `t()` — is structurally absent (BIND-5: 0 memoization constructs). Lane-feed probe (`recordMissForDiscovery\|missingToken\|shouldQueueForWrite`): **0 here, 33 in the core**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| **GATE-3** — never persist the write decision                         | `delegated`   | Probe for `localStorage\|sessionStorage\|persist`: **0 in this binding, 7 in the core**. This binding writes to no storage of any kind.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **GATE-4** — strip the decision from what you cache                   | `delegated`   | Probe for `write_enabled\|authData\|envelope\|JSON.stringify\|structuredClone`: **0 in this binding, 36 in the core**. The binding caches no response envelope.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                 |
| **GATE-7** — every detecting path feeds exactly one lane              | `partial`     | The binding's detecting paths are `useT()` consumers and the two DOM components. Routed components re-enter `t()` on every navigation (measured, §Route re-entry), so their misses reach the core's lane selection once per URL. **Persistent layouts do not** — Vue does not re-render a component whose reactive dependencies did not change, so a layout's misses are recorded only against the URL present at first render. Ranked gap 1, and pinned by `route-reentry.test.ts` so it cannot change silently in either direction.                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **GATE-8** — missing `write_enabled` is a version signal              | `provisional` | `useWriteEnabled()` publishes `boolean \| undefined` and never substitutes a default, on every path including SSR and the hydration window. Pinned by `composables.test.ts` ("never substitutes false for 'not known yet'"). Mutation evidence: §Mutation evidence row 3 — defaulting to `false` fails 6 of 10 tests.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **CAT-1..3** — presence, not truthiness                               | `delegated`   | The binding reads no catalog; presence-vs-value is decided inside `t()`. Probe `sTranslations\[\|categories\[\|hasOwnProperty`: **1 here\*, 4 in the core**. Nothing here can turn a present-but-null into an absent.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                           |
| **GRANT-1** — provider callback, documented as the default form       | `provisional` | `refToWriteGrant` accepts `WriteGrant \| Ref<string\|null\|undefined>`; README and the config JSDoc both name the ref/function form as preferred and say a bare string is a snapshot that expires mid-session.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                  |
| **GRANT-2** — resolve per request; never cache the token              | `provisional` | A ref becomes a provider **function**, never a snapshot, and is read lazily — no eager read, no subscribe. Pinned by two tests with inline positive controls. **Mutation evidence, both directions** (§Mutation evidence rows 4–5): too-tight (snapshot the value) fails 5 tests; too-loose (read eagerly at adapt time, still returning a function) fails 4.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                   |
| **GRANT-3** — `setWriteGrant()` re-authorizes                         | `provisional` | `LangsysApp.setWriteGrant()` and the standalone `setWriteGrant()` both normalize then delegate to the core's re-authorizing implementation, and both return its promise so callers can await the new decision. The binding adds no configuration-only path.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                     |
| **GRANT-4** — send the grant as `X-Write-Grant`                       | `delegated`   | Header construction is the core's; probe `headers\|X-Write-Grant` → **0 in this binding, 5 in the core**.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **SSR-1** — under `client`, do not collect server-side                | `provisional` | `useWriteEnabled()` returns a detached ref and never subscribes when `typeof window === 'undefined'`; both DOM components construct their vanilla handlers in `onMounted`, which server rendering never runs. `components.test.ts` asserts the server-rendered structural output with the handlers unmounted by design.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                         |
| **SSR-2/SSR-3** — degrade loudly; allow-list the origin               | `delegated`   | Strategy selection and the degrade warning are the core's; the binding passes `ssrTokenStrategy` through untouched and holds no strategy logic. Probe `ssrTokenStrategy` → **0 in this binding, 10 in the core** — the control this row previously lacked.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **WIRE-3** — lowercase `xx-yy` on the wire and internally             | `provisional` | The binding normalizes nothing itself — locale values pass through `createLocaleStore`/`refToLocaleSource` verbatim and the core canonicalizes. **This audit corrected seven documentation sites** that asserted the pre-838 uppercase form; see §The casing correction. `canonicalizeLocale` is re-exported so consumers can normalize their own values.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                       |
| **WIRE-5** — reachable test double, documented where integrators look | `provisional` | No artifact edit is needed to point the SDK at a double: `LangsysAppAPI` is re-exported and the README carries a dedicated "Pointing the SDK at a different API server" section showing `setBaseUrl()` before `init()`. The README also states explicitly that no `apiUrl` init field exists, which is the trap this rule's absence would otherwise leave.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| **OBS-1** — surface an unusable capability at least once              | `delegated`   | Core-owned by the same reasoning accepted for Angular: the core makes the gate decision, so the core emits the diagnostic; a binding duplicating it would be BIND-2's shape. Probe `logger\|console.warn` in `src/`: **0**, core control non-zero.                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                              |
| **CACHE-1** — cache keys namespaced by project                        | `n-a`         | _Architecture n-a._ **This row's expiry condition fired and was re-derived rather than left standing.** It read "expires if this binding ever introduces a memo, a `Map`, or any cross-render store", and the bind commit introduced a `Map` (`index.ts:241`). Re-examined at the tip: the grade survives, and here is why it is not a dodge. CACHE-1 governs caches keyed on _answers_ — catalogs, translations, anything whose correctness depends on the project, locale or session it was fetched for. `boundMembers` holds **bound function wrappers keyed by member name**, contains no server-derived data, and is invalidated by source identity rather than by any key the rule would namespace. It is also process-local and per-module, so nothing crosses a project or a user. **Expires again if** this binding ever stores a value derived from a request — a translation, a catalog, a locale resolution — at which point the namespacing question becomes real. |

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

\* The single CAT hit is `index.ts:277`, `Object.prototype.hasOwnProperty.call(overrides, prop)` — the
proxy trap's own override bookkeeping, not a catalog read. It appeared the moment the BIND-6 proxy
landed, which is the practical lesson: **re-baseline every probe after the commit that edits the files
they run over**, not before it. This row read `0` for exactly one commit's worth of time.

† The single BIND-2 hit is `composables.ts:137`, `if (pastHydration) return useSignal(writeEnabled);`
— the branch is on `pastHydration`, a hydration-timing flag; `writeEnabled` appears later on the same
line only as the subscription target. A pattern false positive, published rather than tuned away, per
the REG/CID practice below. "Branches on nothing" is unaffected: no path reads the capability value to
decide anything. This row's control also read `24`, copied from GATE-1's row — the same transcription
slip as GRANT-4's `13`, and the reason both are now re-derived rather than quoted.

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
   and is ranked as gap 1 rather than written off.

## The five that were never dropped — a correction of a correction

The 2026-08-31 audit reported that replacing the enumerating wrapper with a proxy had recovered
**five silently dropped core methods** — `applyAuthorization`, `getUserLanguagePreferences`,
`parseAcceptLanguageHeader`, `findBestLocaleMatch`, `resolveLocale` — and called it a live defect
rather than the surface drift it had originally been graded. **That was wrong, and the error was
mine.** The Reviewer caught it (topic `838-bind6-v2-vue`, 2026-09-09) after the same claim,
independently reproduced in Solid, was escalated into a fleet-wide defect class.

**What is actually true.** All five are declared `private` in the core:

| evidence                                          | result                                                                                    |
| ------------------------------------------------- | ----------------------------------------------------------------------------------------- |
| `src/langsys-app.ts`                              | `private` at `:84`, `:494`, `:513`, `:537`, `:567`                                        |
| `dist/index.d.ts` class body                      | emitted explicitly as `private applyAuthorization;` etc. — declared, not merely absent    |
| `git log -S"public <name>" -- src/langsys-app.ts` | **0 commits** — none was ever public                                                      |
| control                                           | `getCountries` is `public async` at `src:342` and carries a full signature in the `.d.ts` |

TypeScript's `private` is **erased at runtime**. A prototype walk — which is how the original
claim was produced — finds every private method and reports it as a member the binding failed to
expose. The walk was right about reachability and wrong about entitlement.

**The measured number.** Classifying the core's runtime members against its `.d.ts` class body
(`private NAME;` → private, a real signature → public) gives 17 public and 5 private, with zero
unclassified. The old wrapper exposed all 17. So:

> **The old wrapper dropped 0 public members and 5 core-private ones that were never API.**

Four controls make that classification non-vacuous, and the third caught a real bug in the first
version of the classifier, which matched only `name(` and so filed the getter `t` under private:

1. `resolveLocale` is excluded from public.
2. `getCountries` is included in public.
3. the getter `t` is classified public.
4. marking `getCountries` private in a scratch `.d.ts` moves it out of the public column.

**What survives.** The proxy is still the right mechanism, on the risk rather than on an incident:
a hand-written list cannot fail when the core grows a member, because nothing references what is
missing. What does not survive is the claim that anything had already been lost — and, with it,
the justification the fleet ruling was built on.

**What this cost.** The wrong claim was load-bearing twice over: it upgraded this row from
`surface drift` to `live defect`, and it agreed with Solid's independent measurement, which is
what made a fleet-wide ruling look confirmed rather than merely consistent. Two measurements
sharing a method share its blind spot; agreement between them is not independent evidence. The
tests were corrected the same way — `surface.test.ts` now derives the public/private split from
the `.d.ts` rather than hard-coding five names, so a legitimate core refactor no longer reddens
this suite, and no test or document here presents a core-private name as API.

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

The change is **correct** — WIRE-3 (spec v7) says the canonical form is lowercase `xx-yy`, matching the
API. The defect was that it was silent, and this repo's documentation still taught the old form
in **nine** places — counted from the diff, not from prose. All nine are corrected on this branch:

| site                      | was                                                                   |
| ------------------------- | --------------------------------------------------------------------- |
| `README.md:90`            | "always return the canonical form (`'en-US'`)"                        |
| `README.md:361`           | "(`'en-us'` → `'en-US'`)"                                             |
| `README.md` §detect       | "Returns `'en-US'`, `'fr'`, etc."                                     |
| `README.md` §detect       | "exact match first (e.g. `en-US`)"                                    |
| `README.md` §detect       | the `\|\| 'en-US'` fallback example                                   |
| `CLAUDE.md:74`            | "re-exported BCP 47 normalizer (`'en-us'` → `'en-US'`)"               |
| `src/adapters.ts:44`      | "`currentlyLoadedLocale` always emits the canonical form (`'en-US'`)" |
| `README.md` §detect       | the `includes()` guard's `'en-US'` fallback literal                   |
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

**Closed in the follow-up fix lane** (were gaps 1, 2*, 4 and 5 — *the BIND-6 gap, since renumbered):

- **Upstream-precondition test — `src/upstream-precondition.test.ts`.** Asserts the resolved core
  carries `writeEnabled` (object), `setWriteGrant` (function) and `autoDiscovery` (object), with
  `generateCustomId` as the positive control proving the artifact loaded at all. Probed by
  identity through `createRequire`, never by version string, because the two `0.6.5`s are
  indistinguishable by version. Proven red-first against the registry tarball: **3 failed / 2
  passed**, with the positive control among the passes — so the failures are evidence of absence
  rather than a broken load. It then **caught the real thing within the same session**:
  `npm install --save-dev` for the tooling below silently replaced the symlink again, and the
  suite went red instead of green.
- **Raw `writeEnabled` export removed — `src/write-enabled-absence.test.ts`.** Ruled by the fleet
  as one decision covering this binding and `langsys-js-react` (React's operator; Svelte and
  Angular already withheld it). The export was unreleased — **zero** occurrences in the published
  `0.2.1` type declarations, against a positive control of 8 for `useT` — so it broke no consumer.
  The absence is pinned with two positive controls, because an absence assertion passes just as
  happily against a failed import: (1) the core still exports `writeEnabled`, so the absence is
  this package's choice rather than an upstream removal; (2) this package loaded and exposes
  `useWriteEnabled`, so the absence is a missing export rather than an empty module. A fourth test
  asserts the other raw signals remain, making this a targeted withholding rather than an empty
  barrel. Red-first: re-adding the export fails it while both controls stay green.

- **BIND-6 wrappers replaced by a reference-forwarding `Proxy` — `src/surface.test.ts`.** Ruled by the
  Reviewer following Solid's shipped, review-verified architecture. The audit had recorded this as
  _surface drift_, and **surface drift is what it was** — an earlier revision of this bullet claimed the
  change had revealed "already a live defect", which was wrong (§The five that were never dropped). The proxy's one structural hazard (`#private`
  fields cannot be read through a proxy receiver, and accessor-computed values are still read that way) is pinned
  both structurally and behaviourally, with a positive control proving the structural regex matches real
  `#field` syntax. Mutation numbers for this work are carried in the BIND-6 row, re-derived against the current implementation — this bullet previously repeated a stale set from an earlier revision.

- **Rendered-output assertions — `src/rendered.test.ts`, `src/route-reentry.test.ts`.** The
  tri-state is now asserted through `textContent` in a real DOM, including a three-way template
  branch where `undefined` renders its own state rather than falling into the read-only branch.
  The route-re-entry measurements are committed rather than scratch, so they are reproducible
  evidence under CONF-2 instead of a memory.

1. **GATE-7 coverage for persistent layouts.** _(the only remaining gap, and it is core-side)_ A header/nav/footer calling `t()` does not
   re-render on client-side navigation, so its misses are only ever attributed to the first URL
   of the session. Cost: **under-reported discovery** on exactly the components most likely to
   hold shared chrome copy. Needs a core-side or documented answer, not a binding memo — routing
   it to Typescript is the next step, since the core is where per-URL re-recording lives.

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

The route-re-entry harness needs `vue-router` and `jsdom`, which are now **devDependencies** of this
package, so §Route re-entry's measurements reproduce from a clean checkout via
`src/route-reentry.test.ts` rather than a scratch harness. (An earlier revision of this file said the
harness "was removed" and was "not a committed test". That was true when the audit was written and
stopped being true when gap 4 closed; it then survived three further edits of this file — which is the
argument for re-reading a document's older sections after changing its newer ones.)

## Summary

Counts computed from the tables above (BIND-1..6, §2, and the §3 delegation block counted as one
row per family).

| Grade          | Count  |
| -------------- | ------ |
| `implemented`  | 0      |
| `provisional`  | 12     |
| `partial`      | 1      |
| `delegated`    | 13     |
| `n-a`          | 1      |
| `open`         | 0      |
| **Total rows** | **27** |

`implemented` is 0 by construction (CONF-2, no contract fixture) and stays 0 in every repo until
the shared contract fixture lands — that is the evidence model working, not a broken binding.

**There are no `open` rows left.** BIND-6 was the last one and is now `provisional` like the rest
of the behavioural surface. The single `partial` is GATE-7's persistent-layout coverage, which is
core-side and routed to the TypeScript queue rather than fixable here.

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
