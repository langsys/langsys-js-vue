import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// The Nuxt end-to-end run (`npm run test:nuxt`, _dev_/nuxt-e2e.mjs): a server session that may
// write, on a project translating the page's placeholder phrase into Italian and German.
const P1: ProjectSeed = {
    base_locale: 'en',
    target_locales: ['it', 'de'],
    website_url: 'https://site.local',
    phrases: [
        {
            category: 'UI',
            phrase: 'Hello {first_name}',
            translations: { it: 'Ciao {first_name}', de: 'Hallo {first_name}' },
        },
    ],
};
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('nuxt', 12, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 4 });
