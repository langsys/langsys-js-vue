import { afterEach, describe, expect, it } from 'vitest';
import * as Vue from 'vue';
import { compile } from '@vue/compiler-dom';
import { babelParse, compileScript, compileTemplate, parse } from 'vue/compiler-sfc';
import { renderToString } from 'vue/server-renderer';
import { tokenizeTree } from 'langsys-js-typescript';
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { derivePlaceholderNames } from 'langsys-js-typescript/pure';
import { expressionShape, langsysTransform, nameVariables, rewriteTCalls } from './compiler.js';
import { DontTranslate, LangsysApp, Phrase, Translate, useT } from './index.js';
import { createRequestScope } from './server.js';
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
    app.component('DontTranslate', DontTranslate);
    return renderToString(app);
}

/** What a block would register, read off the slot the compiled template hands the component. */
async function registers(template: string, data: Record<string, unknown>, transform = true): Promise<string> {
    let seen = '';
    const Probe = Vue.defineComponent({
        setup(_, { slots }) {
            return () => {
                const converted = slotToBlockNodes(slots.default?.() ?? []);
                seen = !converted.ok
                    ? `(${converted.reason})`
                    : converted.variable
                      ? '(variable)'
                      : converted.excluded
                        ? '(excluded)'
                        : tokenizeTree(converted.nodes).tokens.join(' | ');
                return Vue.h('i');
            };
        },
    });
    const code = compile(template, { mode: 'function', nodeTransforms: transform ? [langsysTransform] : [] }).code;
    const app = Vue.createSSRApp({ render: fn(code), data: () => data });
    app.component('Translate', Probe);
    app.component('Phrase', Phrase);
    app.component('DontTranslate', DontTranslate);
    await renderToString(app);
    return seen;
}

interface NamingCase {
    id: string;
    expressions: Array<{ source: string; shape: unknown; explicit?: string }>;
    names: string[];
}
const VECTORS_RAW = readFileSync(join(process.cwd(), 'test/fixtures/var-naming-vectors.json'));
const NAMING = JSON.parse(VECTORS_RAW.toString('utf8')) as { cases: NamingCase[] };

describe('VAR-2 — the shared naming vectors (var-naming-vectors.json, vendored byte-exact)', () => {
    it('control: the file is the vendored blob and carries cases', () => {
        const blob = createHash('sha1').update(`blob ${VECTORS_RAW.length}\0`).update(VECTORS_RAW).digest('hex');
        expect(blob).toBe('0513e1cb215edd9df2e5b34a04cc3e5d2cfcc034');
        expect(NAMING.cases.length).toBe(32);
    });

    it.each(NAMING.cases.map((c) => [c.id, c] as const))('%s: each source maps onto its shape', (_, c) => {
        for (const e of c.expressions) expect(expressionShape(e.source), e.source).toEqual(e.shape);
    });

    it.each(NAMING.cases.map((c) => [c.id, c] as const))('%s: the names, through this binding', (_, c) => {
        const derived = derivePlaceholderNames(
            c.expressions.map((e) => ({
                shape: expressionShape(e.source),
                ...(e.explicit ? { explicit: e.explicit } : {}),
            }))
        );
        expect(derived).toEqual(c.names);
        if (c.expressions.some((e) => e.explicit)) return; // a template has no per-expression explicit name
        expect(nameVariables(c.expressions.map((e) => e.source)).map((v) => v.name)).toEqual(c.names);
    });
});

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
        [
            ['user.name', 'user.name'],
            ['name', 'name'],
        ],
        [['a + b'], ['value']],
        [
            ['a + b', 'a + b'],
            ['value', 'value_2'],
        ],
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

    it('without the transform, a variable block still renders from the catalog, and a scope records nothing for it', async () => {
        seed({ ...IT, UI: { ...IT.UI, 'Goodbye Ana': 'Arrivederci Ana' } }, 'it');
        const tpl = '<Translate category="UI"><p>Goodbye {{ name }}</p></Translate>';
        expect(await serve(tpl, { name: 'Ana' }, false)).toContain('<p>Arrivederci Ana</p>');
        const recorded = async (transform: boolean) => {
            const scope = await createRequestScope({ locale: 'it', catalog: IT as never });
            await scope.run(() => serve(tpl, { name: 'Bo' }, transform));
            // The seed keeps every rendered block's source for the client's re-render; what the scope
            // would send is its misses.
            return scope.misses().length;
        };
        expect(await recorded(true), 'control: with the transform, Goodbye {name} is recorded').toBeGreaterThan(0);
        expect(await recorded(false)).toBe(0);
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
        expect(await serve(tpl, { items: [1, 2, 3, 4, 5] })).toBe(
            '<span data-ls-phrase data-ls-resolved="it">Hai 5 <b>elementi</b></span>'
        );
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

    it.each([
        ':innerHTML="raw"',
        ':textContent="raw"',
        'innerHTML="<i>Bo</i>"',
        'textContent="Bo"',
        ':text-content.camel="raw"',
    ])(
        'an element that sets innerHTML or textContent (%s) holds raw content as v-html does: the block is left as written, at the top level and inside a nested <Phrase>',
        async (set) => {
            const data = { user: { name: 'Ana' }, raw: '<i>Bo</i>' };
            for (const tpl of [
                `<div><Translate category="UI"><p>Hi {{ user.name }}</p><p><b ${set}></b></p></Translate></div>`,
                `<div><Translate category="UI"><p>Hi {{ user.name }}</p><Phrase category="UI">By <b ${set}></b></Phrase></Translate></div>`,
            ]) {
                const html = await serve(tpl, data);
                expect(html, tpl).toContain('<p>Hi Ana</p>');
                expect(html, tpl).not.toContain('%name%');
            }
        }
    );

    it('control: :inner-html is an attribute, not the property, so the block is rewritten and registers', async () => {
        const tpl =
            '<div><Translate category="UI"><p>Hi {{ user.name }}</p><p><b :inner-html="raw"></b></p></Translate></div>';
        expect(await registers(tpl, { user: { name: 'Ana' }, raw: 'x' })).toBe('Hi {name}');
    });

    it('two unnameable values in one block are two placeholders, each rendering its own value', async () => {
        const data = { a: 1, b: 2, c: 3, d: 4 };
        expect(
            await serve('<div><Translate category="UI"><p>Total {{ a + b }} of {{ c * d }}</p></Translate></div>', data)
        ).toContain('<p>Total 3 of 12</p>');
        expect(
            await serve('<p>{{ t(`Total ${a + b} of ${c * d}`, "UI") }}</p>', data, true, () => ({ t: useT() }))
        ).toBe('<p>Total 3 of 12</p>');
    });

    /**
     * Every value goes to the core's naming in order, never merged by its source text first: a
     * value that names itself is one placeholder wherever it repeats, and an unnameable one is its
     * own placeholder each time, since the core cannot tell `a + b` twice from `i++` twice.
     */
    it('a repeated value: one placeholder when it names itself, its own placeholder each time when it cannot', async () => {
        expect(
            await registers('<Translate category="UI"><p>{{ name }} and {{ name }}</p></Translate>', { name: 'Ana' })
        ).toBe('{name} and {name}');
        expect(
            await registers('<Translate category="UI"><p>{{ a + b }} and {{ a + b }}</p></Translate>', { a: 1, b: 2 })
        ).toBe('{value} and {value_2}');
        expect(rewriteTCalls('t(`${a + b} and ${a + b}`)')).toBe(
            't("{value} and {value_2}", { "value": (a + b), "value_2": (a + b) })'
        );
        expect(rewriteTCalls('t(`${name} and ${name}`)')).toBe('t("{name} and {name}", { "name": (name) })');
        expect(nameVariables(['name', 'a + b', 'name', 'a + b']).map((v) => v.name)).toEqual([
            'name',
            'value',
            'name',
            'value_2',
        ]);
    });

    it('two calls whose callee cannot be spelled are two placeholders, each named from its argument', async () => {
        const data = { n: 1, getA: () => (x: number) => `A${x}`, getB: () => (x: number) => `B${x}` };
        const tpl = '<div><Translate category="UI"><p>{{ getA()(n) }} and {{ getB()(n) }}</p></Translate></div>';
        expect(await registers(tpl, data)).toBe('{n} and {n_2}');
        expect(await serve(tpl, data)).toContain('<p>A1 and B1</p>');
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

describe('TOK-1 — a value inside an excluded element is marked, never a placeholder', () => {
    const user = { user: { name: 'Ana', email: 'ana@b.c' } };
    const EXCLUSIONS = {
        'translate="no"': '<span translate="no">{{ user.email }}</span>',
        'data-notrans': '<span data-notrans>{{ user.email }}</span>',
        '<DontTranslate>': '<DontTranslate>{{ user.email }}</DontTranslate>',
    };

    for (const [label, child] of Object.entries(EXCLUSIONS)) {
        it(`${label}: the value is served inside a value marker, and the block registers its text around it`, async () => {
            const tpl = `<div><Translate category="UI"><p>Hi {{ user.name }}, signed in as ${child} today</p></Translate></div>`;
            const html = await serve(tpl, user);
            expect(html).toContain('<span data-ls-param="email">ana@b.c</span>');
            expect(html).toContain('<p>Hi Ana, signed in as <span');
            expect(html).not.toContain('%email%');
            expect(await registers(tpl, user)).toBe('Hi {name}, signed in as | today');
            // Control: without the transform the value is unmarked, so the block registers nothing.
            expect(await registers(tpl, user, false)).toBe('(variable)');
        });
    }

    it('an excluded value never changes the sentence’s own names', async () => {
        const tpl =
            '<div><Translate category="UI"><p>Hi {{ name }}, or <span translate="no">{{ name }}</span> here</p></Translate></div>';
        const html = await serve(tpl, { name: 'Ana' });
        expect(html).toContain(
            '<p>Hi Ana, or <span translate="no"><span data-ls-param="name_2">Ana</span></span> here</p>'
        );
        expect(await registers(tpl, { name: 'Ana' })).toBe('Hi {name}, or | here');
    });

    it('code and notation keep a printed value as written, and a block holding one registers nothing', async () => {
        const tpl = '<div><Translate category="UI"><p>Area <math><mi>{{ x }}</mi></math> units</p></Translate></div>';
        const html = await serve(tpl, { x: 'r' });
        expect(html).toContain('<math><mi>r</mi></math>');
        expect(html).not.toContain('data-ls-param');
        expect(await registers(tpl, { x: 'r' })).toBe('(excluded)');
    });

    it('inside SVG, which cannot hold the marker, a value is left as written and the block registers nothing', async () => {
        const tpl =
            '<div><Translate category="UI"><p>Count <DontTranslate><svg><text>{{ count }}</text></svg></DontTranslate> items</p></Translate></div>';
        const html = await serve(tpl, { count: 3 });
        expect(html).toContain('<svg><text>3</text></svg>');
        expect(html).not.toContain('data-ls-param');
        expect(await registers(tpl, { count: 3 })).toBe('(excluded)');
    });

    it.each([
        [
            'a <textarea>',
            '<textarea translate="no">{{ draft }}</textarea>',
            '<textarea translate="no">hello</textarea>',
        ],
        ['an <option>', '<select translate="no"><option>{{ draft }}</option></select>', '<option>hello</option>'],
        ['a <title>', '<DontTranslate><title>{{ draft }}</title></DontTranslate>', '<title>hello</title>'],
    ])(
        'inside %s, which holds text only, a value is left as written and the block registers nothing',
        async (_, inner, out) => {
            const tpl = `<div><Translate category="UI"><p>Note ${inner} here</p></Translate></div>`;
            const html = await serve(tpl, { draft: 'hello' });
            expect(html).toContain(out);
            expect(html).not.toContain('data-ls-param');
            expect(await registers(tpl, { draft: 'hello' })).toBe('(excluded)');
        }
    );

    it('a bound translate is decided when the page renders: the value is left as written, and read as excluded', async () => {
        const tpl =
            '<div><Translate category="UI"><p>Signed in as <span :translate="mode">{{ user.email }}</span> today</p></Translate></div>';
        const html = await serve(tpl, { ...user, mode: 'no' });
        expect(html).toContain('<span translate="no">ana@b.c</span>');
        expect(html).not.toContain('%email%');
        expect(await registers(tpl, { ...user, mode: 'no' })).toBe('(excluded)');
        // Control: bound to anything else, the value is a variable, and nothing registers either.
        expect(await registers(tpl, { ...user, mode: 'yes' })).toBe('(variable)');
    });

    it.each([
        ['an object bound with v-bind', '<span v-bind="attrs">', { attrs: { translate: 'no' } }],
        ['a dynamic argument', '<span :[name]="mode">', { name: 'translate', mode: 'no' }],
    ])('%s can bind the exclusion too: the value is left as written', async (_, open, bind) => {
        const tpl = `<div><Translate category="UI"><p>Signed in as ${open}{{ user.email }}</span> today</p></Translate></div>`;
        const html = await serve(tpl, { ...user, ...bind });
        expect(html).toContain('<span translate="no">ana@b.c</span>');
        expect(html).not.toContain('%email%');
        expect(await registers(tpl, { ...user, ...bind })).toBe('(excluded)');
    });

    it('compiler-sfc with ssr: true, a server build: the value is marked in the branch <Translate> reads', () => {
        const out = compileTemplate({
            source: '<div><Translate category="UI"><p>Signed in as <span translate="no">{{ user.email }}</span></p></Translate></div>',
            filename: 'A.vue',
            id: 'a',
            ssr: true,
            compilerOptions: { nodeTransforms: [langsysTransform] },
        });
        expect(out.errors).toEqual([]);
        expect(out.code).toContain('data-ls-param');
        expect(out.code).not.toContain('%email%');
    });
});

describe('MARK-4 — a <Phrase> nested in a <Translate>', () => {
    const data = { user: { name: 'Ana' }, owner: { name: 'Bo' } };
    const tpl =
        '<div><Translate category="UI"><p>Hi {{ user.name }}</p><p>Welcome back</p><Phrase category="UI">By {{ owner.name }}</Phrase></Translate></div>';

    it('each host is rewritten in its own name space: the block registers its own text, and both values render', async () => {
        expect(await registers(tpl, data)).toBe('Hi {name} | Welcome back');
        const html = await serve(tpl, data);
        expect(html).toContain('<p>Hi Ana</p><p>Welcome back</p>');
        expect(html).toContain('>By Bo</span>');
    });

    it('what blocks the nested <Phrase> holds the block’s rewrite too: the block falls back with its values in place', async () => {
        const blocked =
            '<div><Translate category="UI"><p>Hi {{ user.name }}</p><p>Welcome back</p><Phrase category="UI">By <b v-html="raw"></b></Phrase></Translate></div>';
        const html = await serve(blocked, { ...data, raw: '<i>Bo</i>' });
        expect(html).toContain('<p>Hi Ana</p>');
        expect(html).not.toContain('%name%');
        // Control: unblocked, the same block is rewritten.
        expect(await registers(tpl, data)).toBe('Hi {name} | Welcome back');
    });

    it.each([
        ['<b v-if="show">Bo</b>'],
        ['<b v-if="show">Bo</b><i v-else>Cy</i>'],
        ['<b v-for="t in tags" :key="t">tag</b>'],
    ])(
        'a conditional or a list inside the nested <Phrase> is the phrase’s to render: the block is still rewritten (%s)',
        async (inner) => {
            const t = `<div><Translate category="UI"><p>Hi {{ user.name }}</p><p>Welcome back</p><Phrase category="UI">By ${inner}</Phrase></Translate></div>`;
            expect(await registers(t, { ...data, show: true, tags: ['a'] })).toBe('Hi {name} | Welcome back');
        }
    );

    it('control: without the transform the values stay compiled, and the block registers nothing', async () => {
        expect(await registers(tpl, data, false)).toBe('(variable)');
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
        expect(rewriteTCalls('t(`Hi ${name}`, { z: 1 })')).toBe(
            't("Hi {name}", { ...{ "name": (name) }, ...({ z: 1 }) })'
        );
    });

    it('leaves plain strings and other functions alone', () => {
        expect(rewriteTCalls('t("plain")')).toBe('t("plain")');
        expect(rewriteTCalls('at(`${x}`)')).toBe('at(`${x}`)');
    });

    it('in <script setup> with an inlined template — a production build, client and server — the rewrite compiles', () => {
        const { descriptor } = parse(
            '<script setup lang="ts">\nconst user = { firstName: "Ana" };\nconst category = "UI";\nconst t = (p: string, c?: string, v?: object) => p;\n</script>\n' +
                "<template><h2>{{ t(`Welcome back, ${user.firstName}`, 'UI') }}</h2><p>{{ t(`Bye, ${user.firstName}`, category) }}</p></template>"
        );
        for (const ssr of [false, true]) {
            const out = compileScript(descriptor, {
                id: 'x',
                inlineTemplate: true,
                templateOptions: { ssr, compilerOptions: { nodeTransforms: [langsysTransform] } },
            });
            expect(
                () => babelParse(out.content, { sourceType: 'module', plugins: ['typescript'] }),
                `ssr: ${ssr}`
            ).not.toThrow();
            expect(out.content, `ssr: ${ssr}`).toContain('"Welcome back, {first_name}", \'UI\', { "first_name": (');
            // The arguments of the call that reads the category at run time are its own, never `_ctx`'s.
            expect(out.content, `ssr: ${ssr}`).toContain(
                `"Bye, {first_name}", ...((p, a) => (typeof a === 'object' ? [{ ...p, ...a }] : [a, p]))({ "first_name": (`
            );
        }
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

    /**
     * A second argument the template names through a variable can be either: the core reads a
     * string there as the category and an object as params, and so does the rewritten call.
     */
    it('a category held in a variable stays the category, and a params object keeps the derived params', async () => {
        seed(IT, 'it');
        const html = await serve(
            '<div><h1>{{ t(`Hello ${user.name}`, category) }}</h1><p>{{ t(`Hello ${user.name}`, extra) }}</p></div>',
            { user: { name: 'Ana' }, category: 'UI', extra: { unused: 1 } },
            true,
            () => ({ t: useT() })
        );
        expect(html).toBe('<div><h1>Ciao Ana</h1><p>Hello Ana</p></div>');
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
