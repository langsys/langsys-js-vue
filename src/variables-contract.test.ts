// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { logger } from 'langsys-js-typescript';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { langsysTransform } from './compiler.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, Translate } from './index.js';

/**
 * VAR-1, VAR-6 and VAR-7 against the contract double: the same component rendered for two users.
 *
 * The session may write, and the double stores any phrase it is sent, so an absence is evidence.
 * Each case waits for a static sibling to be stored before reading, so a flush has happened.
 * Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-writer', project: 'p1', type: 'write' }],
};

let fx: ContractFixture;
const unmounts: Array<() => void> = [];
const phrases = async () => (await fx.state()).projects.p1.phrases.map((p) => p.phrase);

/** Mount the template, compiled for real, for one user. */
function mountFor(template: string, user: string, transform: boolean) {
    const code = compile(template, { mode: 'function', nodeTransforms: transform ? [langsysTransform] : [] }).code;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = Vue.createApp({ render: new Function('Vue', code)(Vue), data: () => ({ user: { firstName: user } }) });
    app.component('Translate', Translate);
    app.mount(el);
    unmounts.push(() => {
        app.unmount();
        el.remove();
    });
}

async function flushedBeside(control: string): Promise<string[]> {
    await vi.advanceTimersByTimeAsync(3_000);
    await until(async () => (await phrases()).includes(control));
    await sleep(200);
    return phrases();
}

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-writer',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
        debug: true,
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
    vi.useFakeTimers({
        toFake: ['setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'],
        shouldAdvanceTime: true,
    });
});
afterAll(async () => {
    vi.useRealTimers();
    await fx.stop();
});
afterEach(() => {
    while (unmounts.length) unmounts.pop()!();
});

describe('a variable inside <Translate>, for two users', () => {
    it('with the transform, both register the one phrase, carrying the placeholder', async () => {
        const tpl =
            '<div><Translate category="UI"><p>Welcome back, {{ user.firstName }}</p></Translate><Translate category="UI"><p>Static A</p></Translate></div>';
        mountFor(tpl, 'Ana', true);
        mountFor(tpl, 'Bo', true);
        const stored = await flushedBeside('Static A');
        expect(stored).toContain('Welcome back, {first_name}');
        expect(stored.filter((p) => p.startsWith('Welcome back'))).toEqual(['Welcome back, {first_name}']);
    });

    it('without it, nothing is registered for the block, and the notice is given once', async () => {
        const log = vi.spyOn(logger, 'log');
        const tpl =
            '<div><Translate category="UI"><p>See you soon, {{ user.firstName }}</p></Translate><Translate category="UI"><p>Static B</p></Translate></div>';
        mountFor(tpl, 'Ana', false);
        mountFor(tpl, 'Bo', false);
        const stored = await flushedBeside('Static B');
        expect(stored.filter((p) => p.startsWith('See you soon'))).toEqual([]);
        expect(log.mock.calls.filter((c) => String(c[0]).includes('(variable)'))).toHaveLength(1);
        log.mockRestore();
    });
});
