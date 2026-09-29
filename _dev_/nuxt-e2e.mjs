#!/usr/bin/env node
/**
 * Nuxt end to end (SRV-1, SRV-3, SRV-4, SRV-7, VAR-6): builds a real Nuxt app against this package
 * and the core it resolves, serves it against the contract double, and reads what a visitor and the
 * server would see.
 *
 * It packs the core (the build `node_modules/langsys-js-typescript` resolves to, or `LANGSYS_CORE`) and this package
 * (`npm run build` first) as tarballs, installs them with Nuxt into a temporary copy of
 * `example/nuxt`, builds it, and runs it. Needs the network for the Nuxt install; not part of
 * `npm test`.
 *
 *   npm run test:nuxt
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const sh = (cmd, args, cwd) => {
    const r = spawnSync(cmd, args, { cwd, encoding: 'utf8' });
    if (r.status !== 0) throw new Error(`${cmd} ${args.join(' ')} failed in ${cwd}:\n${r.stdout}\n${r.stderr}`);
    return r.stdout.trim();
};
const results = [];
const check = (name, ok, detail = '') => results.push({ name, ok, detail });

const work = mkdtempSync(join(tmpdir(), 'langsys-vue-nuxt-'));
const children = [];
try {
    const core = realpathSync(process.env.LANGSYS_CORE ?? join(root, 'node_modules', 'langsys-js-typescript'));
    const coreTgz = join(work, sh('npm', ['pack', '--silent', '--pack-destination', work], core).split('\n').pop());
    sh('npm', ['run', 'build', '--silent'], root);
    const vueTgz = join(work, sh('npm', ['pack', '--silent', '--pack-destination', work], root).split('\n').pop());
    console.log(`core: ${core}\npacked: ${coreTgz}, ${vueTgz}`);

    const app = join(work, 'app');
    cpSync(join(root, 'example', 'nuxt'), app, { recursive: true });
    writeFileSync(
        join(app, 'package.json'),
        JSON.stringify({
            name: 'langsys-vue-nuxt-e2e',
            private: true,
            type: 'module',
            dependencies: {
                nuxt: '^4.5.2',
                'langsys-js-typescript': `file:${coreTgz}`,
                'langsys-js-vue': `file:${vueTgz}`,
            },
        })
    );
    console.log('installing Nuxt…');
    sh('npm', ['install', '--no-audit', '--no-fund', '--silent'], app);
    console.log('building…');
    sh('npx', ['nuxi', 'build'], app);

    // The contract double, seeded with the Italian and German translations of the placeholder phrase.
    const fixture = spawn(process.execPath, [join(root, 'contract-fixture', 'server.mjs')], {
        stdio: ['ignore', 'pipe', 'inherit'],
    });
    children.push(fixture);
    const ready = await new Promise((res, rej) => {
        let buf = '';
        fixture.stdout.on('data', (c) => {
            buf += c;
            const nl = buf.indexOf('\n');
            if (nl >= 0) res(JSON.parse(buf.slice(0, nl)));
        });
        fixture.once('exit', (code) => rej(new Error(`fixture exited ${code}`)));
    });
    const post = (path, body) =>
        fetch(ready.fixture_url + path, {
            method: 'POST',
            headers: { 'content-type': 'application/json' },
            body: JSON.stringify(body),
        });
    await post('/seed', {
        projects: [
            {
                id: 'p1',
                base_locale: 'en',
                target_locales: ['it', 'de'],
                website_url: 'https://site.local',
                phrases: [
                    {
                        category: 'UI',
                        phrase: 'Hello {first_name}',
                        translations: { it: 'Ciao {first_name}', de: 'Hallo {first_name}' },
                    },
                ],
            },
        ],
        keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
    });

    const port = String(3900 + Math.floor(Math.random() * 90));
    const server = spawn(process.execPath, [join(app, '.output', 'server', 'index.mjs')], {
        env: { ...process.env, PORT: port, LANGSYS_API_URL: ready.base_url },
        stdio: ['ignore', 'pipe', 'pipe'],
    });
    children.push(server);
    const base = `http://127.0.0.1:${port}`;
    for (let i = 0; i < 100; i++) {
        try {
            // Any answer will do, from a path that does not render the page: the first round must be
            // the first to meet the page's misses.
            await fetch(base + '/__ready');
            break;
        } catch {}
        await new Promise((r) => setTimeout(r, 100));
    }

    // Concurrent requests in two locales, three rounds.
    const pages = [];
    for (let round = 0; round < 3; round++) {
        pages.push(
            ...(await Promise.all([
                fetch(base + '/?lang=it&user=Ana').then(async (r) => ({ lang: 'it', html: await r.text() })),
                fetch(base + '/?lang=de&user=Bo').then(async (r) => ({ lang: 'de', html: await r.text() })),
            ]))
        );
    }
    const it = pages.filter((p) => p.lang === 'it');
    if (process.env.LANGSYS_KEEP) writeFileSync(join(work, 'it.html'), it[0].html);
    const de = pages.filter((p) => p.lang === 'de');
    check(
        'SRV-1/VAR-6: Italian requests serve "Ciao Ana" from the placeholder phrase',
        it.every((p) => p.html.includes('<p>Ciao Ana</p>'))
    );
    check(
        'SRV-1/VAR-6: German requests serve "Hallo Bo"',
        de.every((p) => p.html.includes('<p>Hallo Bo</p>'))
    );
    check(
        'SRV-2: no request serves the other locale',
        it.every((p) => !p.html.includes('Hallo')) && de.every((p) => !p.html.includes('Ciao'))
    );
    check(
        'MARK-1: every <Translate> host is stamped',
        it.every((p) => (p.html.match(/data-ls-contentblock="/g) ?? []).length === 2)
    );
    const payload = it[0].html.match(/<script[^>]*id="__NUXT_DATA__"[^>]*>([\s\S]*?)<\/script>/)?.[1] ?? '';
    check(
        'SRV-4: the payload carries the seed, the unknown block marked collected',
        /Unknown block one/.test(payload) && /"collected"/.test(payload),
        payload.slice(0, 0)
    );

    await new Promise((r) => setTimeout(r, 1500)); // the scopes close after each response
    const state = await (await fetch(ready.fixture_url + '/state')).json();
    const phrases = state.projects.p1.phrases.map((p) => p.phrase);
    const blocks = state.projects.p1.blocks.map((b) => b.content ?? '');
    check(
        'SRV-3/VAR-1: the t() miss is registered as its placeholder phrase',
        phrases.includes('Welcome back, {first_name}'),
        JSON.stringify(phrases)
    );
    check('VAR-1: no per-user phrase is registered', !phrases.some((p) => /Ana|Bo\b/.test(p)), JSON.stringify(phrases));
    check(
        'SRV-3: the unknown block is registered from the server',
        blocks.some((c) => c.includes('Unknown block one')),
        JSON.stringify(blocks)
    );
} finally {
    for (const c of children) c.kill('SIGTERM');
    if (process.env.LANGSYS_KEEP) console.log(`kept: ${work}`);
    else rmSync(work, { recursive: true, force: true });
}

for (const r of results) console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.name}${r.ok ? '' : '  ' + r.detail}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`\n${results.length - failed}/${results.length} checks passed`);
process.exit(failed || !results.length ? 1 : 0);
