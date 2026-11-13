import { afterAll, beforeAll, describe, expect, it, vi } from 'vitest';
import { createSSRApp, defineComponent, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { startContractFixture, until, type ContractFixture } from '../test/helpers/contract-fixture.js';
import { createLocaleStore, currentlyLoadedLocale, LangsysApp, useServerMessage, type ServerMessage } from './index.js';

/**
 * MSG-5, MSG-6 — the messages category's previous category reaches the core through the `init`
 * override.
 *
 * An app that renamed its messages category names the old one as `messagesPreviousCategory`, as
 * the server is configured, and a template with no translation under the new category renders
 * the old category's (MOVE-4). The decision is the core's `renderServerMessage()`; this binding's
 * part is that the option arrives as the app wrote it. Proven by what `useServerMessage()` renders
 * over a catalog holding the template only under the previous category.
 *
 * Its own file: a second `init()` in one process is a no-op.
 */

const SEED = {
    projects: [{ id: 'p1', base_locale: 'en', target_locales: ['es-es'], website_url: 'https://site.local' }],
    keys: [{ key: 'k-public', project: 'p1', type: 'ip_write', report_discovered_content: false }],
};

const TEMPLATE = 'The {field} field is required.';
const entry = { template: TEMPLATE, params: { field: 'email' }, message: 'The email field is required.' };

let fx: ContractFixture;

beforeAll(async () => {
    fx = await startContractFixture();
    await fx.seed(SEED);
    for (const m of ['log', 'info', 'warn', 'error', 'group', 'groupCollapsed', 'groupEnd'] as const)
        vi.spyOn(console, m).mockImplementation(() => {});
    await LangsysApp.init({
        projectid: 'p1',
        key: 'k-public',
        UserLocaleStore: createLocaleStore('en'),
        baseLocale: 'en',
        apiUrl: fx.baseUrl,
        messagesCategory: 'Messages',
        messagesPreviousCategory: 'Errors',
    });
    await until(() => currentlyLoadedLocale.get() === 'en');
    LangsysApp.seedCatalog(
        { __uncategorized__: {}, Errors: { [TEMPLATE]: 'El campo {field} es obligatorio.' } } as never,
        'es-es'
    );
});
afterAll(async () => {
    await fx.stop();
});

const rendered = (category?: string, shown: ServerMessage = entry) =>
    renderToString(
        createSSRApp(
            defineComponent({
                setup() {
                    const render = useServerMessage(category);
                    return () => h('p', render.value(shown));
                },
            })
        )
    );

describe('MSG-6 — messagesPreviousCategory reaches the core through the init override', () => {
    it("a template the new category lacks renders the previous category's translation", async () => {
        expect(await rendered()).toBe('<p>El campo email es obligatorio.</p>');
    });

    it("control: a template neither category holds shows the entry's message", async () => {
        const other = { template: 'Too many attempts.', message: 'Too many attempts, wait a minute.' };
        expect(await rendered(undefined, other)).toBe('<p>Too many attempts, wait a minute.</p>');
    });

    it('control: a category other than the configured one names no move', async () => {
        expect(await rendered('Validation')).toBe('<p>The email field is required.</p>');
    });
});
