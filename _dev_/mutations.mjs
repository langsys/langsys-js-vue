#!/usr/bin/env node
/**
 * CONF-3 — re-runnable mutation evidence.
 *
 * The spec says a runtime rule is proven by showing that BREAKING the behaviour turns
 * the test red, and that evidence which cannot be re-run on demand is a memory, not a
 * test. Every mutation this binding's conformance file cites used to live in commit
 * messages and throwaway scripts. This runner is the reproducible form.
 *
 * For each mutation it:
 *   1. asserts every `find` snippet occurs EXACTLY ONCE in its file — a snippet that
 *      no longer matches means the source moved and the mutation went stale, which is
 *      reported as a failure rather than silently skipped;
 *   2. writes the mutated file, runs the named check, and records whether it went red;
 *   3. restores the original bytes, always — on success, on failure, and on SIGINT.
 *
 * Exit 0 only when the baseline is green AND every mutation turned its check red.
 *
 * It never writes to the checkout it is started from. It runs in a temporary git worktree at
 * HEAD with the checkout's uncommitted changes and untracked files copied in, and
 * `node_modules` linked, so the SDK under test is the one the checkout resolves. The worktree
 * is removed afterwards.
 *
 *   npm run test:mutations
 */
import { copyFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, symlinkSync, writeFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';

const vitest = (...files) => ({ label: `vitest ${files.join(' ')}`, cmd: 'npx', args: ['vitest', 'run', ...files] });
const typecheck = { label: 'tsc --noEmit', cmd: 'npx', args: ['tsc', '--noEmit'] };

const TIMER_BLOCK = [
    '    const timer = setTimeout(() => {',
    '        if (cancelled) return;',
    '        pastHydration = true;',
    '        adopt();',
    '    }, 0);',
].join('\n');

/** Each mutation names the rule(s) it is evidence for. */
export const MUTATIONS = [
    {
        id: 'M1',
        rules: 'BIND-1, SSR-1',
        what: 'useWriteEnabled collapses to a naive useSignal passthrough (no SSR guard, no hydration latch)',
        file: 'src/composables.ts',
        edits: [
            {
                find: 'if (!isBrowser) return shallowRef<boolean | undefined>(undefined);',
                replace: 'return useSignal(writeEnabled);',
            },
        ],
        check: vitest('src/composables.test.ts', 'src/rendered.test.ts'),
    },
    {
        id: 'M2',
        rules: 'BIND-1',
        what: 'hydration latch becomes a microtask instead of a macrotask',
        file: 'src/composables.ts',
        edits: [
            {
                find: TIMER_BLOCK,
                replace: TIMER_BLOCK.replace(
                    '    const timer = setTimeout(() => {',
                    '    const timer = 0 as unknown as ReturnType<typeof setTimeout>;\n    void Promise.resolve().then(() => {'
                ).replace('    }, 0);', '    });'),
            },
        ],
        check: vitest('src/composables.test.ts'),
    },
    {
        id: 'M3',
        rules: 'GATE-8',
        what: 'the tri-state is defaulted: undefined becomes false on the SSR and hydration paths',
        file: 'src/composables.ts',
        edits: [
            {
                find: 'if (!isBrowser) return shallowRef<boolean | undefined>(undefined);',
                replace: 'if (!isBrowser) return shallowRef<boolean | undefined>(false);',
            },
            {
                find: 'const value = shallowRef<boolean | undefined>(undefined);',
                replace: 'const value = shallowRef<boolean | undefined>(false);',
            },
        ],
        check: vitest('src/composables.test.ts', 'src/rendered.test.ts'),
    },
    {
        id: 'M4a',
        rules: 'GRANT-2',
        what: 'refToWriteGrant snapshots the Ref value instead of returning a provider (too tight)',
        file: 'src/adapters.ts',
        edits: [
            {
                find: 'if (isRef(grant)) return () => grant.value;',
                replace: 'if (isRef(grant)) return grant.value ?? undefined;',
            },
        ],
        check: vitest('src/adapters.test.ts'),
    },
    {
        id: 'M4b',
        rules: 'GRANT-2',
        what: 'refToWriteGrant reads eagerly but still returns a function (too loose)',
        file: 'src/adapters.ts',
        edits: [
            {
                find: 'if (isRef(grant)) return () => grant.value;',
                replace: 'if (isRef(grant)) { const captured = grant.value; return () => captured; }',
            },
        ],
        check: vitest('src/adapters.test.ts', 'src/destructuring.test.ts'),
    },
    {
        id: 'M6',
        rules: 'BIND-5, GATE-7',
        what: "a module-level memo in front of t() — Angular's shipped shape",
        file: 'src/composables.ts',
        edits: [
            {
                find: '    return scope ? shallowRef(scope.t) : useSignal(tSignal);',
                replace: [
                    '    const memo: Map<string, string> = ((globalThis as Record<string, unknown>).__lsMutationMemo ??= new Map()) as Map<string, string>;',
                    '    void scope;',
                    '    const inner = useSignal(tSignal);',
                    '    const cached = ((phrase: string, ...rest: unknown[]) => {',
                    '        if (!memo.has(phrase)) memo.set(phrase, (inner.value as unknown as (...a: unknown[]) => string)(phrase, ...rest));',
                    '        return memo.get(phrase);',
                    '    }) as unknown as TFunction;',
                    '    return shallowRef(cached) as Readonly<ShallowRef<TFunction>>;',
                ].join('\n'),
            },
        ],
        check: vitest('src/route-reentry.test.ts'),
    },
    {
        id: 'M7',
        rules: 'BIND-6, BIND-1',
        what: 'forwarded methods are no longer bound to the core (destructuring breaks)',
        file: 'src/index.ts',
        edits: [
            {
                find: 'const bound = (value as (...args: unknown[]) => unknown).bind(target);',
                replace: 'const bound = value;',
            },
        ],
        check: vitest('src/destructuring.test.ts', 'src/surface.test.ts'),
    },
    {
        id: 'M8',
        rules: 'BIND-6',
        what: 'the bound-member identity cache is removed (LangsysApp.foo !== LangsysApp.foo)',
        file: 'src/index.ts',
        edits: [{ find: 'if (cached && cached.source === value) return cached.bound;', replace: '' }],
        check: vitest('src/destructuring.test.ts'),
    },
    {
        id: 'M9',
        rules: 'BIND-6',
        what: "accessor-computed values are bound too (wraps get t()'s TFunction)",
        file: 'src/index.ts',
        edits: [{ find: 'if (!isCoreMethod(target, prop)) return value;', replace: '' }],
        check: vitest('src/surface.test.ts'),
    },
    {
        id: 'M10',
        rules: 'BIND-6, GRANT-3',
        what: "the setWriteGrant override is hidden, handing back the core's own method",
        file: 'src/index.ts',
        edits: [
            {
                find: 'if (Object.prototype.hasOwnProperty.call(overrides, prop)) {',
                replace: "if (Object.prototype.hasOwnProperty.call(overrides, prop) && prop !== 'setWriteGrant') {",
            },
        ],
        check: vitest('src/surface.test.ts', 'src/destructuring.test.ts'),
    },
    {
        id: 'M11',
        rules: 'BIND-6',
        what: 'one public core member is dropped from the forwarded surface',
        file: 'src/index.ts',
        edits: [
            {
                find: 'const value = Reflect.get(target, prop, target);',
                replace:
                    "if (prop === 'getDialCodes') return undefined;\n        const value = Reflect.get(target, prop, target);",
            },
        ],
        check: vitest('src/surface.test.ts'),
    },
    {
        id: 'M12',
        rules: 'BIND-2, GATE-8',
        what: 'the raw writeEnabled signal is re-exported',
        file: 'src/index.ts',
        edits: [
            {
                find: '// The absence is pinned by `src/write-enabled-absence.test.ts`.',
                replace:
                    "// The absence is pinned by `src/write-enabled-absence.test.ts`.\nexport { writeEnabled } from 'langsys-js-typescript';",
            },
        ],
        check: vitest('src/write-enabled-absence.test.ts'),
    },
    {
        id: 'M13',
        rules: 'BIND-6',
        what: 'the exported type widens to include core-private members',
        file: 'src/index.ts',
        edits: [
            {
                find: "export type LangsysAppVue = Omit<typeof _LangsysApp, 'init' | 'setWriteGrant'> & {",
                replace: 'export type LangsysAppVue = Record<string, any> & {',
            },
        ],
        check: typecheck,
    },
    {
        id: 'M14',
        rules: 'MARK-1',
        what: 'a fallback block (a component in its slot) no longer stamps its explicit custom_id',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '{ ref: host, ...(props.custom_id ? { [CONTENT_BLOCK_MARKER_ATTR]: props.custom_id } : {}) },',
                replace: '{ ref: host },',
            },
        ],
        check: vitest('src/block-ssr.test.ts'),
    },
    {
        id: 'M15',
        rules: 'MARK-1, SRV-1',
        what: "the rendered block's host attributes (its id, its resolved marker) are not stamped",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: 'return h(props.tag, { ref: host, ...rendered.hostAttrs }, [',
                replace: 'return h(props.tag, { ref: host }, [',
            },
        ],
        check: vitest('src/marker-ssr.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M16',
        rules: 'SRV-4',
        what: 'the synchronous seed is not forwarded through the binding',
        file: 'src/index.ts',
        edits: [
            {
                find: 'const value = Reflect.get(target, prop, target);',
                replace:
                    "if (prop === 'seedCatalog') return undefined;\n        const value = Reflect.get(target, prop, target);",
            },
        ],
        check: vitest('src/hydration-handoff.test.ts'),
    },
    {
        id: 'M17',
        rules: 'MARK-1',
        what: "a fallback block stamps its explicit id under an attribute name other than the core's",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '{ [CONTENT_BLOCK_MARKER_ATTR]: props.custom_id }',
                replace: "{ ['data-ls-content-block']: props.custom_id }",
            },
        ],
        check: vitest('src/block-ssr.test.ts'),
    },
    {
        id: 'M18',
        rules: 'BIND-4',
        what: 'the Vue config gains a key the core does not define',
        file: 'src/index.ts',
        edits: [
            {
                find: "export interface iLangsysInitConfig extends Omit<iVanillaInitConfig, 'UserLocaleStore' | 'writeGrant'> {",
                replace:
                    "export interface iLangsysInitConfig extends Omit<iVanillaInitConfig, 'UserLocaleStore' | 'writeGrant'> {\n    notACoreConfigKey?: string;",
            },
        ],
        check: typecheck,
    },
    {
        id: 'M19',
        rules: 'GRANT-3',
        what: "the setWriteGrant override hands back its own promise, not the core's re-authorization",
        file: 'src/index.ts',
        edits: [
            {
                find: 'return _LangsysApp.setWriteGrant(refToWriteGrant(grant));',
                replace: 'void _LangsysApp.setWriteGrant(refToWriteGrant(grant));\n        return Promise.resolve();',
            },
        ],
        check: vitest('src/destructuring.test.ts'),
    },
    {
        id: 'M20',
        rules: 'WIRE-5',
        what: 'LangsysAppAPI is no longer re-exported',
        file: 'src/index.ts',
        edits: [{ find: "export { LangsysAppAPI } from 'langsys-js-typescript';", replace: '' }],
        check: vitest('src/surface.test.ts'),
    },
    {
        id: 'M21',
        rules: 'WIRE-5',
        what: "the binding's init override drops apiUrl on the way to the core",
        file: 'src/index.ts',
        edits: [
            {
                find: 'writeGrant: refToWriteGrant(config.writeGrant),',
                replace: 'writeGrant: refToWriteGrant(config.writeGrant),\n            apiUrl: undefined,',
            },
        ],
        check: vitest('src/api-redirect.test.ts'),
    },
    // M22 and M23 mutate the route HARNESS, not the implementation. They prove the route suite's two
    // controls fire in the graded cases, so a "does not re-enter" verdict there cannot come from a
    // harness that never moved the URL or never re-rendered — the traps the Angular lane measured.
    {
        id: 'M22',
        rules: 'HINT-4, BIND-5 (harness control)',
        what: 'the route harness uses a history that never moves the URL',
        file: 'src/route-reentry.test.ts',
        edits: [
            {
                find: 'history: RouterHistory = createWebHashHistory()',
                replace: 'history: RouterHistory = createMemoryHistory()',
            },
        ],
        check: vitest('src/route-reentry.test.ts'),
    },
    {
        id: 'M23',
        rules: 'HINT-4, BIND-5 (harness control)',
        what: 'the route harness reads each navigation before it settles and Vue re-renders',
        file: 'src/route-reentry.test.ts',
        edits: [
            {
                find: 'async go(path: string, settle = true): Promise<Nav> {',
                replace: 'async go(path: string, settle = false): Promise<Nav> {',
            },
        ],
        check: vitest('src/route-reentry.test.ts'),
    },
    {
        id: 'M24',
        rules: 'GATE-10',
        what: '<Translate> registers its block without handing the core its host, so no resolved ancestor is seen and an enclosing DOM class takes it over',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '                ...options(),\n                host: host.value,\n',
                replace: '                ...options(),\n',
            },
        ],
        check: vitest('src/resolved-contract.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M25',
        rules: 'GATE-10',
        what: '<Phrase> registers its phrase without handing the core its host',
        file: 'src/components/Phrase.ts',
        edits: [
            {
                find: '                params: props.params,\n                host: host.value,\n',
                replace: '                params: props.params,\n',
            },
        ],
        check: vitest('src/resolved-contract.test.ts'),
    },
    {
        id: 'M26',
        rules: 'HINT-13',
        what: "syncNavigation no longer calls the core's notifyNavigation() after a route change",
        file: 'src/navigation.ts',
        edits: [{ find: 'if (!failure) notifyNavigation();', replace: 'void failure;' }],
        check: vitest('src/navigation-contract.test.ts'),
    },
    {
        id: 'M27',
        rules: 'MSG-5',
        what: 'useServerMessage stops depending on useT(), so a mounted list never re-renders on a catalog change',
        file: 'src/server-message.ts',
        edits: [{ find: '        void t.value;\n', replace: '' }],
        check: vitest('src/server-message.test.ts'),
    },
    {
        id: 'M28',
        rules: 'MSG-5, MSG-6',
        what: "useServerMessage drops the caller's category",
        file: 'src/server-message.ts',
        edits: [{ find: 'renderServerMessage(entry, category)', replace: 'renderServerMessage(entry)' }],
        check: vitest('src/server-message.test.ts'),
    },
    {
        id: 'M29',
        rules: 'MSG-5',
        what: "useServerMessage hands the core the entry's message as its template",
        file: 'src/server-message.ts',
        edits: [
            {
                find: 'renderServerMessage(entry, category)',
                replace: 'renderServerMessage({ ...entry, template: entry.message }, category)',
            },
        ],
        check: vitest('src/server-message.test.ts'),
    },
    {
        id: 'M30',
        rules: 'MIG-1..8 (pass-through)',
        what: "the init override drops the app's legacyKeys on the way to the core",
        file: 'src/index.ts',
        edits: [
            {
                find: 'writeGrant: refToWriteGrant(config.writeGrant),',
                replace: 'writeGrant: refToWriteGrant(config.writeGrant),\n            legacyKeys: undefined,',
            },
        ],
        check: vitest('src/legacy-keys-passthrough.test.ts'),
    },
    {
        id: 'M31',
        rules: 'MIG-7 (pass-through)',
        what: "the init override strips each legacy file's format, so every file reads as plain",
        file: 'src/index.ts',
        edits: [
            {
                find: 'writeGrant: refToWriteGrant(config.writeGrant),',
                replace:
                    'writeGrant: refToWriteGrant(config.writeGrant),\n            legacyKeys: config.legacyKeys?.map(({ format: _f, ...f }) => f),',
            },
        ],
        check: vitest('src/legacy-keys-passthrough.test.ts'),
    },
    {
        id: 'M32',
        rules: 'SNAP-2, SNAP-3 (pass-through)',
        what: "the proxy hides the core's loadSnapshot",
        file: 'src/index.ts',
        edits: [
            {
                find: 'const value = Reflect.get(target, prop, target);',
                replace:
                    "if (prop === 'loadSnapshot') return undefined;\n        const value = Reflect.get(target, prop, target);",
            },
        ],
        check: vitest('src/snapshot-passthrough.test.ts'),
    },
    {
        id: 'M33',
        rules: 'SRV-2 (subscription leak)',
        what: 'useSignal subscribes during a server render again, so every request leaves listeners on the core signals',
        file: 'src/adapters.ts',
        edits: [{ find: "    if (typeof window === 'undefined') return value;\n", replace: '' }],
        check: vitest('src/ssr-subscriptions.test.ts'),
    },
    {
        id: 'M34',
        rules: 'SRV-7 (the spec mutation)',
        what: 'the harness renders every request through one shared request scope',
        file: 'src/ssr-scope.test.ts',
        edits: [
            {
                find: 'open: (locale, catalog) => createRequestScope({ locale, catalog: catalog as never }),',
                replace:
                    'open: (locale, catalog) => ((globalThis as Record<string, unknown>).__lsOneScope ??= createRequestScope({ locale, catalog: catalog as never })),',
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M35',
        rules: 'SRV-7, SRV-3 (the Nuxt path)',
        what: 'the composables ignore a scope provided to the app and read only the async context',
        file: 'src/composables.ts',
        edits: [
            {
                find: 'return provided ?? currentRequestScope() ?? null;',
                replace: 'void provided;\n    return currentRequestScope() ?? null;',
            },
        ],
        check: vitest('src/ssr-scope.test.ts', 'src/ssr-scope-contract.test.ts'),
    },
    {
        id: 'M36',
        rules: 'SRV-2',
        what: "useCurrentLocale reads the process-wide signal on the server, not the request's scope",
        file: 'src/composables.ts',
        edits: [
            {
                find: 'return scope ? shallowRef(scope.locale) : useSignal(currentlyLoadedLocale);',
                replace: 'void scope;\n    return useSignal(currentlyLoadedLocale);',
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M37',
        rules: 'SRV-7 (the enter() wiring trap)',
        what: "the request's scope.enter() moves into a helper the request awaits, so the render never sees the scope",
        file: 'src/ssr-scope.test.ts',
        edits: [
            {
                find: [
                    '            const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });',
                    '            scope.enter();',
                ].join('\n'),
                replace: [
                    '            await (async function helper() {',
                    '                const scope = await createRequestScope({ locale, catalog: CATALOGS[locale] as never });',
                    '                scope.enter();',
                    '            })();',
                ].join('\n'),
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M38',
        rules: 'SRV-1, SRV-5',
        what: 'the translated tree is rebuilt without the source back-reference, so a moved element loses its handler and ref',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: 'const original = node.source === undefined ? undefined : elements[node.source];',
                replace: 'const original = elements.length < 0 ? elements[0] : undefined;',
            },
        ],
        check: vitest('src/block-ssr.test.ts', 'src/block-vnodes.test.ts'),
    },
    {
        id: 'M39',
        rules: 'MARK-3',
        what: "the app's custom_id is handed to the core as an adopted stamp, so an unknown block never registers under it",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '...(props.custom_id ? { id: props.custom_id } : {}),',
                replace: '...(props.custom_id ? { customId: props.custom_id } : {}),',
            },
        ],
        check: vitest('src/resolved-contract.test.ts'),
    },
    {
        id: 'M40',
        rules: 'SRV-5 (the fallback)',
        what: 'a component in the slot is treated as convertible instead of falling back',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: "if (typeof vnode.type !== 'string') return void (failure ??= 'component');",
                replace: "if (typeof vnode.type !== 'string') return;",
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M42',
        rules: 'VAR-6',
        what: "the transform rewrites each host as Vue reaches it instead of the whole tree at the root, so the server compiler's slot copy keeps the value",
        file: 'src/compiler.ts',
        edits: [
            {
                find: '    if (root.type !== ROOT) return;',
                replace: "    if (root.type !== ELEMENT || !HOSTS.has(root.tag ?? '')) return;",
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M43',
        rules: 'VAR-7',
        what: 'compiled dynamic text is no longer detected, so a per-user value is registered',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '    return vnode.patchFlag > 0 && (vnode.patchFlag & PATCH_TEXT) !== 0;',
                replace: '    return vnode.patchFlag < 0 && (vnode.patchFlag & PATCH_TEXT) !== 0;',
            },
        ],
        check: vitest('src/compiler.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M44',
        rules: 'VAR-2',
        what: "a member chain is handed to the core's naming as one identifier, so user.name is named user_name",
        file: 'src/compiler.ts',
        edits: [
            {
                find: '        return segments.length === 1 ? { identifier: segments[0]! } : { member: segments };',
                replace: "        return { identifier: segments.join('_') };",
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M45',
        rules: 'VAR-6',
        what: 't() calls in template interpolations are no longer rewritten',
        file: 'src/compiler.ts',
        edits: [
            {
                find: '    if (node.type === INTERPOLATION) fix(node.content as AstNode);',
                replace: '    if (node.type === -1) fix(node.content as AstNode);',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M46',
        rules: 'VAR-7',
        what: 'a translatable attribute bound to a value is no longer detected',
        file: 'src/block-vnodes.ts',
        edits: [{ find: '    if (vnode.patchFlag & PATCH_PROPS)\n', replace: '    if (vnode.patchFlag & 0)\n' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M47',
        rules: 'SRV-3, SRV-4',
        what: 'a block rendered inside a server request scope is not registered there, so the server never collects it',
        file: 'src/components/Translate.ts',
        edits: [{ find: '                      if (!unregistered) registerBlock(nodes, options());\n', replace: '' }],
        check: vitest('src/handoff-contract.test.ts'),
    },
    {
        id: 'M48',
        rules: 'VAR-3 (pass-through)',
        what: 'a value marker comment in a slot is dropped like any other comment, so the core never sees it',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: 'return /^(ls:[a-z][a-z0-9_]*|\\/ls)$/.test(text) ? [{ comment: text }] : [];',
                replace: 'return /^(ls-never:[a-z][a-z0-9_]*|\\/ls)$/.test(text) ? [{ comment: text }] : [];',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M49',
        rules: 'VAR-6',
        what: 'a rewritten t() expression keeps the parse Vue made of the original text, so an inlined <script setup> or server build emits broken code',
        file: 'src/compiler.ts',
        edits: [{ find: '        exp.ast = undefined;\n', replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M50',
        rules: 'SRV-1, SRV-7',
        what: '<Translate> renders over the async-context scope only, so a scope provided to the app (Nuxt) is ignored and the process catalog serves',
        file: 'src/components/Translate.ts',
        edits: [{ find: '            const rendered = scope\n', replace: '            const rendered = false\n' }],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M51',
        rules: 'VAR-1, VAR-7',
        what: '<Translate> registers a block holding a compiled variable, so each user registers a phrase of their own',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '            unregistered = converted.variable || converted.excluded;\n            if (unregistered) warnUnregistered',
                replace: '            unregistered = false;\n            if (unregistered) warnUnregistered',
            },
        ],
        check: vitest('src/variables-contract.test.ts', 'src/compiler.test.ts'),
    },
    {
        id: 'M52',
        rules: 'VAR-7',
        what: 'a compiled variable falls back like a component, served as written instead of rendered from the catalog',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            if (isDynamicText(vnode) || hasDynamicTranslatableAttribute(vnode)) dynamic(here);\n',
                replace:
                    "            if (isDynamicText(vnode) || hasDynamicTranslatableAttribute(vnode)) return void (failure = 'component');\n",
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M53',
        rules: 'VAR-7 (raw HTML)',
        what: 'the slot walk stops at the first fallback, so a variable after a v-html element goes unseen',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: "            if (child === null || child === undefined || typeof child === 'boolean') return;\n",
                replace:
                    "            if (failure) return;\n            if (child === null || child === undefined || typeof child === 'boolean') return;\n",
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M54',
        rules: 'VAR-1, VAR-7 (raw HTML)',
        what: 'a block mixing v-html with a compiled variable falls back to the DOM class, which registers the per-user text',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '                unregistered = converted.variable || converted.excluded;\n',
                replace: '                unregistered = false;\n',
            },
        ],
        check: vitest('src/variables-contract.test.ts'),
    },
    {
        id: 'M55',
        rules: 'BIND-1',
        what: "refToLocaleSource's watcher belongs to the scope that subscribed it, so the SDK stops following the ref when the component that called init() unmounts",
        file: 'src/adapters.ts',
        edits: [
            {
                find: '            const scope = effectScope(true);\n',
                replace: '            const scope = effectScope();\n',
            },
        ],
        check: vitest('src/adapters.test.ts'),
    },
    {
        id: 'M56',
        rules: 'BIND-1, SRV-1',
        what: '<Translate> keeps the path and the registration it had at mount, whatever its slot becomes',
        file: 'src/components/Translate.ts',
        edits: [{ find: '        onUpdated(sync);\n', replace: '' }],
        check: vitest('src/block-modes.test.ts', 'src/block-updates-contract.test.ts'),
    },
    {
        id: 'M57',
        rules: 'BIND-1',
        what: '<Phrase> keeps the registration it had at mount, whatever its slot becomes',
        file: 'src/components/Phrase.ts',
        edits: [{ find: '        onUpdated(sync);\n', replace: '' }],
        check: vitest('src/block-updates-contract.test.ts'),
    },
    {
        id: 'M58',
        rules: 'BIND-1',
        what: '<Translate> moves between paths after an update but never registers a tree whose content changed',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '                if (tree && JSON.stringify(tree) !== registered) return register();\n',
                replace: '',
            },
        ],
        check: vitest('src/block-updates-contract.test.ts'),
    },
    {
        id: 'M59',
        rules: 'MSG-5, SRV-7',
        what: "useServerMessage renders outside the request scope, so a scope provided to the app (the Nuxt path) serves the process's catalog",
        file: 'src/server-message.ts',
        edits: [
            {
                find: '            return scope ? scope.run(render) : render();\n',
                replace: '            return render();\n',
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M60',
        rules: 'FRM-6, SRV-7',
        what: "localeHeaders() is the core's alone, so in a scope provided to the app it names the process's locale",
        file: 'src/composables.ts',
        edits: [
            {
                find: '    return scope ? scope.run(coreLocaleHeaders) : coreLocaleHeaders();\n',
                replace: '    return coreLocaleHeaders();\n',
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M61',
        rules: 'SRV-2, SRV-7',
        what: "the provided scope is read only inside a component, so code Nuxt runs in the app's context reads the process",
        file: 'src/composables.ts',
        edits: [
            {
                find: '    const provided = hasInjectionContext() ? inject<RequestScope | null>(REQUEST_SCOPE_KEY, null) : null;\n',
                replace:
                    '    const provided = getCurrentInstance() ? inject<RequestScope | null>(REQUEST_SCOPE_KEY, null) : null;\n',
            },
        ],
        check: vitest('src/ssr-scope.test.ts'),
    },
    {
        id: 'M62',
        rules: 'GATE-10, SRV-1',
        what: "<Phrase> drops what the core set on the phrase host, so a translation is served unmarked and an enclosing block's DOM class registers it as source",
        file: 'src/components/Phrase.ts',
        edits: [
            {
                find: "            return h(props.tag, { ref: host, ...element?.attrs, [PHRASE_MARKER_ATTR]: '' }, [\n",
                replace: "            return h(props.tag, { ref: host, [PHRASE_MARKER_ATTR]: '' }, [\n",
            },
        ],
        check: vitest('src/resolved-contract.test.ts', 'src/ssr-scope.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M63',
        rules: 'HINT-13',
        what: '<Translate> registers while <KeepAlive> holds it out of the page',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '            if (!host.value?.isConnected || !tree) return;\n',
                replace: '            if (!host.value || !tree) return;\n',
            },
        ],
        check: vitest('src/navigation-contract.test.ts', 'src/block-updates-contract.test.ts'),
    },
    {
        id: 'M64',
        rules: 'HINT-13',
        what: '<Phrase> registers while <KeepAlive> holds it out of the page',
        file: 'src/components/Phrase.ts',
        edits: [
            {
                find: '            if (!host.value?.isConnected || !tree) return;\n',
                replace: '            if (!host.value || !tree) return;\n',
            },
        ],
        check: vitest('src/navigation-contract.test.ts', 'src/block-updates-contract.test.ts'),
    },
    {
        id: 'M65',
        rules: 'BIND-1',
        what: '<Translate> does not register when <KeepAlive> brings it back, so content that changed while it was cached is never registered',
        file: 'src/components/Translate.ts',
        edits: [{ find: '        onActivated(register);\n', replace: '' }],
        check: vitest('src/block-updates-contract.test.ts'),
    },
    {
        id: 'M66',
        rules: 'BIND-1',
        what: '<Phrase> does not register when <KeepAlive> brings it back',
        file: 'src/components/Phrase.ts',
        edits: [{ find: '        onActivated(register);\n', replace: '' }],
        check: vitest('src/block-updates-contract.test.ts'),
    },
    {
        id: 'M67',
        rules: 'VAR-6',
        what: 'the rewritten t() reads any non-literal second argument as params, so a category held in a variable is lost',
        file: 'src/compiler.ts',
        edits: [
            {
                find: "            args = `${JSON.stringify(phrase)}, ...((p, a) => (typeof a === 'object' ? [{ ...p, ...a }] : [a, p]))(${params}, ${others[0]})`;\n",
                replace: '            args = `${JSON.stringify(phrase)}, { ...${params}, ...(${others[0]}) }`;\n',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M68',
        rules: 'SRV-1',
        what: "translated attributes are laid over as the core spells them, lowercased, so an SVG's camelCase attributes are served twice",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '        const clone = cloneVNode(original, changedAttrs(original, node.attrs), false);\n',
                replace: '        const clone = cloneVNode(original, node.attrs ?? {}, false);\n',
            },
        ],
        check: vitest('src/block-ssr.test.ts'),
    },
    {
        id: 'M69',
        rules: 'GATE-8, BIND-1',
        what: 'useWriteEnabled reads through once the first caller has handed over, so a subtree that hydrates late under <Suspense> mismatches',
        file: 'src/composables.ts',
        edits: [
            {
                find: '    const hydrating = Boolean(instance && !instance.isMounted && instance.vnode.el);\n',
                replace: '    const hydrating = false;\n',
            },
        ],
        check: vitest('src/rendered.test.ts'),
    },
    {
        id: 'M70',
        rules: 'GATE-8, BIND-1',
        what: 'useWriteEnabled defers in every component after the handover, so a component mounted later flashes "not known yet"',
        file: 'src/composables.ts',
        edits: [
            {
                find: '    const hydrating = Boolean(instance && !instance.isMounted && instance.vnode.el);\n',
                replace: '    const hydrating = Boolean(instance);\n',
            },
        ],
        check: vitest('src/rendered.test.ts'),
    },
    {
        id: 'M71',
        rules: 'WIRE-4',
        what: "<Translate> floats its registration, so under requireCredentials the failure never reaches the app's errorHandler",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '            return registerBlock(tree, {\n                ...options(),\n',
                replace: '            registerBlock(tree, {\n                ...options(),\n',
            },
        ],
        check: vitest('src/require-credentials.test.ts'),
    },
    {
        id: 'M72',
        rules: 'WIRE-4',
        what: "<Phrase> floats its registration, so under requireCredentials the failure never reaches the app's errorHandler",
        file: 'src/components/Phrase.ts',
        edits: [
            {
                find: '            return registerBlock(tree, {\n                category: props.category,\n',
                replace: '            registerBlock(tree, {\n                category: props.category,\n',
            },
        ],
        check: vitest('src/require-credentials.test.ts'),
    },
    {
        id: 'M73',
        rules: 'SRV-3, SRV-7',
        what: '<Translate> registers on a server before entering the scope it renders in, so a scope provided to the app holds nothing',
        file: 'src/components/Translate.ts',
        edits: [
            { find: '                      if (!unregistered) registerBlock(nodes, options());\n', replace: '' },
            {
                find: '            const rendered = scope\n',
                replace:
                    '            if (scope && !unregistered) registerBlock(nodes, options());\n            const rendered = scope\n',
            },
        ],
        check: vitest('src/ssr-register.test.ts'),
    },
    {
        id: 'M74',
        rules: 'SRV-3, SRV-7',
        what: '<Phrase> registers on a server before entering the scope it renders in, so a scope provided to the app holds nothing',
        file: 'src/components/Phrase.ts',
        edits: [
            { find: '                          if (!unregistered) registerBlock(phrase, opts);\n', replace: '' },
            {
                find: '            const [rendered] = (\n',
                replace:
                    '            if (scope && !unregistered) registerBlock(phrase, opts);\n            const [rendered] = (\n',
            },
        ],
        check: vitest('src/ssr-register.test.ts'),
    },
    {
        id: 'M75',
        rules: 'VAR-2',
        what: 'repeated expressions are merged by source text before the core names them, so an unnameable value repeated is one placeholder',
        file: 'src/compiler.ts',
        edits: [
            {
                find: '    const sources = expressions.map((e) => e.trim());\n',
                replace: '    const sources = [...new Set(expressions.map((e) => e.trim()))];\n',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M76',
        rules: 'VAR-1, VAR-7, WIRE-4',
        what: '<Translate> hands the core a block holding a compiled variable to register, not as a read, so each user registers their own text and requireCredentials rejects it',
        file: 'src/components/Translate.ts',
        edits: [{ find: '                ...(unregistered ? { register: false } : {}),\n', replace: '' }],
        check: vitest('src/variables-contract.test.ts', 'src/require-credentials.test.ts'),
    },
    {
        id: 'M77',
        rules: 'VAR-7, BIND-1',
        what: "a translated clone keeps the compiler's patch flags, so a block holding a compiled variable shows [object Object] after a catalog update",
        file: 'src/block-vnodes.ts',
        edits: [{ find: '        clone.patchFlag = BAIL;\n', replace: '' }],
        check: vitest('src/block-modes.test.ts'),
    },
    {
        id: 'M78',
        rules: 'VAR-2',
        what: 'a call whose callee cannot be spelled is read as an unnameable expression, so getA()(n) is named value instead of n',
        file: 'src/compiler.ts',
        edits: [
            {
                find: '        if (args && (spelled || isPostfix(call.callee)))\n',
                replace: '        if (args && spelled)\n',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M79',
        rules: 'TOK-1, VAR-1',
        what: "<DontTranslate> is read as a component, so a block holding one falls back to the DOM class and stores the first user's value",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            if (vnode.type === DontTranslate) {\n',
                replace: '            if (vnode.type === DontTranslate && false) {\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M80',
        rules: 'TOK-1, VAR-7',
        what: 'a compiled value inside an excluded element is counted as a bare variable, so a <Phrase> without the transform registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '        if (!inExcluded) variable = true;\n        else if (!inPhrase) excluded = true;\n',
                replace: '        variable = true;\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M81',
        rules: 'TOK-1, VAR-6',
        what: 'the transform rewrites a value inside an excluded element into a placeholder, so the page shows %email%',
        file: 'src/compiler.ts',
        edits: [
            { find: "    if (DONT_TRANSLATE.has(node.tag ?? '')) return 'author';\n", replace: '' },
            { find: "    return excluded ? 'author' : outer;\n", replace: '    return outer;\n' },
        ],
        check: vitest('src/compiler.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M82',
        rules: 'VAR-1, TOK-1',
        what: "<Translate> ignores a compiled value inside an excluded element, so without the transform its content stores the user's value",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '            // content keeps excluded text as written, so the block would store it (VAR-1).\n            unregistered = converted.variable || converted.excluded;\n',
                replace:
                    '            // content keeps excluded text as written, so the block would store it (VAR-1).\n            unregistered = converted.variable;\n',
            },
        ],
        check: vitest('src/variables-contract.test.ts'),
    },
    {
        id: 'M83',
        rules: 'VAR-3, VAR-7',
        what: 'a compiled value inside a value marker is counted as a variable, so a block whose value the transform marked registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [{ find: '        if (inMarker) return;\n', replace: '' }],
        check: vitest('src/compiler.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M84',
        rules: 'WIRE-4, BIND-4',
        what: 'the init override turns requireCredentials on by default, so an app with no credentials throws from t() as it boots',
        file: 'src/index.ts',
        edits: [
            {
                find: '            writeGrant: refToWriteGrant(config.writeGrant),\n',
                replace:
                    '            writeGrant: refToWriteGrant(config.writeGrant),\n            requireCredentials: config.requireCredentials ?? true,\n',
            },
        ],
        check: vitest('src/unconfigured.test.ts'),
    },
    {
        id: 'M85',
        rules: 'WIRE-4, BIND-4',
        what: 'the init override drops requireCredentials, so the exception never surfaces at first use',
        file: 'src/index.ts',
        edits: [
            {
                find: '            writeGrant: refToWriteGrant(config.writeGrant),\n',
                replace:
                    '            writeGrant: refToWriteGrant(config.writeGrant),\n            requireCredentials: undefined,\n',
            },
        ],
        check: vitest('src/require-credentials.test.ts'),
    },
    {
        id: 'M86',
        rules: 'GATE-8, BIND-1',
        what: 'a component Vue is hydrating adopts the live value on the handover, not once it has hydrated, so an async setup that calls useWriteEnabled() before it awaits mismatches',
        file: 'src/composables.ts',
        edits: [{ find: '    let hydrated = !hydrating;\n', replace: '    let hydrated = true;\n' }],
        check: vitest('src/rendered.test.ts'),
    },
    {
        id: 'M87',
        rules: 'TOK-1, BIND-1',
        what: "a <DontTranslate> renders its own slot instead of the core's content for it, so a phrase's params stay unfilled inside it and a teleport it holds renders twice",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            clone.children = { default: () => children };\n',
                replace: '            clone.children = original.children;\n',
            },
        ],
        check: vitest('src/block-ssr.test.ts'),
    },
    {
        id: 'M88',
        rules: 'TOK-1, VAR-6',
        what: "the transform puts the marker's <span> inside SVG, where it does not render",
        file: 'src/compiler.ts',
        edits: [{ find: "    if (node.ns) return 'code';\n", replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M89',
        rules: 'TOK-1, VAR-6',
        what: 'the transform ignores a bound translate, so a value it excludes at run time is shown as %email%',
        file: 'src/compiler.ts',
        edits: [{ find: "    if (bindsExclusion) return 'code';\n", replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M90',
        rules: 'VAR-1, VAR-3, VAR-7',
        what: 'any element carrying data-ls-param is taken as a marker, so a value inside one the core does not read is registered per user',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '                inMarker: within.inMarker || (VAR_PARAM_ATTR in props && isValueMarker(vnode)),\n',
                replace: '                inMarker: within.inMarker || VAR_PARAM_ATTR in props,\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M91',
        rules: 'MARK-4, VAR-1',
        what: 'a nested <Phrase> is read as a component, so a <Translate> holding one and a value falls back and registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            if (vnode.type === Phrase) {\n',
                replace: '            if (vnode.type === Phrase && false) {\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M92',
        rules: 'MARK-4, VAR-6',
        what: 'a nested <Phrase> stops the transform, so the block around it keeps its compiled value and registers nothing',
        file: 'src/compiler.ts',
        edits: [
            {
                find: "        if (c.tagType === COMPONENT && !DONT_TRANSLATE.has(c.tag ?? '') && !isNestedPhrase(c)) return 'component';\n",
                replace:
                    "        if (c.tagType === COMPONENT && !DONT_TRANSLATE.has(c.tag ?? '')) return 'component';\n",
            },
        ],
        check: vitest('src/compiler.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M93',
        rules: 'VAR-2, MARK-4',
        what: "the block's rewrite names a nested <Phrase>'s values in the block's space, so the phrase loses its own params",
        file: 'src/compiler.ts',
        edits: [
            {
                find: '            else if (c.type === ELEMENT && !isNestedPhrase(c)) collect(c.children, within(bound, c));\n',
                replace: '            else if (c.type === ELEMENT) collect(c.children, within(bound, c));\n',
            },
            {
                find: '            if (c.type === ELEMENT && !isNestedPhrase(c)) c.children = rewrite(c.children, within(bound, c));\n',
                replace: '            if (c.type === ELEMENT) c.children = rewrite(c.children, within(bound, c));\n',
            },
        ],
        check: vitest('src/compiler.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M94',
        rules: 'MARK-4, BIND-1',
        what: "a nested <Phrase> is rebuilt from the block's translated copy instead of rendering itself",
        file: 'src/block-vnodes.ts',
        edits: [{ find: '        if (original?.type === Phrase) return cloneVNode(original);\n', replace: '' }],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M95',
        rules: 'MARK-4',
        what: "a nested <Phrase>'s node carries no category, so the block records its phrase under the block's category too",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: "        mergeProps({ [PHRASE_MARKER_ATTR]: '', [CATEGORY_MARKER_ATTR]: category ?? '' }, attrs),\n",
                replace: "        mergeProps({ [PHRASE_MARKER_ATTR]: '' }, attrs),\n",
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/variables-contract.test.ts'),
    },
    {
        id: 'M96',
        rules: 'MARK-4, BIND-1',
        what: 'a teleport inside a nested <Phrase> is collected by the block too, so it renders twice',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            if (vnode.type === Teleport) return void (at.inPhrase ? undefined : teleports.push(vnode));\n',
                replace: '            if (vnode.type === Teleport) return void teleports.push(vnode);\n',
            },
        ],
        check: vitest('src/block-ssr.test.ts'),
    },
    {
        id: 'M97',
        rules: 'TOK-1, MARK-4',
        what: 'a value excluded inside a nested <Phrase> counts against the block, which then registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [{ find: '        else if (!inPhrase) excluded = true;\n', replace: '        else excluded = true;\n' }],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M98',
        rules: 'SRV-2',
        what: "renderInRequestScope drops the scope's credentials, so a request's render sends under the module-wide key",
        file: 'src/server.ts',
        edits: [
            {
                find: '    const scope = await createRequestScope(options);\n',
                replace: '    const scope = await createRequestScope({ ...options, credentials: undefined });\n',
            },
        ],
        check: vitest('src/ssr-credentials-contract.test.ts'),
    },
    {
        id: 'M99',
        rules: 'GATE-8, BIND-1',
        what: 'useWriteEnabled takes a call from a hook after mount for a hydrating component, which waits for a mount that has passed and never shows the real value',
        file: 'src/composables.ts',
        edits: [
            {
                find: '    const hydrating = Boolean(instance && !instance.isMounted && instance.vnode.el);\n',
                replace: '    const hydrating = Boolean(instance && instance.vnode.el);\n',
            },
        ],
        check: vitest('src/rendered.test.ts'),
    },
    {
        id: 'M100',
        rules: 'TOK-1, VAR-6',
        what: 'the transform ignores an exclusion bound through an object or a dynamic argument, so a value it excludes at run time is shown as %email%',
        file: 'src/compiler.ts',
        edits: [
            {
                find: "            (!p.arg?.isStatic || ['translate', 'data-notrans'].includes(p.arg.content ?? ''))\n",
                replace: "            ['translate', 'data-notrans'].includes(p.arg?.content ?? '')\n",
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M101',
        rules: 'VAR-3, VAR-7',
        what: 'isValueMarker asks the core about a comment the block never sends, so a marker beside an inactive v-if is read as a variable and the block registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            if (child.type === Comment) return commentNodes(child);\n',
                replace:
                    "            if (child.type === Comment) return [{ comment: String(child.children ?? '') }];\n",
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M102',
        rules: 'TOK-1, VAR-6',
        what: "the transform puts the marker's <span> inside an element that holds text only, where a textarea shows it as text and an option drops it",
        file: 'src/compiler.ts',
        edits: [{ find: "    if (TEXT_ONLY.has((node.tag ?? '').toLowerCase())) return 'code';\n", replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M103',
        rules: 'TOK-1, MARK-4',
        what: 'a <DontTranslate> or nested <Phrase> given its children by h() is read through its slot alone, so the block renders it empty',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: "    if (typeof children === 'string') return [children];\n    if (Array.isArray(children)) return children as VNodeArrayChildren;\n",
                replace: '',
            },
        ],
        check: vitest('src/block-vnodes.test.ts', 'src/block-ssr.test.ts'),
    },
    {
        id: 'M104',
        rules: 'VAR-1, MARK-4',
        what: "a translatable attribute bound on a nested <Phrase> is not the block's exclusion, so the block stores the value in its content",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '                if (hasDynamicTranslatableAttribute(vnode)) dynamic({ ...at, inExcluded: true });\n                const params',
                replace: '                const params',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M105',
        rules: 'VAR-3, VAR-7',
        what: 'isValueMarker asks the core about a bare data-ls-param as the name "true", while the block sends true, which names nothing',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '    const name = treeAttribute(attributesOf(vnode)[VAR_PARAM_ATTR]);\n',
                replace: "    const name = String(attributesOf(vnode)[VAR_PARAM_ATTR] ?? '');\n",
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M106',
        rules: 'VAR-3, VAR-7',
        what: 'isValueMarker counts a teleport inside a marker as an element, while the block sets it aside, so the block registers nothing',
        file: 'src/block-vnodes.ts',
        edits: [{ find: '            if (child.type === Teleport) return [];\n', replace: '' }],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M107',
        rules: 'MARK-4, VAR-6',
        what: 'the transform skips what a nested <Phrase> holds, so a blocker there leaves the block rewritten and it falls back showing %name%',
        file: 'src/compiler.ts',
        edits: [
            {
                find: "        if (c.tagType === COMPONENT && !DONT_TRANSLATE.has(c.tag ?? '') && !isNestedPhrase(c)) return 'component';\n",
                replace:
                    "        if (isNestedPhrase(c)) continue;\n        if (c.tagType === COMPONENT && !DONT_TRANSLATE.has(c.tag ?? '')) return 'component';\n",
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M108',
        rules: 'MARK-4, VAR-6',
        what: "a conditional or a list inside a nested <Phrase> holds the block's rewrite back, though the slot walk drops an inactive branch and enters a list, so the block registers nothing",
        file: 'src/compiler.ts',
        edits: [
            {
                find: '        const blocking = inPhrase ? WALK_STOPPING_DIRECTIVES : BLOCKING_DIRECTIVES;\n',
                replace: '        const blocking = BLOCKING_DIRECTIVES;\n',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M109',
        rules: 'VAR-6, VAR-7',
        what: 'an element that sets innerHTML or textContent does not hold the block back as v-html does, so the block is rewritten, falls back at run time and shows %name%',
        file: 'src/compiler.ts',
        edits: [{ find: '        if (raw) return propName(raw)!;\n', replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M110',
        rules: 'VAR-6, VAR-7',
        what: 'a static innerHTML or textContent attribute does not hold the block back, though Vue sets it as the property and the slot walk falls back',
        file: 'src/compiler.ts',
        edits: [{ find: '    if (p.type === ATTRIBUTE) return p.name;\n', replace: '' }],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M111',
        rules: 'VAR-6, VAR-7',
        what: 'a binding is read without its .camel modifier, so :text-content.camel, which sets textContent, does not hold the block back',
        file: 'src/compiler.ts',
        edits: [
            {
                find: "    return camel ? (p.arg.content ?? '').replace(/-(\\w)/g, (_, c: string) => c.toUpperCase()) : p.arg.content;\n",
                replace: '    return p.arg.content;\n',
            },
        ],
        check: vitest('src/compiler.test.ts'),
    },
    {
        id: 'M112',
        rules: 'VAR-7, BIND-1',
        what: "the slot walk reads an element's props under the client build's keys (.innerHTML, ^title), so a server render and its hydration take different paths",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            const props = attributesOf(vnode);\n',
                replace: '            const props = vnode.props ?? {};\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M113',
        rules: 'VAR-1, VAR-7',
        what: 'a translatable attribute bound with .prop or .attr is not read as dynamic, so the block stores the value in its content',
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '            TRANSLATABLE.has(attributeName(name))\n',
                replace: '            TRANSLATABLE.has(name)\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
    {
        id: 'M114',
        rules: 'SRV-1, BIND-1',
        what: "a translated attribute is laid over under its plain name beside the vnode's .prop or .attr key, so the element carries both",
        file: 'src/block-vnodes.ts',
        edits: [
            {
                find: '    const own = new Map(Object.keys(props).map((name) => [attributeName(name).toLowerCase(), name]));\n',
                replace: '    const own = new Map(Object.keys(props).map((name) => [name.toLowerCase(), name]));\n',
            },
        ],
        check: vitest('src/block-vnodes.test.ts'),
    },
];

/**
 * Re-run this script inside a temporary worktree that reproduces the checkout, and exit with
 * its code. The checkout itself is never written to.
 */
function runInWorktree() {
    const git = (...args) => {
        const r = spawnSync('git', args, { encoding: 'utf8' });
        if (r.status !== 0) throw new Error(`git ${args.join(' ')} failed: ${r.stderr}`);
        return r.stdout;
    };
    const root = git('rev-parse', '--show-toplevel').trim();
    const head = git('rev-parse', 'HEAD').trim();
    const dir = join(mkdtempSync(join(tmpdir(), 'langsys-vue-mutations-')), 'tree');
    git('-C', root, 'worktree', 'add', '--detach', dir, head);
    try {
        // No cap on the diff: Node's default 1 MiB would cut a large one short, and the cut patch fails to apply.
        const diff = spawnSync('git', ['-C', root, 'diff', '--binary', 'HEAD'], {
            encoding: 'buffer',
            maxBuffer: Infinity,
        }).stdout;
        if (diff.length) {
            const applied = spawnSync('git', ['-C', dir, 'apply', '--whitespace=nowarn'], { input: diff });
            if (applied.status !== 0) throw new Error(`could not apply the checkout's changes: ${applied.stderr}`);
        }
        const untracked = git('-C', root, 'ls-files', '--others', '--exclude-standard', '-z')
            .split('\0')
            .filter(Boolean);
        for (const file of untracked) {
            mkdirSync(dirname(join(dir, file)), { recursive: true });
            copyFileSync(join(root, file), join(dir, file));
        }
        symlinkSync(resolve(root, 'node_modules'), join(dir, 'node_modules'));
        console.log(
            `Worktree at HEAD ${head.slice(0, 7)}${diff.length || untracked.length ? ", plus the checkout's uncommitted changes" : ''}.\n`
        );
        const r = spawnSync(process.execPath, [join(dir, '_dev_', 'mutations.mjs'), ...process.argv.slice(2)], {
            cwd: dir,
            stdio: 'inherit',
            env: { ...process.env, LANGSYS_MUTATIONS_IN_WORKTREE: '1' },
        });
        return r.status ?? 1;
    } finally {
        git('-C', root, 'worktree', 'remove', '--force', dir);
        rmSync(dirname(dir), { recursive: true, force: true });
    }
}

if (!process.env.LANGSYS_MUTATIONS_IN_WORKTREE) process.exit(runInWorktree());

const originals = new Map();
function restoreAll() {
    for (const [file, bytes] of originals) writeFileSync(file, bytes);
    originals.clear();
}
for (const sig of ['SIGINT', 'SIGTERM']) {
    process.on(sig, () => {
        restoreAll();
        process.exit(130);
    });
}

function run(check) {
    const r = spawnSync(check.cmd, check.args, { encoding: 'utf8', env: { ...process.env, FORCE_COLOR: '0' } });
    const out = `${r.stdout ?? ''}${r.stderr ?? ''}`;
    const failed = /Tests\s+(\d+)\s+failed/.exec(out)?.[1];
    const tsErrors = (out.match(/error TS\d+/g) ?? []).length;
    return { status: r.status, failed: failed ? Number(failed) : 0, tsErrors, out };
}

function occurrences(haystack, needle) {
    let n = 0;
    for (let i = haystack.indexOf(needle); i !== -1; i = haystack.indexOf(needle, i + needle.length)) n++;
    return n;
}

const only = process.argv.slice(2);
const selected = only.length ? MUTATIONS.filter((m) => only.includes(m.id)) : MUTATIONS;

console.log('Baseline — the suite and the typecheck must be green before any mutation means anything.');
const baseTests = run(vitest());
const baseTypes = run(typecheck);
if (baseTests.status !== 0 || baseTypes.status !== 0) {
    console.error(`Baseline is not green (vitest exit ${baseTests.status}, tsc exit ${baseTypes.status}). Aborting.`);
    process.exit(1);
}
console.log('Baseline green.\n');

const rows = [];
let bad = 0;
for (const m of selected) {
    const source = readFileSync(m.file, 'utf8');
    const stale = m.edits.filter((e) => occurrences(source, e.find) !== 1);
    if (stale.length) {
        rows.push({ m, result: `STALE — ${stale.length} snippet(s) not found exactly once` });
        bad++;
        continue;
    }
    originals.set(m.file, source);
    try {
        writeFileSync(
            m.file,
            m.edits.reduce((s, e) => s.replace(e.find, e.replace), source)
        );
        const r = run(m.check);
        const red = r.status !== 0;
        const detail = m.check === typecheck ? `${r.tsErrors} TS error(s)` : `${r.failed} failed`;
        rows.push({ m, result: red ? `RED — ${detail}` : 'GREEN — mutation survived' });
        if (!red) bad++;
    } finally {
        restoreAll();
    }
}

console.log('| id | rules | mutation | check | result |');
console.log('| --- | --- | --- | --- | --- |');
for (const { m, result } of rows)
    console.log(`| ${m.id} | ${m.rules} | ${m.what} | \`${m.check.label}\` | ${result} |`);

const after = run(vitest());
if (after.status !== 0) {
    console.error('\nPost-run suite is not green — a restore may have failed. Check `git diff`.');
    process.exit(1);
}
console.log(`\n${rows.length - bad}/${rows.length} mutations turned their check red; post-run suite green.`);
process.exit(bad ? 1 : 0);
