import { afterEach, describe, expect, it } from 'vitest';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { compileTemplate } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { tokenizeTree } from 'langsys-js-typescript';
import { langsysTransform, nameVariables, rewriteTCalls } from './compiler.js';
import { LangsysApp, Phrase, Translate, useT } from './index.js';
import { slotToBlockNodes } from './block-vnodes.js';

/**
 * VAR-2 and VAR-6: the build-time transform, `langsys-js-vue/compiler`.
 *
 * Templates are compiled for real — `@vue/compiler-dom`, `compiler-sfc` as `@vitejs/plugin-vue`
 * calls it, `compiler-sfc` with `ssr: true` as a Vite or Nuxt server build does, and Vue's runtime
 * compiler — and rendered with `vue/server-renderer` against a seeded catalog.
 */

const seed = (catalog: object, locale: string) =>
    (LangsysApp as unknown as { seedCatalog(c: object, l: string): void }).seedCatalog(catalog, locale);

const IT = {
    __uncategorized__: {},
    UI: {
        'Hello {name}': 'Ciao {name}',
        'You have {count} items': '{count, plural, one {Hai # elemento} other {Hai # elementi}}',
        'You have {items_count} {m0o}items{m0c}':
            '{items_count, plural, one {Hai # {m0o}elemento{m0c}} other {Hai # {m0o}elementi{m0c}}}',
    },
};

afterEach(() => seed({ __uncategorized__: {} }, 'en'));

const fn = (code: string) => new Function('Vue', code)(Vue) as Vue.RenderFunction;

/** Compile `template` in function mode, optionally with the transform, and serve it. */
async function serve(template: string, data: Record<string, unknown>, transform = true, setup?: () => object) {
    const code = compile(template, { mode: 'function', nodeTransforms: transform ? [langsysTransform] : [] }).code;
    const app = Vue.createSSRApp({ render: fn(code), data: () => data, setup });
    app.component('Translate', Translate);
    app.component('Phrase', Phrase);
    return renderToString(app);
}

/** What a block would register, read off the slot the compiled template hands the component. */
async function registers(template: string, data: Record<string, unknown>, transform = true): Promise<string> {
    let seen = '';
    const Probe = Vue.defineComponent({
        setup(_, { slots }) {
            return () => {
                const converted = slotToBlockNodes(slots.default?.() ?? []);
                seen = converted.ok ? tokenizeTree(converted.nodes).tokens.join(' | ') : `(${converted.reason})`;
                return Vue.h('i');
            };
        },
    });
    const code = compile(template, { mode: 'function', nodeTransforms: transform ? [langsysTransform] : [] }).code;
    const app = Vue.createSSRApp({ render: fn(code), data: () => data });
    app.component('Translate', Probe);
    await renderToString(app);
    return seen;
}

describe('VAR-2 — placeholder names come from the source expression', () => {
    it.each([
        [['firstName'], ['first_name']],
        [['userID'], ['user_id']],
        [['user.name'], ['name']],
        [['user?.name'], ['name']],
        [['$route.params.id'], ['id']],
        [['items.length'], ['items_count']],
        [['cart.items.size'], ['items_count']],
        [['order.count'], ['order_count']],
        [['price.value'], ['price']],
        [['counterRef.current'], ['counter_ref']],
        [['formatDate(order.date)'], ['date']],
        [
            ['a.name', 'b.name'],
            ['a_name', 'b_name'],
        ],
        [
            ['name', 'user.name', 'other.name'],
            ['name', 'user_name', 'other_name'],
        ],
        [['user.name', 'user.name'], ['name']],
        [['a + b'], ['value']],
        [
            ['x ? y : z', '`${a}`', 'list[0]', 'fmt(a, b)'],
            ['value', 'value_2', 'value_3', 'value_4'],
        ],
        [['m0o'], ['m0o_2']],
    ])('%j → %j', (expressions, names) => {
        expect(nameVariables(expressions).map((v) => v.name)).toEqual(names);
    });

    it('a name the developer already wrote explicitly is avoided', () => {
        expect(nameVariables(['name'], ['name']).map((v) => v.name)).toEqual(['name_2']);
    });

    it('every derived name is ICU-safe', () => {
        const all = nameVariables(['firstName', 'a.b.c', 'items.length', 'x + 1', '$route.params.id']);
        for (const v of all) expect(v.name).toMatch(/^[a-z][a-z0-9_]*$/);
    });
});

describe('VAR-6 — interpolations inside <Translate> and <Phrase> become placeholders', () => {
    it('without the transform, the compiled value marks the block a variable (VAR-7): nothing to register', async () => {
        const tpl = '<Translate category="UI"><p>Hello {{ name }}</p></Translate>';
        expect(await registers(tpl, { name: 'Ana' }, false)).toBe('(variable)');
    });

    it('a translatable attribute bound to a value marks the block a variable too; a bound class does not', async () => {
        expect(
            await registers('<Translate category="UI"><img :alt="who" src="a.png"></Translate>', { who: 'Ana' }, false)
        ).toBe('(variable)');
        expect(
            await registers('<Translate category="UI"><p :class="c">Static</p></Translate>', { c: 'x' }, false)
        ).toBe('Static');
    });

    it('with it, two users register the one phrase, carrying the placeholder', async () => {
        const tpl = '<Translate category="UI"><p>Hello {{ user.firstName }}</p></Translate>';
        expect(await registers(tpl, { user: { firstName: 'Ana' } })).toBe('Hello {first_name}');
        expect(await registers(tpl, { user: { firstName: 'Bo' } })).toBe('Hello {first_name}');
    });

    it('the translation renders, a count selecting its plural branch', async () => {
        seed(IT, 'it');
        const tpl = '<Translate category="UI"><p>You have {{ count }} items</p></Translate>';
        expect(await serve(tpl, { count: 1 })).toContain('<p>Hai 1 elemento</p>');
        expect(await serve(tpl, { count: 5 })).toContain('<p>Hai 5 elementi</p>');
    });

    it('in <Phrase>, the markup is kept and moves with the translation', async () => {
        seed(IT, 'it');
        const tpl = '<Phrase category="UI">You have {{ items.length }} <b>items</b></Phrase>';
        expect(await serve(tpl, { items: [1, 2, 3, 4, 5] })).toBe('<span data-ls-phrase>Hai 5 <b>elementi</b></span>');
    });

    it("a developer's own :params win over a derived one of the same name", async () => {
        seed(IT, 'it');
        const tpl = '<Translate category="UI" :params="{ name: \'Explicit\' }"><p>Hello {{ name }}</p></Translate>';
        expect(await serve(tpl, { name: 'Ana' })).toContain('<p>Ciao Explicit</p>');
    });

    it('content it cannot rewrite is left as written', async () => {
        for (const tpl of [
            '<Translate><p v-if="on">Hello {{ name }}</p></Translate>',
            '<Translate><li v-for="n in list">{{ n }}</li></Translate>',
            '<Translate><p v-html="raw"></p></Translate>',
        ]) {
            const out = compile(tpl, { mode: 'function', nodeTransforms: [langsysTransform] }).code;
            expect(out, tpl).not.toContain('params');
        }
    });

    it('an unnameable expression is named value, with a build-time warning', () => {
        const warnings: string[] = [];
        compile('<Translate><p>Total {{ a + b }}</p></Translate>', {
            mode: 'function',
            nodeTransforms: [langsysTransform],
            onWarn: (w) => void warnings.push(w.message),
        });
        expect(warnings).toEqual([expect.stringContaining('registered as {value}')]);
    });
});

describe('VAR-6 — t() calls in templates', () => {
    it('rewrites a template-literal phrase into placeholders and params, keeping the other arguments', () => {
        expect(rewriteTCalls('t(`Hello ${user.name}`)')).toBe('t("Hello {name}", { "name": (user.name) })');
        expect(rewriteTCalls('t(`You have ${items.length} items`, "Cart")')).toBe(
            't("You have {items_count} items", "Cart", { "items_count": (items.length) })'
        );
        expect(rewriteTCalls('t(`Hi ${name}`, "UI", { z: 1 })')).toBe(
            't("Hi {name}", "UI", { ...{ "name": (name) }, ...({ z: 1 }) })'
        );
    });

    it('leaves plain strings and other functions alone', () => {
        expect(rewriteTCalls('t("plain")')).toBe('t("plain")');
        expect(rewriteTCalls('at(`${x}`)')).toBe('at(`${x}`)');
    });

    it('a template t() renders the translation of the placeholder phrase', async () => {
        seed(IT, 'it');
        const html = await serve(
            '<h1>{{ t(`Hello ${user.name}`, "UI") }}</h1>',
            { user: { name: 'Ana' } },
            true,
            () => ({
                t: useT(),
            })
        );
        expect(html).toBe('<h1>Ciao Ana</h1>');
    });
});

describe('VAR-6 — every way a Vue template is compiled', () => {
    const tpl = '<div><Translate category="UI"><p>You have {{ count }} items</p></Translate></div>';

    it('compiler-sfc, as @vitejs/plugin-vue calls it with template.compilerOptions', async () => {
        seed(IT, 'it');
        const out = compileTemplate({
            source: tpl,
            filename: 'A.vue',
            id: 'a',
            compilerOptions: { mode: 'function', nodeTransforms: [langsysTransform] },
        });
        expect(out.errors).toEqual([]);
        const app = Vue.createSSRApp({ render: fn(out.code), data: () => ({ count: 5 }) });
        app.component('Translate', Translate);
        expect(await renderToString(app)).toContain('<p>Hai 5 elementi</p>');
    });

    it('compiler-sfc with ssr: true, a server build: the slot branch <Translate> reads carries the placeholder', () => {
        const out = compileTemplate({
            source: tpl,
            filename: 'A.vue',
            id: 'a',
            ssr: true,
            compilerOptions: { nodeTransforms: [langsysTransform] },
        });
        expect(out.errors).toEqual([]);
        expect(out.code).toContain('%count%');
        expect(out.code).not.toMatch(/toDisplayString\(_ctx\.count\)/);
    });

    it("Vue's runtime compiler, through app.config.compilerOptions, which also compiles for the server", async () => {
        seed(IT, 'it');
        const app = Vue.createSSRApp({ template: tpl, data: () => ({ count: 5 }) });
        (app.config.compilerOptions as Record<string, unknown>).nodeTransforms = [langsysTransform];
        app.component('Translate', Translate);
        expect(await renderToString(app)).toContain('<p>Hai 5 elementi</p>');
    });
});
