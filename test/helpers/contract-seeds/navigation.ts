import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// HINT-13 (src/navigation-contract.test.ts): a read-only session permitted to report, on a project
// that machine-translates new content, the only kind that accepts a hint. The page components
// render a phrase the catalog translates, so they record nothing.
const P1: ProjectSeed = {
    base_locale: 'en',
    target_locales: ['es-es'],
    website_url: 'https://site.local',
    machine_translate_new_phrases: true,
    phrases: [{ category: 'UI', phrase: 'Known phrase', translations: { 'es-es': 'Frase conocida' } }],
};
const KEYS: Record<string, KeySeed> = {
    'k-public': { project: 'p1', type: 'ip_write', report_discovered_content: true },
};

export default seedFile('navigation', 2, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 7 });
