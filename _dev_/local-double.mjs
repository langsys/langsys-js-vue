#!/usr/bin/env node
/**
 * Runs the vendored contract double (`contract-fixture/`) on a fixed port for local testing, seeded
 * from `_dev_/local-seed.json`, and keeps it up until Ctrl-C. See TESTING.md.
 *
 *   npm run double              # http://127.0.0.1:8789/api
 *   npm run double -- --port 9000
 *
 * The seed holds project `p1` (base en-us; es-es, fr-fr, de-de), a write key `k-writer`, and an
 * `ip_write` key `k-hints` that may not write from this machine, so a session on it reports
 * discovery hints instead of registering.
 */
import { spawn } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const root = resolve(import.meta.dirname, '..');
const at = process.argv.indexOf('--port');
const port = at > 0 ? process.argv[at + 1] : '8789';

const double = spawn(process.execPath, [join(root, 'contract-fixture', 'server.mjs'), '--port', port], {
    stdio: ['ignore', 'pipe', 'inherit'],
});
const stop = () => double.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
double.once('exit', (code) => process.exit(code ?? 0));

let buffered = '';
double.stdout.on('data', async function onData(chunk) {
    buffered += chunk;
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    double.stdout.off('data', onData);
    const ready = JSON.parse(buffered.slice(0, newline));
    const seed = readFileSync(join(root, '_dev_', 'local-seed.json'), 'utf8');
    const res = await fetch(ready.fixture_url + '/seed', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: seed,
    });
    if (!res.ok) {
        console.error(`seeding failed: ${res.status} ${await res.text()}`);
        return stop();
    }
    console.log(`Contract double up and seeded.

  API base URL   ${ready.base_url}
  Stored state   ${ready.fixture_url}/state
  Reset to seed  restart this command

For the playground, in .env (the Vite dev server proxies /api to the double):
  LANGSYS_API_PROXY=${ready.base_url.replace(/\/api$/, '')}
  VITE_LANGSYS_API_URL=/api
  VITE_LANGSYS_PROJECT_ID=p1
  VITE_LANGSYS_API_KEY=k-writer      (or k-hints, to see discovery hints)

Ctrl-C stops it.`);
});
