import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// The playground's project (`npm run fixture`, TESTING.md): the content `example/` renders, with
// the Spanish and German translations it shows, on a project that machine-translates new content
// so a read-only key's hint is accepted. It is no test's world.
const P1: ProjectSeed = {
    title: 'Local testbed',
    base_locale: 'en-us',
    target_locales: ['es-es', 'fr-fr', 'de-de'],
    website_url: 'http://localhost',
    machine_translate_new_phrases: true,
    phrases: [
        {
            category: 'Demo',
            phrase: 'Welcome to the Langsys + Vue demo',
            translations: {
                'es-es': 'Bienvenido a la demo de Langsys + Vue',
                'de-de': 'Willkommen zur Langsys + Vue Demo',
            },
        },
        {
            category: 'Demo',
            phrase: 'Hello {first_name}, welcome back',
            translations: {
                'es-es': 'Hola {first_name}, bienvenido de nuevo',
                'de-de': 'Hallo {first_name}, willkommen zurück',
            },
        },
        { category: 'UI', phrase: 'Locale', translations: { 'es-es': 'Idioma', 'de-de': 'Sprache' } },
        {
            category: 'UI',
            phrase: 'Hello {first_name}',
            translations: { 'es-es': 'Hola {first_name}', 'de-de': 'Hallo {first_name}' },
        },
    ],
};
const KEYS: Record<string, KeySeed> = {
    // The session may write, so its misses are registered.
    'k-writer': { project: 'p1', type: 'write' },
    // Read-only from the playground's address, and permitted to report the page it is on.
    'k-hints': { project: 'p1', type: 'ip_write', report_discovered_content: true },
};

export default seedFile('playground', 11, { base: { projects: { p1: P1 }, keys: KEYS } });
