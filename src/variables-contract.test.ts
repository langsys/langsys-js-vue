// @vitest-environment jsdom
// @vitest-environment-options {"url": "https://site.local/"}
import { afterAll, afterEach, beforeAll, describe, expect, it, vi } from 'vitest';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { logger } from 'langsys-js-typescript';
import { startContractFixture, sleep, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { UNREGISTERED_REASON } from './block-vnodes.js';
import { langsysTransform } from './compiler.js';
import { createLocaleStore, currentlyLoadedLocale, DontTranslate, LangsysApp, Phrase, Translate } from './index.js';

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
/** Every stored text: phrases, and block content. */
const storedText = async () => {
    const p1 = (await fx.state()).projects.p1;
    return [...p1.phrases.map((p) => p.phrase), ...p1.blocks.map((b) => b.content ?? '')].join('\n');
};

/** Mount the template, compiled for real, for one user. */
function mountFor(template: string, user: string, transform: boolean, cms = ''): HTMLElement {
    const code = compile(template, { mode: 'function', nodeTransforms: transform ? [langsysTransform] : [] }).code;
    const el = document.createElement('div');
    document.body.appendChild(el);
    const app = Vue.createApp({
        render: new Function('Vue', code)(Vue),
        data: () => ({
            user: { firstName: user, email: `${user.toLowerCase()}@mail.test` },
            owner: { name: `${user} Sr` },
            cms,
        }),
    });
    app.component('Translate', Translate);
    app.component('Phrase', Phrase);
    app.component('DontTranslate', DontTranslate);
    app.mount(el);
    unmounts.push(() => {
        app.unmount();
        el.remove();
    });
    return el;
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
        expect(log.mock.calls.filter((c) => String(c[0]).includes(`(${UNREGISTERED_REASON})`))).toHaveLength(1);
        log.mockRestore();
    });
});

describe('raw HTML is content, not a variable (VAR-7)', () => {
    it('a block whose only dynamic part is v-html registers its HTML as content, without the transform', async () => {
        const tpl =
            '<div><Translate category="UI"><div v-html="cms"></div></Translate><Translate category="UI"><p>Static C</p></Translate></div>';
        mountFor(tpl, 'Ana', false, '<p>Our spring collection</p><p>is in stores now</p>');
        await flushedBeside('Static C');
        expect(await storedText()).toContain('Our spring collection');
    });

    it('mixed with an interpolated value, it registers nothing: not the HTML, not the value', async () => {
        const tpl =
            '<div><Translate category="UI"><div v-html="cms"></div><p>Hi {{ user.firstName }}</p></Translate><Translate category="UI"><p>Static D</p></Translate></div>';
        mountFor(tpl, 'Ana', false, '<p>Autumn arrivals</p><p>are in stores</p>');
        await flushedBeside('Static D');
        const text = await storedText();
        expect(text).not.toContain('Hi Ana');
        expect(text).not.toContain('Autumn arrivals');
    });
});

/**
 * TOK-1 and VAR-3: a value printed inside an excluded element, `<DontTranslate>` or an author's
 * `translate="no"`. The sentence is the shared canonicalization fixture's (langsys-js-typescript
 * tests/fixtures/canonicalization-reference.json, blob 926e8b55): rows tok1-rich-no-literal and
 * tok1-rich-notrans-literal key the phrase, row var-content-translate-no the block's content.
 * Each shape registers under a category of its own, so the two cannot merge.
 */
describe('a value inside an excluded element, for two users', () => {
    const SHAPES = {
        a: '<DontTranslate>{{ user.email }}</DontTranslate>',
        b: '<span translate="no">{{ user.email }}</span>',
    };
    const inCategory = async (category: string) => {
        const p1 = (await fx.state()).projects.p1;
        return {
            phrases: p1.phrases.filter((x) => x.category === category).map((x) => x.phrase),
            blocks: p1.blocks.filter((x) => x.category === category).map((x) => x.content),
        };
    };
    const twoUsers = (hosts: (shape: string, category: string) => string, prefix: string, control: string) => {
        const tpl = `<div>${Object.entries(SHAPES)
            .map(([k, shape]) => hosts(shape, `${prefix}${k}`))
            .join('')}<Phrase category="UI">${control}</Phrase></div>`;
        return (transform: boolean) => [mountFor(tpl, 'Ana', transform), mountFor(tpl, 'Bo', transform)];
    };
    const expectShown = (els: HTMLElement[]) => {
        expect(els[0]!.textContent).toContain('Signed in as ana@mail.test today');
        expect(els[1]!.textContent).toContain('Signed in as bo@mail.test today');
        for (const el of els) expect(el.innerHTML).not.toContain('%email%');
    };
    const expectNoValueStored = async () => {
        const text = await storedText();
        expect(text).not.toContain('ana@mail.test');
        expect(text).not.toContain('bo@mail.test');
    };

    for (const transform of [true, false]) {
        const mode = transform ? 'with the transform' : 'without it';
        const n = transform ? 1 : 2;
        it(`<Phrase>, ${mode}: both users register the one phrase, the value shown and never stored`, async () => {
            const els = twoUsers(
                (shape, category) => `<Phrase category="${category}">Signed in as ${shape} today</Phrase>`,
                `TP${n}`,
                `Static TP${n}`
            )(transform);
            await flushedBeside(`Static TP${n}`);
            for (const k of Object.keys(SHAPES))
                expect((await inCategory(`TP${n}${k}`)).phrases).toEqual(['Signed in as {m0o}{m0c} today']);
            expectShown(els);
            await expectNoValueStored();
        });
    }

    it('<Translate>, with the transform: one block, its content holding the name, the value shown', async () => {
        const els = twoUsers(
            (shape, category) => `<Translate category="${category}"><p>Signed in as ${shape} today</p></Translate>`,
            'TB1',
            'Static TB1'
        )(true);
        await flushedBeside('Static TB1');
        expect((await inCategory('TB1a')).blocks).toEqual([
            '<p>Signed in as <span translate="no" data-ls-dont-translate="">{email}</span> today</p>',
        ]);
        expect((await inCategory('TB1b')).blocks).toEqual([
            '<p>Signed in as <span translate="no">{email}</span> today</p>',
        ]);
        expectShown(els);
        await expectNoValueStored();
    });

    it('<Translate>, without it: the block registers nothing, since its content would keep the value', async () => {
        const els = twoUsers(
            (shape, category) => `<Translate category="${category}"><p>Signed in as ${shape} today</p></Translate>`,
            'TB2',
            'Static TB2'
        )(false);
        await flushedBeside('Static TB2');
        for (const k of Object.keys(SHAPES)) expect((await inCategory(`TB2${k}`)).blocks).toEqual([]);
        expectShown(els);
        await expectNoValueStored();
    });
});

/**
 * MARK-4 and VAR-2: a `<Phrase>` nested in a `<Translate>`, each holding a value. The nested host
 * is left out of the block's unit and registers itself; the block registers its own text around
 * the host's shell, and the phrase keys as it does standing alone, each with its own values.
 */
describe('a <Phrase> nested in a <Translate>, both holding a value', () => {
    const inCategory = async (category: string) => {
        const p1 = (await fx.state()).projects.p1;
        return {
            phrases: p1.phrases.filter((x) => x.category === category).map((x) => x.phrase),
            blocks: p1.blocks.filter((x) => x.category === category).map((x) => x.content),
        };
    };

    it('with the transform, the block registers its text around the phrase, which keys as it does alone', async () => {
        const tpl =
            '<div><Translate category="NB"><p>Hi {{ user.firstName }}</p><p>Welcome back</p><Phrase category="NB">By {{ owner.name }}</Phrase></Translate>' +
            '<Phrase category="NS">By {{ owner.name }}</Phrase><Phrase category="UI">Static NB</Phrase></div>';
        const els = [mountFor(tpl, 'Ana', true), mountFor(tpl, 'Bo', true)];
        await flushedBeside('Static NB');
        const nested = await inCategory('NB');
        expect(nested.blocks).toHaveLength(1);
        // The nested phrase is left out of the block's unit: its host stays as an empty shell
        // carrying its own category.
        expect(nested.blocks).toEqual([
            '<p>Hi {first_name}</p><p>Welcome back</p><span data-ls-phrase="" data-ls-category="NB"></span>',
        ]);
        expect(nested.phrases).toEqual(['By {name}']);
        expect((await inCategory('NS')).phrases).toEqual(['By {name}']);
        expect(els[0]!.querySelector('translate')?.textContent).toBe('Hi AnaWelcome backBy Ana Sr');
        expect(els[1]!.querySelector('translate')?.textContent).toBe('Hi BoWelcome backBy Bo Sr');
        const text = await storedText();
        for (const value of ['Ana', 'Bo']) expect(text).not.toMatch(new RegExp(`\\b${value}\\b`));
    });

    it('a nested <Phrase> with a category of its own registers only under it', async () => {
        const tpl =
            '<div><Translate category="NO"><p>Hi {{ user.firstName }}</p><p>See you</p><Phrase category="NP">By {{ owner.name }}</Phrase></Translate>' +
            '<Phrase category="UI">Static NO</Phrase></div>';
        mountFor(tpl, 'Ana', true);
        await flushedBeside('Static NO');
        expect((await inCategory('NO')).phrases).toEqual([]);
        expect((await inCategory('NO')).blocks).toHaveLength(1);
        expect((await inCategory('NP')).phrases).toEqual(['By {name}']);
    });

    it('control: without values, the block registers its text around the phrase too', async () => {
        const tpl =
            '<div><Translate category="NC"><p>Hello there</p><p>Glad you came</p><Phrase category="NC">By the team</Phrase></Translate>' +
            '<Phrase category="UI">Static NC</Phrase></div>';
        mountFor(tpl, 'Ana', true);
        await flushedBeside('Static NC');
        const nested = await inCategory('NC');
        expect(nested.blocks).toHaveLength(1);
        expect(nested.blocks[0]).toContain('<p>Hello there</p><p>Glad you came</p>');
        expect(nested.blocks[0]).not.toContain('By the team');
        expect(nested.phrases).toEqual(['By the team']);
    });
});
