import vue from '@vitejs/plugin-vue';
import { defineConfig, loadEnv } from 'vite';
import { langsysTransform } from './src/compiler';

/**
 * Config for the local playground in `example/` (run with `npm run dev`).
 * It is not part of the published package — the library itself is built with
 * tsup (see `tsup.config.ts`).
 *
 * The playground imports the SDK straight from `../src`, so edits to the
 * library hot-reload. `.env` is read from the repo root (see `.env.example`).
 *
 * `LANGSYS_API_PROXY` serves another API under this origin's `/api`, so the
 * browser calls it same-origin: the local contract double (`npm run double`)
 * sends no CORS headers. Pair it with `VITE_LANGSYS_API_URL=/api`.
 */
export default defineConfig(({ mode }) => {
    const proxy = loadEnv(mode, '..', '').LANGSYS_API_PROXY;
    return {
        root: 'example',
        envDir: '..',
        // The template transform (`langsys-js-vue/compiler`), as an app enables it.
        plugins: [vue({ template: { compilerOptions: { nodeTransforms: [langsysTransform] } } })],
        server: {
            // Allow serving the library source that lives one level above `example/`.
            fs: { allow: ['..'] },
            ...(proxy ? { proxy: { '/api': { target: proxy, changeOrigin: true } } } : {}),
        },
    };
});
