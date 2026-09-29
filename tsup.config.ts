import { defineConfig } from 'tsup';

export default defineConfig({
    // `server` is the server-only entry (node:async_hooks); it never reaches a browser bundle.
    // `compiler` is the build-time template transform (VAR-6); it never reaches a browser bundle.
    entry: ['src/index.ts', 'src/server.ts', 'src/compiler.ts'],
    format: ['esm', 'cjs'],
    dts: true,
    sourcemap: true,
    clean: true,
    target: 'es2021',
    treeshake: true,
    splitting: false,
    minify: false,
    // Vue is provided by the consuming app — never bundle it.
    external: ['vue'],
});
