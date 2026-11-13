import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
// @ts-expect-error: the runner is plain JavaScript with no declarations; imported, it only exports its table.
import { isContractFile, mutationsPerContractFile } from '../_dev_/mutations.mjs';
// @ts-expect-error: plain JavaScript, read by the playground and the Nuxt run.
import { scriptWorld } from '../_dev_/contract/world.mjs';
import { callerAddress } from '../test/helpers/contract-addresses.mjs';
import blockUpdates from '../test/helpers/contract-seeds/block-updates.js';
import catalogSupersede from '../test/helpers/contract-seeds/catalog-supersede.js';
import clientRegisters from '../test/helpers/contract-seeds/client-registers.js';
import handoff from '../test/helpers/contract-seeds/handoff.js';
import moveCategories from '../test/helpers/contract-seeds/move-categories.js';
import navigation from '../test/helpers/contract-seeds/navigation.js';
import nuxt from '../test/helpers/contract-seeds/nuxt.js';
import playground from '../test/helpers/contract-seeds/playground.js';
import referenceLists from '../test/helpers/contract-seeds/reference-lists.js';
import registerOnce from '../test/helpers/contract-seeds/register-once.js';
import resolved from '../test/helpers/contract-seeds/resolved.js';
import ssrCredentials from '../test/helpers/contract-seeds/ssr-credentials.js';
import ssrScope from '../test/helpers/contract-seeds/ssr-scope.js';
import switchDuringRegistration from '../test/helpers/contract-seeds/switch-during-registration.js';
import variables from '../test/helpers/contract-seeds/variables.js';
import { renderSeedFile, seedFile, type SeedFile } from '../test/helpers/contract-worlds.js';

/**
 * The seed files the SDK test clone is built from before a run (spec CONF-2) are their worlds'
 * declarations, rendered. A file that differs from its declaration fails here; write them again
 * with `npx vitest run --project unit src/seed-files.test.ts -u`, and reseed the clone to take the
 * change. One refused seed file stops the reseed for every SDK sharing the clone, so this checks
 * each file against the clone's refusal table (langsys docs/sdk-test-clone.md, "What a document
 * may not carry") without a clone.
 */
const FILES: Record<string, SeedFile<string>> = {
    'block-updates': blockUpdates,
    'catalog-supersede': catalogSupersede,
    'client-registers': clientRegisters,
    handoff,
    'move-categories': moveCategories,
    navigation,
    nuxt,
    playground,
    'reference-lists': referenceLists,
    'register-once': registerOnce,
    resolved,
    'ssr-credentials': ssrCredentials,
    'ssr-scope': ssrScope,
    'switch-during-registration': switchDuringRegistration,
    variables,
};
/** The seed files that are no contract test's: the playground's and the Nuxt run's, read by `_dev_/contract/world.mjs`. */
const SCRIPT_FILES = ['nuxt', 'playground'];
const ROOT = fileURLToPath(new URL('..', import.meta.url));
const FOLDER = join(ROOT, '_dev_', 'contract', 'seeds');

describe('the seed files are what their worlds declare', () => {
    it.each(Object.entries(FILES))('%s.json', async (name, file) => {
        expect(file.slug).toBe(name);
        await expect(renderSeedFile(file)).toMatchFileSnapshot(`../_dev_/contract/seeds/${name}.json`);
    });
});

it('the folder holds no JSON but the seed files, since the seeder reads every JSON file in it at any depth', () => {
    const json = (readdirSync(FOLDER, { recursive: true }) as string[])
        .filter((path) => path.endsWith('.json'))
        .map((path) => relative(FOLDER, join(FOLDER, path)));
    expect(json.sort()).toEqual(
        Object.keys(FILES)
            .map((name) => `${name}.json`)
            .sort()
    );
});

it('every contract test file has a seed file of its own, named after it, and every other seed file is a script’s', () => {
    const contract = (readdirSync(join(ROOT, 'src')) as string[]).filter((f) => isContractFile(f));
    expect(contract.length, 'control: the contract files are found').toBeGreaterThan(5);
    expect(
        contract.map((f) => f.replace(/-contract\.test\.ts$/, '')).sort(),
        'one seed file per contract file'
    ).toEqual(
        Object.keys(FILES)
            .filter((name) => !SCRIPT_FILES.includes(name))
            .sort()
    );
});

it('each contract file holds a pass for test:contract, a retry, the mutation baseline and every mutation that names it', () => {
    const counts = mutationsPerContractFile() as Record<string, number>;
    expect(Object.keys(counts).length, 'control: mutations name contract files').toBeGreaterThan(3);
    for (const [name, file] of Object.entries(FILES)) {
        if (SCRIPT_FILES.includes(name)) continue;
        const mutations = counts[`src/${name}-contract.test.ts`] ?? 0;
        expect(file.passes, `${name}: passes for ${mutations} mutation(s)`).toBeGreaterThanOrEqual(3 + mutations);
    }
});

type Doc = {
    projects: Array<Record<string, any>>;
    keys: Array<Record<string, any>>;
};
const docs = Object.entries(FILES).map(([name, file]) => [name, file.document as unknown as Doc] as const);

describe('each document is one the clone’s seeder accepts', () => {
    const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
    const PROJECT_FIELDS = [
        'id',
        'title',
        'base_locale',
        'target_locales',
        'website_url',
        'discovery_base_locale_only',
        'locale_code_format',
        'subscription_suspended',
        'human_translation_word_limit',
        'human_translation_words_used',
        'credits_exhausted',
        'machine_translate_new_phrases',
        'phrases',
        'blocks',
        'user',
        'machine_translations',
    ];
    const KEY_FIELDS = [
        'id',
        'key',
        'project',
        'type',
        'ip_allowlist',
        'write_grant_secret',
        'report_discovered_content',
        'usage_exhausted',
        'duplicate_guard',
    ];

    it.each(docs)(
        '%s declares only fields a document takes, and none the seeder refuses (config, faults, reference)',
        (_name, doc) => {
            expect(Object.keys(doc).sort()).toEqual(['keys', 'projects']);
            for (const project of doc.projects)
                for (const field of Object.keys(project)) expect(PROJECT_FIELDS, `projects.${field}`).toContain(field);
            for (const key of doc.keys)
                for (const field of Object.keys(key)) expect(KEY_FIELDS, `keys.${field}`).toContain(field);
        }
    );

    it.each(docs)(
        '%s: ids are UUIDs, tokens are {id}|{secret} with an id of 100000 or more, and a device is named',
        (_name, doc) => {
            for (const row of [...doc.projects, ...doc.keys]) expect(row.id, 'id').toMatch(UUID);
            for (const project of doc.projects) {
                const [id, secret, ...rest] = String(project.user.token).split('|');
                expect(Number(id)).toBeGreaterThanOrEqual(100000);
                expect(secret).toBeTruthy();
                expect(rest, 'a secret holds no pipe').toEqual([]);
                expect(project.user.device_id).toBeTruthy();
            }
        }
    );

    it.each(docs)(
        '%s: a key names one of the file’s projects, a translation names the base or a target locale, a block carries content',
        (_name, doc) => {
            const ids = new Set(doc.projects.map((p) => p.id));
            for (const key of doc.keys)
                if (key.project !== null) expect(ids.has(key.project), `key ${key.key}'s project`).toBe(true);
            for (const project of doc.projects) {
                const locales = new Set([project.base_locale ?? 'en-us', ...(project.target_locales ?? [])]);
                const items = [
                    ...(project.phrases ?? []),
                    ...(project.blocks ?? []).flatMap((b: any) => b.phrases ?? []),
                ];
                for (const item of items)
                    for (const locale of Object.keys(item.translations ?? {}))
                        expect(locales.has(locale), `${locale} on ${item.phrase}`).toBe(true);
                for (const b of project.blocks ?? []) expect(b.content, `block ${b.custom_id}'s content`).toBeTruthy();
            }
        }
    );

    it.each(docs)('%s: no value holds a null byte or runs past 255 characters where the column does', (_name, doc) => {
        const text = JSON.stringify(doc);
        expect(text).not.toContain('\\u0000');
        for (const project of doc.projects) {
            expect(String(project.title).length).toBeLessThanOrEqual(255);
            expect(String(project.user.device_id).length).toBeLessThanOrEqual(255);
        }
    });
});

it('ids, raw keys, user tokens and caller addresses are unique across the files, inside Vue’s ranges', () => {
    const files = Object.values(FILES);
    expect(new Set(files.map((f) => f.index)).size, 'one index per file: it places the file’s ids and addresses').toBe(
        files.length
    );
    expect(new Set(files.map((f) => f.slug)).size, 'one slug per file: it names the file’s raw keys').toBe(
        files.length
    );
    const projects = files.flatMap((f) => f.document.projects) as Array<{
        id: string;
        user: { token: string; device_id: string };
    }>;
    const keys = files.flatMap((f) => f.document.keys) as Array<{ id: string; key: string }>;
    const tokens = projects.map((p) => p.user.token);
    const addresses = files.flatMap((file) =>
        Array.from({ length: file.passes }, (_, pass) =>
            Object.keys(worldsOf(file)).flatMap((name) =>
                file.instances(name, pass).flatMap((w) => Array.from({ length: 6 }, (_, n) => w.addressAt(n)))
            )
        ).flat()
    );
    for (const [what, values] of [
        ['project id', projects.map((p) => p.id)],
        ['key id', keys.map((k) => k.id)],
        ['raw key', keys.map((k) => k.key)],
        ['token id', tokens.map((t) => t.split('|')[0])],
        ['token secret', tokens.map((t) => t.split('|')[1])],
        ['device id', projects.map((p) => p.user.device_id)],
        ['caller address', addresses],
    ] as const) {
        expect(new Set(values).size, `every ${what} is unique`).toBe(values.length);
    }
    for (const id of [...projects, ...keys].map((r) => r.id))
        expect(id).toMatch(/^7900[0-9a-f]{4}-[0-9a-f]{4}-4[0-9a-f]{3}-8[0-9a-f]{3}-[0-9a-f]{12}$/);
    for (const { key } of keys) expect(key.startsWith('vue-'), key).toBe(true);
    for (const token of tokens) {
        const id = Number(token.split('|')[0]);
        expect(id >= 140000 && id <= 149999, token).toBe(true);
    }
    for (const address of addresses) {
        const [a, b, c, d] = address.split('.').map(Number);
        expect([a, b], address).toEqual([10, 79]);
        expect(c! >= 1 && c! <= 240 && d! >= 1 && d! <= 250, address).toBe(true);
    }
});

/** The world names a seed file declares, read back from the pools it built. */
function worldsOf(file: SeedFile<string>): Record<string, true> {
    const names: Record<string, true> = {};
    for (const project of file.document.projects as Array<{ title: string }>) {
        const name = new RegExp(`^vue ${file.slug} (.+)#\\d+ pass \\d+ `).exec(project.title)?.[1];
        if (name) names[name] = true;
    }
    return names;
}

it('the playground and the Nuxt run reach the clone as the world their seed file declares, in every pass', () => {
    for (const name of SCRIPT_FILES) {
        const file = FILES[name]!;
        for (let pass = 0; pass < file.passes; pass++) {
            const [world] = file.instances('base', pass);
            const read = scriptWorld(name, pass);
            expect(read.projectId).toBe(world!.project());
            expect(read.token).toBe(world!.user().token);
            expect(read.deviceId).toBe(world!.user().device_id);
            expect(read.caller).toBe(world!.address);
            expect(Object.values(read.keys).sort()).toEqual([...world!.keys].sort());
        }
    }
});

it('a world is handed out once a pass: each case takes a fresh one, and a pool taken dry throws, naming the count to raise', () => {
    const file = seedFile(
        'pool-check',
        20,
        {
            w: {
                projects: { p1: { target_locales: ['es-es'] } },
                keys: { k: { project: 'p1', type: 'read' } },
                count: 2,
            },
        },
        { passes: 2 }
    );
    const first = file.take('w');
    const second = file.take('w');
    expect(second.project()).not.toBe(first.project());
    expect(second.key('k')).not.toBe(first.key('k'));
    expect(second.address).not.toBe(first.address);
    expect(() => file.take('w')).toThrow(/holds 2 "w" worlds a pass.*raise its count/);
    const [again] = file.instances('w', 1);
    expect(again!.project(), 'another pass holds other projects').not.toBe(first.project());
    expect(again!.address).not.toBe(first.address);
});

it('the six addresses of an instance are its own: no two instances of a file, and no two files, share one', () => {
    const seen = new Set<string>();
    for (const index of [1, 20])
        for (const instance of [1, 250, 251, 500])
            for (let n = 0; n < 6; n++) {
                const address = callerAddress(index, instance, n);
                expect(seen.has(address), address).toBe(false);
                seen.add(address);
            }
    expect(() => callerAddress(1, 501)).toThrow(/outside 1 to 500/);
});
