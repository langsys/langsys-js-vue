#!/usr/bin/env node
/**
 * Nuxt end to end (SRV-1, SRV-3, SRV-4, SRV-7, VAR-6): builds a real Nuxt app against this package
 * and the core it resolves, serves it against the API on an SDK test clone through the contract
 * forwarder (spec CONF-2), and reads what a visitor sees and what the API stored.
 *
 * It packs the core (the build `node_modules/langsys-js-typescript` resolves to, or `LANGSYS_CORE`) and this package
 * (`npm run build` first) as tarballs, installs them with Nuxt into a temporary copy of
 * `example/nuxt`, builds it, and runs it. The packed core is the only one installed: it overrides
 * the range this package declares, so a core whose version falls outside that range is still the
 * one the app runs, never a registry copy nested under this package. Needs the network for the
 * Nuxt install; not part of `npm test`.
 *
 * Its world is `_dev_/contract/seeds/nuxt.json`'s, in the pass `LANGSYS_CONTRACT_PASS` names (0
 * when unset): what a run registers stays on the clone until it is reseeded, so a second run
 * before a reseed takes the next pass. The run first confirms its world holds only its seed.
 *
 *   LANGSYS_CONTRACT_TARGET=https://api.langsys5.test \
 *   LANGSYS_CONTRACT_CLONE_ROOT=~/Documents/dev/langsys5 \
 *   NODE_EXTRA_CA_CERTS=~/.config/valet/CA/LaravelValetCASelfSigned.pem \
 *   npm run test:nuxt
 */
import { spawn, spawnSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { nameCase, scriptWorld } from './contract/world.mjs';

const root = resolve(import.meta.dirname, '..');
const target = process.env.LANGSYS_CONTRACT_TARGET;
const cloneRoot = process.env.LANGSYS_CONTRACT_CLONE_ROOT;
if (!target || !cloneRoot) {
    console.error(
        'The Nuxt run serves against an SDK test clone through the contract forwarder (spec CONF-2). Set LANGSYS_CONTRACT_TARGET,\n' +
            'LANGSYS_CONTRACT_CLONE_ROOT and NODE_EXTRA_CA_CERTS: contract-fixture/README.md, "Running the forwarder".'
    );
    process.exit(2);
}
const world = scriptWorld('nuxt', Number(process.env.LANGSYS_CONTRACT_PASS ?? 0));
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
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
            overrides: { 'langsys-js-typescript': '$langsys-js-typescript' },
        })
    );
    console.log('installing Nuxt…');
    sh('npm', ['install', '--no-audit', '--no-fund', '--silent'], app);
    const nested = join(app, 'node_modules', 'langsys-js-vue', 'node_modules', 'langsys-js-typescript');
    if (existsSync(nested)) throw new Error(`a second core was installed under langsys-js-vue: ${nested}`);
    console.log('building…');
    sh('npx', ['nuxi', 'build'], app);

    // The forwarder, in front of the clone, with the run's case named to it: its world holds the
    // Italian and German translations of the placeholder phrase.
    const fixture = spawn(
        process.execPath,
        [join(root, 'contract-fixture', 'forwarder.mjs'), '--target', target, '--clone-root', cloneRoot],
        { stdio: ['ignore', 'pipe', 'inherit'] }
    );
    children.push(fixture);
    const ready = await new Promise((res, rej) => {
        let buf = '';
        fixture.stdout.on('data', (c) => {
            buf += c;
            const nl = buf.indexOf('\n');
            if (nl >= 0) res(JSON.parse(buf.slice(0, nl)));
        });
        fixture.once('exit', (code) => rej(new Error(`forwarder exited ${code}`)));
    });
    await nameCase(ready.fixture_url, world);
    const key = world.keys['k-writer'];
    const apiRead = async (path, headers) => {
        const res = await fetch(ready.base_url + path, { headers: { accept: 'application/json', ...headers } });
        const body = await res.json().catch(() => null);
        if (!res.ok || !body) throw new Error(`${path} answered ${res.status}`);
        return body.data;
    };
    const query = (locale) => `project_id=${encodeURIComponent(world.projectId)}&locale=${locale}`;
    /** The phrase texts the catalog serves the project's key, standalone and in blocks. */
    const storedPhrases = async () => {
        const data = await apiRead(`/translations?${query('it')}`, { 'x-authorization': key });
        return Object.values(data ?? {}).flatMap((entries) =>
            Object.entries(entries ?? {}).flatMap(([name, value]) =>
                value && typeof value === 'object' ? Object.keys(value) : [name]
            )
        );
    };
    /** Each stored block's content, as the project's owner reads it. */
    const storedBlocks = async () => {
        const rows = Object.values(
            (await apiRead(`/translations/data?${query('it')}`, { 'x-authorization': key })) ?? {}
        ).flat();
        const owner = { authorization: `Bearer ${world.token}`, 'x-device-id': world.deviceId };
        const contents = [];
        for (const row of rows.filter((r) => r.type === 'content_block'))
            contents.push((await apiRead(`/translatable-items/${encodeURIComponent(row.id)}`, owner))?.content ?? '');
        return contents;
    };
    const seeded = await storedPhrases();
    if (seeded.join() !== 'Hello {first_name}')
        throw new Error(
            `the world of pass ${process.env.LANGSYS_CONTRACT_PASS ?? 0} holds ${JSON.stringify(seeded)}, not only its seed: ` +
                'a run has used it, so take the next pass (LANGSYS_CONTRACT_PASS) or reseed the clone'
        );

    const port = String(3900 + Math.floor(Math.random() * 90));
    const server = spawn(process.execPath, [join(app, '.output', 'server', 'index.mjs')], {
        env: {
            ...process.env,
            PORT: port,
            LANGSYS_API_URL: ready.base_url,
            LANGSYS_PROJECT_ID: world.projectId,
            LANGSYS_API_KEY: key,
        },
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

    // The scopes close after each response, and the API answers their registrations.
    let phrases = [];
    let blocks = [];
    for (let i = 0; i < 30; i++) {
        phrases = await storedPhrases();
        if (phrases.includes('Welcome back, {first_name}') && phrases.includes('Unknown block one')) break;
        await sleep(1000);
    }
    await sleep(2000);
    phrases = await storedPhrases();
    blocks = await storedBlocks();
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
