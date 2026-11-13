import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// REG-7 (src/register-once-contract.test.ts): a write session whose page loads in Spanish, so the
// page load changes t twice.
const P1: ProjectSeed = {
    base_locale: 'en',
    target_locales: ['es-es'],
    website_url: 'https://site.local',
    phrases: [{ category: 'UI', phrase: 'Known phrase', translations: { 'es-es': 'Frase conocida' } }],
};
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('register-once', 4, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 4 });
