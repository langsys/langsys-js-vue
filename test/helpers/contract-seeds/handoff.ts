import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// SRV-4 with SRV-3 (src/handoff-contract.test.ts): a write session on an empty project, rendering
// on the server and hydrating on the client.
const P1: ProjectSeed = { base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('handoff', 6, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 5 });
