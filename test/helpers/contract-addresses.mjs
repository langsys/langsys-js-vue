/**
 * The caller addresses of the worlds the SDK test clone is seeded with, inside Vue's range
 * 10.79.0.0/16 (langsys docs/sdk-test-clone.md). One formula, read by `contract-worlds.ts` for the
 * tests and by `_dev_/contract/world.mjs` for the playground and the Nuxt end-to-end run, so a
 * script and a test never disagree about where a world calls from.
 *
 * Seed file `index` (1 to 20) owns twelve /24s, 10.79.(12·(index−1)+1) to 10.79.(12·index), which
 * hold 3,000 addresses: six for each of up to 500 instances. Address `n` of instance `instance`
 * (1-based) is the `n`th of its six; 0 is the one the case calls from, 1 the one it moves to.
 */
export const ADDRESSES_PER_INSTANCE = 6;
export const MAX_INSTANCES = 500;

export function callerAddress(index, instance, n = 0) {
    if (!Number.isInteger(index) || index < 1 || index > 20)
        throw new Error(`seed file index ${index} is outside 1 to 20`);
    if (!Number.isInteger(instance) || instance < 1 || instance > MAX_INSTANCES)
        throw new Error(`instance ${instance} is outside 1 to ${MAX_INSTANCES}`);
    if (!Number.isInteger(n) || n < 0 || n >= ADDRESSES_PER_INSTANCE)
        throw new Error(`address ${n} is outside 0 to ${ADDRESSES_PER_INSTANCE - 1}`);
    const slot = n * MAX_INSTANCES + (instance - 1);
    return `10.79.${12 * (index - 1) + 1 + Math.floor(slot / 250)}.${(slot % 250) + 1}`;
}
