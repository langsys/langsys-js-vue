import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// SRV-1 and SRV-3 (src/ssr-scope-contract.test.ts): a server session that may write, on a project
// translated into Italian and German.
const P1: ProjectSeed = {
    base_locale: 'en',
    target_locales: ['it', 'de'],
    website_url: 'https://site.local',
    phrases: [{ category: 'UI', phrase: 'Pricing', translations: { it: 'Prezzi', de: 'Preise' } }],
};
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('ssr-scope', 5, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 5 });
