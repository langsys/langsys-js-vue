import { describe, expect, it } from 'vitest';
import { createSSRApp, h } from 'vue';
import { renderToString } from 'vue/server-renderer';
import { DontTranslate } from './components/DontTranslate.js';
import { Phrase } from './components/Phrase.js';
import { Translate } from './components/Translate.js';

/**
 * Structural smoke coverage for the components. The test env is node (no DOM),
 * and server rendering does NOT run `onMounted` — so the vanilla handlers never
 * mount here. That's intentional: these assert the server-rendered contract
 * (host element, markers, children passthrough), which is exactly what an SSR
 * framework emits before hydration. The live handler behaviour is exercised by
 * the playground in `example/` and the langsys backend testbed.
 */
async function render(component: unknown, props: Record<string, unknown> | null, children: string) {
    const app = createSSRApp({
        render: () => h(component as never, props, { default: () => children }),
    });
    return renderToString(app);
}

describe('DontTranslate', () => {
    it('marks its subtree as never-translated', async () => {
        const html = await render(DontTranslate, null, 'Kangen®');
        expect(html).toContain('translate="no"');
        expect(html).toContain('data-ls-dont-translate');
        expect(html).toContain('Kangen®');
    });

    it('honours a custom tag', async () => {
        const html = await render(DontTranslate, { tag: 'code' }, 'langsys.dev');
        expect(html).toMatch(/^<code/);
    });
});

describe('Phrase', () => {
    it('renders a host carrying the phrase marker around its children', async () => {
        const html = await render(Phrase, { category: 'ProductCard' }, 'Based on {n} reviews');
        expect(html).toContain('data-ls-phrase');
        expect(html).toContain('Based on {n} reviews');
    });

    it('defaults to a span host', async () => {
        const html = await render(Phrase, null, 'x');
        expect(html).toMatch(/^<span/);
    });
});

describe('Translate', () => {
    it('defaults to a <translate> host and passes children through', async () => {
        const html = await render(Translate, { category: 'Home' }, 'Welcome to our site');
        expect(html).toMatch(/^<translate/);
        expect(html).toContain('Welcome to our site');
    });

    it('honours a custom tag and falls class through to the host', async () => {
        const html = await render(Translate, { tag: 'section', class: 'hero' }, 'Hello');
        expect(html).toMatch(/^<section/);
        expect(html).toContain('class="hero"');
    });
});
