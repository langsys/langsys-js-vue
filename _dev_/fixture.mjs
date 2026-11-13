#!/usr/bin/env node
/**
 * Starts the contract fixture's forwarder (`contract-fixture/forwarder.mjs`) for the playground in
 * `example/`, on a fixed port, and names the playground's case to it. See TESTING.md.
 *
 * The forwarder passes every `/api` route to a real Langsys API: an SDK test clone, seeded from
 * `_dev_/contract/seeds/playground.json` among the other seed files. It holds no state of its own:
 * what the playground registers stays on the clone until it is reseeded.
 *
 *   LANGSYS_CONTRACT_TARGET=https://api.langsys5.test \
 *   LANGSYS_CONTRACT_CLONE_ROOT=~/Documents/dev/langsys5 \
 *   NODE_EXTRA_CA_CERTS=~/.config/valet/CA/LaravelValetCASelfSigned.pem \
 *   npm run fixture                 # http://127.0.0.1:8789/api
 *   npm run fixture -- --port 9000
 */
import { spawn } from 'node:child_process';
import { join } from 'node:path';
import { nameCase, root, scriptWorld } from './contract/world.mjs';

const target = process.env.LANGSYS_CONTRACT_TARGET;
const cloneRoot = process.env.LANGSYS_CONTRACT_CLONE_ROOT;
if (!target || !cloneRoot) {
    console.error(
        "The playground reaches a real Langsys API through the contract forwarder. Set LANGSYS_CONTRACT_TARGET to the API's origin,\n" +
            'LANGSYS_CONTRACT_CLONE_ROOT to its langsys checkout (the forwarder reads accepted hints from it) and, for a local\n' +
            'HTTPS certificate, NODE_EXTRA_CA_CERTS. See TESTING.md, "Start the forwarder".'
    );
    process.exit(2);
}
const at = process.argv.indexOf('--port');
const port = at > 0 ? process.argv[at + 1] : '8789';
const log = process.env.LANGSYS_CONTRACT_LOG;
const world = scriptWorld('playground');

const child = spawn(
    process.execPath,
    [
        join(root, 'contract-fixture', 'forwarder.mjs'),
        '--target',
        target,
        '--clone-root',
        cloneRoot,
        '--port',
        port,
        ...(log ? ['--log', log] : []),
    ],
    { stdio: ['ignore', 'pipe', 'inherit'] }
);
const stop = () => child.kill('SIGTERM');
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
child.once('exit', (code) => process.exit(code ?? 0));

let buffered = '';
child.stdout.on('data', async function onData(chunk) {
    buffered += chunk.toString('utf8');
    const newline = buffered.indexOf('\n');
    if (newline < 0) return;
    child.stdout.off('data', onData);
    child.stdout.pipe(process.stdout);
    const { base_url, fixture_url } = JSON.parse(buffered.slice(0, newline));
    try {
        // The playground's case: its project, keys and seeded user, and the address it calls from.
        await nameCase(fixture_url, world);
    } catch (err) {
        console.error(`Naming the playground's case failed: ${err.message}`);
        return stop();
    }
    console.log(`Contract forwarder up, in front of ${target}.

  API base URL   ${base_url}
  Stored hints   ${fixture_url}/state?project=${world.projectId}

For the playground, in .env (the Vite dev server proxies /api to the forwarder):
  LANGSYS_API_PROXY=${base_url.replace(/\/api$/, '')}
  VITE_LANGSYS_API_URL=/api
  VITE_LANGSYS_PROJECT_ID=${world.projectId}
  VITE_LANGSYS_API_KEY=${world.keys['k-writer']}      (or ${world.keys['k-hints']}, to see discovery hints)

Project ${world.projectId}: base ${world.baseLocale}; ${world.targetLocales.join(', ')}.
Ctrl-C stops it.`);
});
