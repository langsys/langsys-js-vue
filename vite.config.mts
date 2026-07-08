import vue from '@vitejs/plugin-vue';
import { defineConfig } from 'vite';

/**
 * Config for the local playground in `example/` (run with `npm run dev`).
 * It is not part of the published package — the library itself is built with
 * tsup (see `tsup.config.ts`).
 *
 * The playground imports the SDK straight from `../src`, so edits to the
 * library hot-reload. `.env` is read from the repo root (see `.env.example`).
 */
export default defineConfig({
    root: 'example',
    envDir: '..',
    plugins: [vue()],
    server: {
        // Allow serving the library source that lives one level above `example/`.
        fs: { allow: ['..'] },
    },
});
