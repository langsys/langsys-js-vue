import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// REG-13 (src/switch-during-registration-contract.test.ts): a write session on an empty project.
// The translator's work is the case's own import through the API.
const P1: ProjectSeed = { base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('switch-during-registration', 3, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 4 });
