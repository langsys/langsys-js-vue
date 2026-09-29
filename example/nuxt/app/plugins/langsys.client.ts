import { LangsysApp, type RequestSeed } from 'langsys-js-vue';

// Seed before the app mounts, with the whole seed, so the first client render matches the served
// HTML and the client never re-sends what the server collected.
export default defineNuxtPlugin((nuxtApp) => {
    const seed = nuxtApp.payload.langsys as RequestSeed | undefined;
    if (seed) LangsysApp.seedCatalog(seed.catalog, seed.locale, seed);
});
