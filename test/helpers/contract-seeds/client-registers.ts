import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// SRV-7 (src/client-registers-contract.test.ts): a write session on an empty project. The server
// renders a block inside a request scope and leaves it to the client, which registers it from the
// page it hydrated.
const P1: ProjectSeed = { base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-writer': { project: 'p1', type: 'write' } };

export default seedFile('client-registers', 13, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 5 });
