/**
 * The world a script reaches the SDK test clone as, read from the seed file the clone is seeded
 * with: `_dev_/contract/seeds/<slug>.json`, rendered from `test/helpers/contract-seeds/<slug>.ts`.
 * `_dev_/fixture.mjs` (the playground) and `_dev_/nuxt-e2e.mjs` take their project, keys, user
 * token and caller address from here; `src/seed-files.test.ts` checks that this reads each pass's
 * world as the tests' worlds module declares it.
 *
 * Only for a file holding one world of one project and one instance a pass, which is what those
 * two declare: pass `p` is then the file's `p`-th project and its instance `p + 1`.
 */
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { callerAddress } from '../../test/helpers/contract-addresses.mjs';

export const root = join(dirname(fileURLToPath(import.meta.url)), '..', '..');

/** The world of seed file `slug` in pass `pass` (0 when not given). */
export function scriptWorld(slug, pass = 0) {
    const seed = JSON.parse(readFileSync(join(root, '_dev_', 'contract', 'seeds', `${slug}.json`), 'utf8'));
    const project = seed.projects[pass];
    if (!project)
        throw new Error(
            `_dev_/contract/seeds/${slug}.json holds ${seed.projects.length} passes, and pass ${pass} is not one`
        );
    const keys = seed.keys.filter((k) => k.project === project.id);
    const instance = pass + 1;
    const index = parseInt(project.id.slice(4, 6), 16);
    const prefix = `vue-${slug}-${instance}-`;
    return {
        projectId: project.id,
        token: project.user.token,
        deviceId: project.user.device_id,
        keys: Object.fromEntries(keys.map((k) => [k.key.slice(prefix.length), k.key])),
        caller: callerAddress(index, instance, 0),
        baseLocale: project.base_locale ?? 'en-us',
        targetLocales: project.target_locales ?? [],
    };
}

/** Names a script world's case to a running forwarder (`POST /__fixture/setup`). */
export async function nameCase(fixtureUrl, world) {
    const res = await fetch(`${fixtureUrl}/setup`, {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({
            keys: Object.values(world.keys),
            projects: [world.projectId],
            tokens: [world.token],
            caller: world.caller,
            faults: [],
            reference: null,
        }),
    });
    if (!res.ok) throw new Error(`naming the case failed: ${res.status} ${await res.text()}`);
}
