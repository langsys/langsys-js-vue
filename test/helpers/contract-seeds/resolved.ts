import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// GATE-10, MARK-3 and SRV-5 (src/resolved-contract.test.ts): a write session on a project whose
// catalog translates two phrases into Spanish, so everything else it holds is what the SDK registered.
const P1: ProjectSeed = {
    base_locale: 'en',
    target_locales: ['es-es'],
    website_url: 'https://site.local',
    phrases: [
        { category: 'UI', phrase: 'Known phrase', translations: { 'es-es': 'Frase conocida' } },
        { category: 'UI', phrase: 'Hello {m0o}world{m0c}', translations: { 'es-es': 'Hola {m0o}mundo{m0c}' } },
    ],
};
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('resolved', 1, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 8 });
