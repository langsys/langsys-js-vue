import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// A locale switch that overtakes an in-flight catalog fetch (src/catalog-supersede-contract.test.ts):
// a read-only session on a project that translates "Hello" into four languages.
const P1: ProjectSeed = {
    base_locale: 'en-us',
    target_locales: ['fr-fr', 'de-de', 'it-it', 'pt-pt'],
    website_url: 'https://site.local',
    phrases: [
        {
            category: 'UI',
            phrase: 'Hello',
            translations: { 'fr-fr': 'Bonjour', 'de-de': 'Hallo', 'it-it': 'Ciao', 'pt-pt': 'Olá' },
        },
    ],
};
const KEYS: Record<string, KeySeed> = { 'k-reader': { project: 'p1', type: 'read' } };

export default seedFile('catalog-supersede', 9, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 4 });
