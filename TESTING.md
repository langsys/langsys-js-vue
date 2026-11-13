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

## 2. Start the forwarder

The playground reaches a real Langsys API through the contract fixture's forwarder (`contract-fixture/`, [its README](contract-fixture/README.md)): the SDK test clone, `https://api.langsys5.test`, which is seeded with the playground's project among the test suites' worlds. The clone is shared by every SDK's suites: use it only when no other suite is running on it, and leave reseeding to whoever runs the clone, since a reseed rebuilds it for all of them.

```bash
LANGSYS_CONTRACT_TARGET=https://api.langsys5.test \
LANGSYS_CONTRACT_CLONE_ROOT=~/Documents/dev/langsys5 \
NODE_EXTRA_CA_CERTS=~/.config/valet/CA/LaravelValetCASelfSigned.pem \
npm run fixture
```

It stays up on `http://127.0.0.1:8789/api` until Ctrl-C, and prints the `.env` lines below with the playground's ids. The project (`_dev_/contract/seeds/playground.json`, declared in `test/helpers/contract-seeds/playground.ts`) has base `en-us` and `es-es`, `fr-fr` and `de-de`, with a few Spanish and German translations; its key ending `-k-writer` may write, and the one ending `-k-hints` may not write from this machine and reports the pages it is on. What the playground registers stays on the clone until it is reseeded.

**Or a local Langsys** — point the proxy at it instead, with a real project id and key (`http://langsys2.test`).

## 3. Run the playground

`.env` at the repo root, from what `npm run fixture` printed:

```bash
LANGSYS_API_PROXY=http://127.0.0.1:8789
VITE_LANGSYS_API_URL=/api
VITE_LANGSYS_PROJECT_ID=<the playground's project id>
VITE_LANGSYS_API_KEY=<its -k-writer key>
```

```bash
npm run dev        # http://localhost:5173
```

The Vite dev server serves the API under the page's own `/api` (`LANGSYS_API_PROXY`), so the browser calls it same-origin, as the forwarder sends no CORS headers. The playground (`example/App.vue`) imports the binding from `src/` and compiles its templates with the compiler transform, as an app does.

**What the API holds.** The catalog the project's key is served, phrases by category and blocks by id, and the hints the clone accepted:

```bash
curl -s "http://127.0.0.1:8789/api/translations?project_id=<id>&locale=es-es" -H "x-authorization: <key>"
curl -s "http://127.0.0.1:8789/__fixture/state?project=<id>"
```

## 4. One check per feature

Open `http://localhost:5173`, and read what the API holds (above) as you go. Allow a few seconds for registrations to arrive.

| Feature                           | Do                                                                               | See                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                                      |
| --------------------------------- | -------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `<Translate>` blocks and ids      | Load the page; switch the locale to Español.                                     | "Content-block ids on this page" lists one 32-character id per block, the same before and after the switch. The heading reads _Bienvenido a la demo de Langsys + Vue_. The catalog lists the "HTML content blocks" block under its id.                                                                                                                                                                                                                                                                                   |
| Placeholders (compiler transform) | Type several names into **Name**.                                                | The page follows the name; in Español the first line reads _Hola Ana, bienvenido de nuevo_. The catalog holds `See you soon, {first_name}` once, and no phrase with a typed name in it. Details: [README, Variables in text](README.md#variables-in-text).                                                                                                                                                                                                                                                               |
| Suspense slots                    | Reload the page.                                                                 | Both panels show their _Loading…_ text, then their content. A block whose content is still loading after the core's 500 ms settle window registers the loading text, and the core says so in the console with `debug: true`: the slow panel's `Loading the slow panel…` is expected in the catalog, followed by `Delivered after two seconds`. The fast panel resolves inside the window: the catalog holds `Delivered within the settle window` and never `Loading the fast panel…`, and the content stays on the page. |
| Discovery hints                   | Set `VITE_LANGSYS_API_KEY` to the `-k-hints` key, restart `npm run dev`, reload. | The catalog gains nothing (this key may not write here). The core sends a hint after a random delay of 5 to 30 seconds; then the forwarder's `/__fixture/state` holds `{"project_id": …, "url": …}` with the page's URL. Route changes in an app with Vue Router: [README, Route changes](README.md#route-changes-vue-router).                                                                                                                                                                                           |
| Accept-Language helper            | Switch the locale.                                                               | "Accept-Language for your own API" shows `{ "Accept-Language": "es-es" }`, following each switch. Details: [README, Asking your own API for the user's language](README.md#asking-your-own-api-for-the-users-language).                                                                                                                                                                                                                                                                                                  |

### Nuxt: server render, request scope, hydration seed

`example/nuxt` is a Nuxt app in the shape [README-SSR.md](README-SSR.md#nuxt) documents. Build it against the linked core and keep the build:

```bash
LANGSYS_KEEP=1 npm run test:nuxt     # prints "kept: <dir>" and its own 8 checks
```

With `npm run fixture` running, serve it as the playground's project, with the ids it printed:

```bash
PORT=3000 LANGSYS_API_URL=http://127.0.0.1:8789/api LANGSYS_PROJECT_ID=<id> LANGSYS_API_KEY=<-k-writer key> \
  node <dir>/app/.output/server/index.mjs
```

| Do                                                                          | See                                                                                                                                          |
| --------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------- |
| Open `http://localhost:3000/?lang=es-es&user=Ana` and view the page source. | The served HTML (not only the rendered page) reads `<p>Hola Ana</p>` inside `<translate data-ls-contentblock="…" data-ls-resolved="es-es">`. |
| Open `?lang=de-de&user=Bo` in another tab.                                  | `<p>Hallo Bo</p>`: each request renders in its own locale.                                                                                   |
| Find `__NUXT_DATA__` in the source.                                         | The hydration seed: the request's catalog and the blocks it rendered, the ones the server sends itself marked `collected`.                   |
| Read the catalog after a request.                                           | `Welcome back, {first_name}` and the "Unknown block one / two" block, registered by the server; no phrase with Ana or Bo in it.              |

Remove `<dir>` when done.

## Automated suites

- `npm test` — the unit suites. No API and no listening socket: a suite whose clause is what the SDK sends or does in-process answers the API's transport with a stand-in (`test/helpers/stub-api.ts`), which is evidence of nothing a server does.
- `npm run test:contract` — the contract suites (`src/*-contract.test.ts`), one file at a time, against the SDK test clone through the forwarder (spec CONF-2), with the three variables of "Start the forwarder" set; without them each file fails rather than skipping. Each file's worlds are its own projects, declared in `test/helpers/contract-seeds/` and rendered to `_dev_/contract/seeds/`, which the clone is seeded from; `src/seed-files.test.ts` (in `npm test`) fails when a rendered file differs from its declaration, and `npx vitest run --project unit src/seed-files.test.ts -u` writes them again. A case first reads its world back through the API and fails as `seed not landed` when the clone does not hold it as seeded, or holds a run's writes. What a run writes stays until the clone is reseeded, so each file holds its worlds several times over, in passes: a run takes the pass `LANGSYS_CONTRACT_PASS` names (0 when unset), and a second run before a reseed takes the next one. Run it only when no other suite is using the clone.
- `npm run test:nuxt` — the Nuxt checks above, unattended, against the clone, in the pass `LANGSYS_CONTRACT_PASS` names.
- `npm run test:mutations` — breaks the code on purpose, once per mutation CONFORMANCE.md cites, and requires a failing test each time. It runs the unit suites; a mutation only a contract suite catches is listed with the command that runs it on the clone, `npm run test:mutations -- --contract --pass N`, which gives its baseline pass `N` and each mutation a pass after it.

### The documentation check (ICU-7)

`src/docs-icu7.test.ts` runs with `npm test`, needs no network, and reads the README, the SSR guide, this guide, `_dev_/*.md`, and `example/` including `example/nuxt/`. Phrases in all of them are written flat (`You have {count} new messages`); the check fails on a `plural`, `select` or `selectordinal` argument anywhere in them. ICU may appear in three roles: what the catalog returns, what a legacy plural file converts into (MIG-4), and a counter-example marked `❌` beside the flat phrase that replaces it. Each such passage is named in the test's `EXEMPT` list with its role, so a new ICU example fails until someone decides it belongs there. The changelog is outside the check.

What each rule's evidence is: [CONFORMANCE.md](CONFORMANCE.md).
