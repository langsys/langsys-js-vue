import { LangsysApp, createLocaleStore } from 'langsys-js-vue';

// Initialise the SDK once per server process, with a key that may write, collecting on the server.
export default defineNitroPlugin(() => {
    (globalThis as Record<string, unknown>).__langsysReady = LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: process.env.LANGSYS_API_URL,
        ssrTokenStrategy: 'server',
    });
});
