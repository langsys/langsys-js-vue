# Testing this binding locally

How to run `langsys-js-vue` against a local build of the core and a local API, and see each feature work. The automated suites are listed at the end; this page is for a person checking the behaviour by hand.

## 1. Link the local core

This branch needs the core's unreleased 838 surface, which the published `langsys-js-typescript` does not have. Build the core checkout and link it in place of the installed package (a temporary local override, never committed; see [CLAUDE.md, Local development setup](CLAUDE.md#local-development-setup)):

```bash
(cd ../langsys-js-typescript && npm ci && npm run build)
npm install
ln -sfn "$(cd ../langsys-js-typescript && pwd)" node_modules/langsys-js-typescript
npm run typecheck && npm test
```

After rebuilding the core, restart the playground with `npm run dev -- --force` so Vite re-reads it. `npm ci` puts the registry version back.

## 2. Start a local API

**The contract double** — the vendored test double of the Langsys API (`contract-fixture/`), seeded for this page:

```bash
npm run double
```

It stays up on `http://127.0.0.1:8789/api` until Ctrl-C, and prints the `.env` lines below. The seed (`_dev_/local-seed.json`) holds project `p1` (base `en-us`; `es-es`, `fr-fr`, `de-de`, with a few Spanish and German translations), a write key `k-writer`, and a key `k-hints` that may not write from this machine. Everything the double accepted is at `http://127.0.0.1:8789/__fixture/state`; restarting it resets to the seed.

**Or a local Langsys** — point the proxy at it instead, with a real project id and key (`http://langsys2.test`).

## 3. Run the playground

`.env` at the repo root:

```bash
LANGSYS_API_PROXY=http://127.0.0.1:8789
VITE_LANGSYS_API_URL=/api
VITE_LANGSYS_PROJECT_ID=p1
VITE_LANGSYS_API_KEY=k-writer
```

```bash
npm run dev        # http://localhost:5173
```

The Vite dev server serves the API under the page's own `/api` (`LANGSYS_API_PROXY`), because the double sends no CORS headers. The playground (`example/App.vue`) imports the binding from `src/` and compiles its templates with the compiler transform, as an app does.

## 4. One check per feature

Open `http://localhost:5173`, and keep `http://127.0.0.1:8789/__fixture/state` in another tab. Allow a few seconds for registrations to arrive.

| Feature                           | Do                                                                 | See                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                               |
| --------------------------------- | ------------------------------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `<Translate>` blocks and ids      | Load the page; switch the locale to Español.                       | "Content-block ids on this page" lists one 32-character id per block, the same before and after the switch. The heading reads _Bienvenido a la demo de Langsys + Vue_. The state lists the "HTML content blocks" block under its id, its HTML intact.                                                                                                                                                                                                                                                                                                                             |
| Placeholders (compiler transform) | Type several names into **Name**.                                  | The page follows the name; in Español the first line reads _Hola Ana, bienvenido de nuevo_. The state holds `See you soon, {first_name}` once, and no phrase with a typed name in it. Details: [README, Variables in text](README.md#variables-in-text).                                                                                                                                                                                                                                                                                                                          |
| Suspense slots                    | Reload the page.                                                   | Both panels show their _Loading…_ text, then their content. A block whose content is still loading after the core's 500 ms settle window registers the loading text, and the core says so in the console with `debug: true`: the slow panel's `Loading the slow panel…` is expected in the state, followed by `Delivered after two seconds`. **Known issue, core `bb0198c4`:** the fast panel resolves inside the window (at 150 ms, and likewise at 300 ms), yet the state holds `Loading the fast panel…` and never `Delivered within the settle window`. Reported to the core. |
| Discovery hints                   | Set `VITE_LANGSYS_API_KEY=k-hints`, restart `npm run dev`, reload. | The state's `phrases` and `blocks` gain nothing (this key may not write here). Within about ten seconds of loading, `hints` holds `{"project_id": "p1", "url": …}` with the page's URL. Route changes in an app with Vue Router: [README, Route changes](README.md#route-changes-vue-router).                                                                                                                                                                                                                                                                                     |
| Accept-Language helper            | Switch the locale.                                                 | "Accept-Language for your own API" shows `{ "Accept-Language": "es-es" }`, following each switch. Details: [README, Asking your own API for the user's language](README.md#asking-your-own-api-for-the-users-language).                                                                                                                                                                                                                                                                                                                                                           |

### Nuxt: server render, request scope, hydration seed

`example/nuxt` is a Nuxt app in the shape [README-SSR.md](README-SSR.md#nuxt) documents. Build it against the linked core and keep the build:

```bash
LANGSYS_KEEP=1 npm run test:nuxt     # prints "kept: <dir>" and its own 8 checks
```

With `npm run double` running:

```bash
PORT=3000 LANGSYS_API_URL=http://127.0.0.1:8789/api node <dir>/app/.output/server/index.mjs
```

| Do                                                                          | See                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Open `http://localhost:3000/?lang=es-es&user=Ana` and view the page source. | The served HTML (not only the rendered page) reads `<p>Hola Ana</p>` inside `<translate data-ls-contentblock="…" data-ls-resolved="es-es">`. |
| Open `?lang=de-de&user=Bo` in another tab.                                  | `<p>Hallo Bo</p>`: each request renders in its own locale.                                                                                   |
| Find `__NUXT_DATA__` in the source.                                         | The hydration seed: the request's catalog and the blocks it rendered, the ones the server sends itself marked `collected`.                   |
| Read the double's state after a request.                                    | `Welcome back, {first_name}` and the "Unknown block one / two" block, registered by the server; no phrase with Ana or Bo in it.              |

Remove `<dir>` when done.

## Automated suites

- `npm test` — unit and contract suites; the contract suites start the double themselves.
- `npm run test:nuxt` — the Nuxt checks above, unattended.
- `npm run test:mutations` — breaks the code on purpose, once per mutation CONFORMANCE.md cites, and requires a failing test each time.

What each rule's evidence is: [CONFORMANCE.md](CONFORMANCE.md).
