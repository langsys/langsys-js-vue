import { langsysTransform } from 'langsys-js-vue/compiler';

// The end-to-end Nuxt app `_dev_/nuxt-e2e.mjs` builds against the contract double.
export default defineNuxtConfig({
    compatibilityDate: '2026-09-01',
    ssr: true,
    devtools: { enabled: false },
    // VAR-6: the template transform, through Nuxt's own compiler options.
    vue: { compilerOptions: { nodeTransforms: [langsysTransform] } },
});
