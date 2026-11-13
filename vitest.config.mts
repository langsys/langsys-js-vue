import { configDefaults, defineConfig } from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'node',
        // Two projects. `unit` is `npm test`: no clone, no listening socket. `contract` is
        // `npm run test:contract`: the files that run against an SDK test clone, a real Langsys API
        // (spec CONF-2, contract-fixture/README.md), and throw without one, since a contract test
        // never passes by skipping. Every request there is a real one and the clock waits in real
        // time, so a case and a hook get the time a real API takes.
        projects: [
            {
                extends: true,
                test: {
                    name: 'unit',
                    include: ['src/**/*.test.ts'],
                    exclude: [...configDefaults.exclude, 'src/**/*-contract.test.ts'],
                },
            },
            {
                extends: true,
                test: {
                    name: 'contract',
                    include: ['src/**/*-contract.test.ts'],
                    testTimeout: 200_000,
                    hookTimeout: 120_000,
                    // One file at a time: each is timing-sensitive against a real API.
                    fileParallelism: false,
                },
            },
        ],
    },
});
