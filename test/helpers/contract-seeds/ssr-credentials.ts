import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// SRV-2 (src/ssr-credentials-contract.test.ts): three projects, each with a write key of its own.
// `zero` is the module-wide one init() names; `one` and `two` are named by request scopes. Each
// translates "Hello" with its own name, so a render shows whose catalog it read.
const project = (name: string): ProjectSeed => ({
    base_locale: 'en',
    target_locales: ['de', 'it'],
    website_url: `https://${name}.local`,
    phrases: [{ category: 'UI', phrase: 'Hello', translations: { de: `Hallo ${name}`, it: `Ciao ${name}` } }],
});
const KEYS: Record<string, KeySeed> = {
    'key-zero': { project: 'zero', type: 'write' },
    'key-one': { project: 'one', type: 'write' },
    'key-two': { project: 'two', type: 'write' },
};

export default seedFile(
    'ssr-credentials',
    7,
    { base: { projects: { zero: project('zero'), one: project('one'), two: project('two') }, keys: KEYS } },
    { passes: 5 }
);
