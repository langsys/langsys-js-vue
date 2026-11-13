import { LangsysApp, createLocaleStore } from 'langsys-js-vue';

// Initialise the SDK once per server process, with a key that may write, collecting on the server.
// The project, key and API come from the environment, as `_dev_/nuxt-e2e.mjs` sets them.
export default defineNitroPlugin(() => {
    (globalThis as Record<string, unknown>).__langsysReady = LangsysApp.init({
        projectid: process.env.LANGSYS_PROJECT_ID ?? '',
        key: process.env.LANGSYS_API_KEY ?? '',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: process.env.LANGSYS_API_URL,
        ssrTokenStrategy: 'server',
    });
});
