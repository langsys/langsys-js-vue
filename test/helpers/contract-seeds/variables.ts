import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// VAR-1, VAR-3, VAR-6, VAR-7, TOK-1 and MARK-4 (src/variables-contract.test.ts): a write session on
// an empty project, so everything it holds is what the SDK registered.
const P1: ProjectSeed = { base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('variables', 8, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 19 });
