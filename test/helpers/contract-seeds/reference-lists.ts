import { seedFile, type KeySeed, type ProjectSeed } from '../contract-worlds.js';

// REF-1 (src/reference-lists-contract.test.ts): a read session whose current locale is Spanish,
// on a project the API serves catalogs for in each display locale a case reads a list in. The
// lists themselves are the case's crafted ones, which the forwarder answers once the API has
// accepted the request.
const P1: ProjectSeed = { base_locale: 'en-us', target_locales: ['es-es', 'de-de'], website_url: 'https://site.local' };
const KEYS: Record<string, KeySeed> = { 'k-reader': { project: 'p1', type: 'read' } };

export default seedFile('reference-lists', 14, { base: { projects: { p1: P1 }, keys: KEYS } }, { passes: 5 });
