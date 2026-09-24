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
    '        unsubscribe = writeEnabled.subscribe((next) => {',
    '            value.value = next;',
    '        });',
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
                find: '    return useSignal(tSignal);',
                replace: [
                    '    const memo: Map<string, string> = ((globalThis as Record<string, unknown>).__lsMutationMemo ??= new Map()) as Map<string, string>;',
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
        what: 'the explicit custom_id is no longer stamped on the rendered host',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '{ ref: host, ...(props.custom_id ? { [CONTENT_BLOCK_MARKER_ATTR]: props.custom_id } : {}) },',
                replace: '{ ref: host },',
            },
        ],
        check: vitest('src/marker-ssr.test.ts'),
    },
    {
        id: 'M15',
        rules: 'MARK-1',
        what: 'the DOM class is re-created before Vue patches the host (pre-flush)',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: "watch(() => [props.category, props.custom_id, props.label], create, { flush: 'post' });",
                replace: 'watch(() => [props.category, props.custom_id, props.label], create);',
            },
        ],
        check: vitest('src/marker-ssr.test.ts'),
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
        what: "the served stamp uses an attribute name other than the core's",
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: '{ [CONTENT_BLOCK_MARKER_ATTR]: props.custom_id }',
                replace: "{ ['data-ls-content-block']: props.custom_id }",
            },
        ],
        check: vitest('src/marker-ssr.test.ts'),
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
        what: '<Translate> hands the core a detached copy of its host instead of the host in the page',
        file: 'src/components/Translate.ts',
        edits: [
            {
                find: 'new VanillaTranslate(host.value, {',
                replace: 'new VanillaTranslate(host.value.cloneNode(true) as HTMLElement, {',
            },
        ],
        check: vitest('src/resolved-contract.test.ts'),
    },
    {
        id: 'M25',
        rules: 'GATE-10',
        what: '<Phrase> hands the core a detached copy of its host instead of the host in the page',
        file: 'src/components/Phrase.ts',
        edits: [
            {
                find: 'new VanillaPhrase(host.value, {',
                replace: 'new VanillaPhrase(host.value.cloneNode(true) as HTMLElement, {',
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
        const diff = spawnSync('git', ['-C', root, 'diff', '--binary', 'HEAD'], { encoding: 'buffer' }).stdout;
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
