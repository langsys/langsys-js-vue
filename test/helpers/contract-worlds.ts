import { createHash } from 'node:crypto';
import { callerAddress, MAX_INSTANCES } from './contract-addresses.mjs';

/**
 * The worlds the SDK test clone is seeded with before a run (spec CONF-2), and the handle a test
 * case reaches its own through.
 *
 * Each contract test file declares its worlds in a module under `contract-seeds/`, and its seed
 * file (`_dev_/contract/seeds/<slug>.json`, read by the clone's seeder) is that module rendered:
 * `src/seed-files.test.ts` fails when the two differ, and
 * `npx vitest run --project unit src/seed-files.test.ts -u` writes the JSON again. A changed seed
 * file takes effect at the next reseed.
 *
 * A world is a pool of identical instances, and `take` hands out the next unused one. Cases that
 * would read each other's writes take an instance each; cases that register texts of their own
 * share one, and each reads back only its own texts. What a run writes stays until the clone is
 * reseeded, so a file holds its worlds `passes` times over, and a run takes the pass
 * `LANGSYS_CONTRACT_PASS` names (0 when unset): `npm run test:contract` takes pass 0, and the
 * mutation runner gives its baseline and each mutation a pass of their own, so one reseed serves
 * them all.
 *
 * An instance's ids, keys, user token and caller addresses are fixed by its place in the file,
 * inside Vue's ranges (langsys docs/sdk-test-clone.md): ids `7900xxxx-…`, raw keys `vue-…`, token
 * ids 140000 to 149999, addresses in 10.79.0.0/16 (`contract-addresses.mjs`).
 */

export interface PhraseSeed {
    category?: string | null;
    phrase: string;
    translatable?: boolean;
    translations?: Record<string, string>;
}

export interface BlockSeed {
    category?: string | null;
    custom_id: string;
    content?: string | null;
    label?: string | null;
    phrases?: Array<{ phrase: string; translatable?: boolean; translations?: Record<string, string> }>;
}

export interface ProjectSeed {
    title?: string;
    base_locale?: string;
    target_locales?: string[];
    website_url?: string | null;
    machine_translate_new_phrases?: boolean;
    subscription_suspended?: boolean;
    credits_exhausted?: boolean;
    discovery_base_locale_only?: boolean;
    human_translation_word_limit?: number | null;
    human_translation_words_used?: number;
    locale_code_format?: 'lowercase-hyphen' | 'bcp47' | 'posix';
    phrases?: PhraseSeed[];
    blocks?: BlockSeed[];
    machine_translations?: unknown;
}

/**
 * A key, attached to one of its world's projects by role, or to none. An `ip_allowlist` entry may
 * name the instance's own addresses: `@self` the address its case calls from, `@moved` the second
 * one it can move to, `@net` the /24 holding `@self`.
 */
export interface KeySeed {
    project: string | null;
    type: 'read' | 'write' | 'ip_write';
    ip_allowlist?: string[];
    write_grant_secret?: string | null;
    report_discovered_content?: boolean;
    usage_exhausted?: boolean;
    duplicate_guard?: { max_attempts?: number; window_seconds?: number; methods?: string[] } | null;
}

/**
 * Projects and keys by role, and how many instances each pass of the file's cases takes.
 * `unknown` names keys and projects the clone never holds, each the instance's own, for cases
 * about what the API says to them.
 */
export interface WorldSeed {
    projects: Record<string, ProjectSeed>;
    keys: Record<string, KeySeed>;
    unknown?: { keys?: string[]; projects?: string[] };
    count?: number;
}

export interface SeededUser {
    token: string;
    device_id: string;
}

/** One instance of a world: what a case needs to reach it, and to name itself to the forwarder. */
export interface World {
    readonly name: string;
    /** The address the case calls from. */
    readonly address: string;
    /** A second address of the case's own, to move to when its world drifts. */
    readonly moved: string;
    /** The case's `n`th address (0 to 5): 0 is `address`, 1 is `moved`, the rest are spares, as a visitor on another network. */
    addressAt(n: number): string;
    project(role?: string): string;
    key(role: string): string;
    keyId(role: string): string;
    /** The seeded user who owns the project, as the user routes take them. */
    user(role?: string): SeededUser;
    readonly keys: string[];
    readonly projects: string[];
    readonly tokens: string[];
    /** What the instance's seed declares, for the check that it landed before its case acts. */
    readonly declared: Declared;
}

/**
 * An instance's seeded projects, each with its seed, and its seeded keys as the key listing
 * returns them: the type, the allow-list with its addresses named, and whether a write-grant
 * secret is set.
 */
export interface Declared {
    projects: Array<{ role: string; id: string; seed: ProjectSeed }>;
    keys: Array<{
        role: string;
        id: string;
        project: string | null;
        type: KeySeed['type'];
        ip_allowlist: string[] | null;
        write_grant_secret: boolean;
    }>;
}

export interface SeedFile<N extends string> {
    slug: string;
    index: number;
    /** How many times over the file holds its worlds: one pass per run between reseeds. */
    passes: number;
    /** The names of the worlds the file declares. */
    worlds: readonly N[];
    /** What the clone's seeder reads: `{projects, keys}`. */
    document: { projects: Record<string, unknown>[]; keys: Record<string, unknown>[] };
    /** The next unused instance of a world, in the run's pass. */
    take(name: N): World;
    /** Every instance of a world in pass `pass`, in the order `take` hands them out. */
    instances(name: N, pass: number): World[];
}

const hex = (n: number, width: number) => n.toString(16).padStart(width, '0');

/** The pass this run takes, from `LANGSYS_CONTRACT_PASS`: 0 when unset. */
export function contractPass(passes: number, slug: string): number {
    const given = process.env.LANGSYS_CONTRACT_PASS;
    const pass = given === undefined || given === '' ? 0 : Number(given);
    if (!Number.isInteger(pass) || pass < 0 || pass >= passes) {
        throw new Error(
            `LANGSYS_CONTRACT_PASS=${given}, and _dev_/contract/seeds/${slug}.json holds passes 0 to ${passes - 1}: ` +
                `raise its passes in test/helpers/contract-seeds/${slug}.ts, write the JSON again and reseed the clone`
        );
    }
    return pass;
}

/** The seed file of the contract test file `slug`, the `index`th in Vue's range, holding its worlds `passes` times over. */
export function seedFile<N extends string>(
    slug: string,
    index: number,
    worlds: Record<N, WorldSeed>,
    { passes = 1 }: { passes?: number } = {}
): SeedFile<N> {
    if (!Number.isInteger(index) || index < 1 || index > 20)
        throw new Error(`seed file index ${index} is outside 1 to 20`);
    if (!Number.isInteger(passes) || passes < 1) throw new Error(`${slug}: passes ${passes} is not a positive integer`);
    const projects: Record<string, unknown>[] = [];
    const keys: Record<string, unknown>[] = [];
    // instances[pass][name] is that pass's pool of the world.
    const instances: Array<Map<N, World[]>> = [];
    let instance = 0;
    let projectSerial = 0;
    let keySerial = 0;

    for (let pass = 0; pass < passes; pass++) {
        const pools = new Map<N, World[]>();
        for (const [name, world] of Object.entries(worlds) as Array<[N, WorldSeed]>) {
            const pool: World[] = [];
            for (let i = 0; i < (world.count ?? 1); i++) {
                instance += 1;
                if (instance > MAX_INSTANCES)
                    throw new Error(`${slug}: more than ${MAX_INSTANCES} world instances in one file`);
                const label = `${name}#${i + 1} pass ${pass}`;
                const self = instance;
                const at = (n: number) => callerAddress(index, self, n);
                const address = at(0);
                const moved = at(1);
                const net = address.replace(/\.\d+$/, '.0/24');
                const ids = new Map<string, string>();
                const users = new Map<string, SeededUser>();
                const declared: Declared = { projects: [], keys: [] };
                for (const [role, project] of Object.entries(world.projects)) {
                    projectSerial += 1;
                    // 500 token ids per file, from 140000.
                    if (projectSerial > 499) throw new Error(`${slug}: more than 499 projects in one file`);
                    const id = `7900${hex(index, 2)}00-${hex(projectSerial, 4)}-4000-8000-000000000000`;
                    const secret = createHash('sha256')
                        .update(`vue:${slug}:${projectSerial}`)
                        .digest('hex')
                        .slice(0, 40);
                    const user = {
                        token: `${140000 + (index - 1) * 500 + projectSerial}|${secret}`,
                        device_id: `vue-${slug}-${projectSerial}`,
                    };
                    ids.set(role, id);
                    users.set(role, user);
                    declared.projects.push({ role, id, seed: project });
                    projects.push({ id, title: `vue ${slug} ${label} ${role}`, ...project, user });
                }
                const raw = new Map<string, string>();
                const keyIds = new Map<string, string>();
                for (const [role, key] of Object.entries(world.keys)) {
                    keySerial += 1;
                    const id = `7900${hex(index, 2)}01-${hex(keySerial, 4)}-4000-8000-000000000000`;
                    const value = `vue-${slug}-${instance}-${role}`;
                    if (key.project !== null && !ids.has(key.project))
                        throw new Error(`${slug} ${name}: key ${role} names no project ${key.project}`);
                    const { ip_allowlist, ...rest } = key;
                    const allowlist = ip_allowlist?.map((entry) => {
                        if (!entry.startsWith('@')) return entry;
                        const named = ({ '@self': address, '@moved': moved, '@net': net } as Record<string, string>)[
                            entry
                        ];
                        if (!named) throw new Error(`${slug} ${name}: key ${role} names no address ${entry}`);
                        return named;
                    });
                    raw.set(role, value);
                    keyIds.set(role, id);
                    // The clone stores an empty allow-list as none.
                    declared.keys.push({
                        role,
                        id,
                        project: key.project === null ? null : ids.get(key.project)!,
                        type: key.type,
                        ip_allowlist: allowlist?.length ? allowlist : null,
                        write_grant_secret: (key.write_grant_secret ?? null) !== null,
                    });
                    keys.push({
                        id,
                        key: value,
                        ...rest,
                        project: key.project === null ? null : ids.get(key.project),
                        ...(allowlist ? { ip_allowlist: allowlist } : {}),
                    });
                }
                for (const role of world.unknown?.keys ?? []) raw.set(role, `vue-${slug}-${instance}-${role}`);
                (world.unknown?.projects ?? []).forEach((role, n) =>
                    ids.set(role, `7900${hex(index, 2)}02-${hex(instance, 4)}-4000-8000-${hex(n + 1, 12)}`)
                );
                const lookup = <T>(table: Map<string, T>, kind: string, role: string): T => {
                    const found = table.get(role);
                    if (found === undefined) throw new Error(`${slug} ${label} has no ${kind} ${role}`);
                    return found;
                };
                pool.push({
                    name: label,
                    address,
                    moved,
                    addressAt: at,
                    project: (role = 'p1') => lookup(ids, 'project', role),
                    key: (role) => lookup(raw, 'key', role),
                    keyId: (role) => lookup(keyIds, 'key', role),
                    user: (role = 'p1') => lookup(users, 'user', role),
                    keys: [...raw.values()],
                    projects: [...ids.values()],
                    tokens: [...users.values()].map((u) => u.token),
                    declared,
                });
            }
            pools.set(name, pool);
        }
        instances.push(pools);
    }

    const taken = new Map<N, number>();
    const poolOf = (name: N, pass: number) => {
        const pool = instances[pass]?.get(name);
        if (!pool) throw new Error(`${slug} declares no world ${name}`);
        return pool;
    };
    return {
        slug,
        index,
        passes,
        worlds: Object.keys(worlds) as N[],
        document: { projects, keys },
        instances: (name, pass) => [...poolOf(name, pass)],
        take(name) {
            const pool = poolOf(name, contractPass(passes, slug));
            const next = taken.get(name) ?? 0;
            if (next >= pool.length) {
                throw new Error(
                    `_dev_/contract/seeds/${slug}.json holds ${pool.length} "${name}" worlds a pass and this is case ${next + 1} to take one: ` +
                        `raise its count in test/helpers/contract-seeds/${slug}.ts, write the JSON again and reseed the clone`
                );
            }
            taken.set(name, next + 1);
            return pool[next]!;
        },
    };
}

/** A seed file as the clone's seeder reads it. */
export const renderSeedFile = (file: SeedFile<string>) => JSON.stringify(file.document, null, 4) + '\n';
