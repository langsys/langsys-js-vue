import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// A slot that changes after mount (src/block-updates-contract.test.ts): a write session on an
// empty project, so everything it holds is what the SDK registered.
const P1: ProjectSeed = { base_locale: 'en', target_locales: ['it'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('block-updates', 10, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 11 });
