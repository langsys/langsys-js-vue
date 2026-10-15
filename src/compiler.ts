/**
 * `langsys-js-vue/compiler` — the build-time transform that keeps variables out of registered
 * text (VAR-1, VAR-6).
 *
 * In a compiled template, `<Translate><p>Hello {{ name }}</p></Translate>` reaches the component
 * as the text `Hello Ana`, so the value would be registered as part of the phrase — one phrase per
 * user. This transform rewrites the template before Vue compiles it: each interpolation inside
 * `<Translate>` and `<Phrase>` becomes a `%name%` placeholder and its expression a param, and each
 * `t()` call whose phrase is a template literal gets a `{name}` phrase and a params object. The
 * phrase registered is then `Hello {name}` for every user, which langsys can also promote to a
 * plural or gendered form.
 *
 * Enable it with one line — Vite:
 *
 *     vue({ template: { compilerOptions: { nodeTransforms: [langsysTransform] } } })
 *
 * Nuxt:
 *
 *     vue: { compilerOptions: { nodeTransforms: [langsysTransform] } }
 *
 * It runs on the template root, before Vue's own per-element transforms: Vue's server compiler
 * copies a component's slot children when it reaches the component, so a rewrite applied any later
 * would miss the copy `<Translate>` renders on the server. Content it cannot rewrite — a `v-if`,
 * `v-for`, `v-html`, a component or a `<slot>` inside the block — is left as written; the runtime
 * then registers nothing for it (VAR-7).
 *
 * Build-time only: this module never reaches a browser bundle. Placeholder names are the core's
 * (`derivePlaceholderNames()` from `langsys-js-typescript/pure`), so every SDK names a value alike.
 */

import { isTranslationExcluded } from 'langsys-js-typescript';
import {
    derivePlaceholderNames,
    NON_TRANSLATABLE_ELEMENTS,
    VAR_PARAM_ATTR,
    type ExpressionShape,
    type NamedExpression,
} from 'langsys-js-typescript/pure';

/** The compiler's node types this transform reads (`@vue/compiler-core` `NodeTypes`). */
const ROOT = 0;
const ELEMENT = 1;
const TEXT = 2;
const SIMPLE_EXPRESSION = 4;
const INTERPOLATION = 5;
const ATTRIBUTE = 6;
const DIRECTIVE = 7;
/** Element tag types (`@vue/compiler-core` `ElementTypes`). */
const PLAIN_ELEMENT = 0;
const COMPONENT = 1;

const HOSTS = new Set(['Translate', 'Phrase']);
/** `<DontTranslate>` renders a `translate="no"` element around its slot; the transform reads it as one. */
const DONT_TRANSLATE = new Set(['DontTranslate', 'dont-translate']);
const BLOCKING_DIRECTIVES = new Set(['if', 'else', 'else-if', 'for', 'html', 'text', 'slot']);
const IDENT = '[A-Za-z_$][\\w$]*';

// ---------------------------------------------------------------------------------------------
// VAR-2 naming: this binding maps a template expression onto the core's shape; the core names it
// ---------------------------------------------------------------------------------------------

/** Split `a` at top-level commas; null when brackets do not balance. */
function topLevelArgs(src: string): string[] | null {
    const args: string[] = [];
    let depth = 0;
    let quote: string | null = null;
    let start = 0;
    for (let i = 0; i < src.length; i++) {
        const c = src[i]!;
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) depth--;
        else if (c === ',' && depth === 0) {
            args.push(src.slice(start, i));
            start = i + 1;
        }
        if (depth < 0) return null;
    }
    if (depth !== 0 || quote) return null;
    args.push(src.slice(start));
    return args.map((a) => a.trim());
}

/** The call `expr` ends in, `callee(args)`, split at the parenthesis that opens it; null when it ends in none. */
function finalCall(expr: string): { callee: string; args: string } | null {
    if (!expr.endsWith(')')) return null;
    let depth = 0;
    let quote: string | null = null;
    let open = -1;
    for (let i = 0; i < expr.length; i++) {
        const c = expr[i]!;
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if ('([{'.includes(c)) {
            if (depth === 0 && c === '(') open = i;
            depth++;
        } else if (')]}'.includes(c) && --depth < 0) return null;
    }
    if (depth !== 0 || quote || open <= 0) return null;
    return { callee: expr.slice(0, open).trim(), args: expr.slice(open + 1, -1) };
}

/** Whether `callee` is a name followed only by member accesses, computed members and calls: `getA()`, `fmt[a]`. */
function isPostfix(callee: string): boolean {
    let skeleton = '';
    let depth = 0;
    for (const c of callee) {
        if ('([{'.includes(c)) {
            if (depth === 0) skeleton += c;
            depth++;
        } else if (')]}'.includes(c)) {
            depth--;
            if (depth === 0) skeleton += c;
        } else if (depth === 0) skeleton += c;
    }
    return new RegExp(`^${IDENT}(?:\\s*\\??\\.\\s*${IDENT}|\\s*(?:\\?\\.)?\\s*(?:\\(\\)|\\[\\]))*$`).test(skeleton);
}

/**
 * A template expression as the shape the core names (`ExpressionShape`): an identifier, a member
 * chain (optional chaining read as plain), a call with its arguments, or anything else.
 */
export function expressionShape(expression: string): ExpressionShape {
    const expr = expression.trim();
    const chain = new RegExp(`^${IDENT}(?:\\s*\\??\\.\\s*${IDENT})*$`);
    if (chain.test(expr)) {
        const segments = expr.split(/\s*\??\.\s*/);
        return segments.length === 1 ? { identifier: segments[0]! } : { member: segments };
    }
    const call = finalCall(expr);
    if (call) {
        const args = topLevelArgs(call.args);
        // A callee spelled as a dotted name is the call's identity; one that cannot be spelled — a
        // call's result, a computed member — is given as '', and names nothing by itself.
        const spelled = chain.test(call.callee);
        if (args && (spelled || isPostfix(call.callee)))
            return {
                call: {
                    callee: spelled ? call.callee.replace(/\s+/g, '') : '',
                    args: args.filter(Boolean).map(expressionShape),
                },
            };
    }
    if (expr.startsWith('`')) return { other: 'template' };
    if (/\?[^.?]*:/.test(expr)) return { other: 'conditional' };
    if (/\[/.test(expr)) return { other: 'computed' };
    return { other: 'binary' };
}

export interface NamedVariable {
    expression: string;
    name: string;
    /** True when no name could be derived and `value` was used (a build-time warning). */
    unnamed: boolean;
}

/**
 * Name the variables of one phrase, per VAR-2, with the core's `derivePlaceholderNames()`: one
 * entry per expression, in order. Every expression goes to the core, never merged by its source
 * text first: a value that names itself is one placeholder wherever it repeats, and an unnameable
 * one is its own placeholder each time, since its source cannot say whether it would evaluate
 * alike twice. Names already `taken` (a developer's explicit `%name%`) are avoided.
 */
export function nameVariables(expressions: readonly string[], taken: Iterable<string> = []): NamedVariable[] {
    const sources = expressions.map((e) => e.trim());
    const explicit: NamedExpression[] = [...taken].map((name) => ({ shape: { other: 'explicit' }, explicit: name }));
    const shapes = sources.map(expressionShape);
    const names = derivePlaceholderNames([...explicit, ...shapes.map((shape) => ({ shape }))]).slice(explicit.length);
    return sources.map((expression, i) => {
        const shape = shapes[i]!;
        const alone = derivePlaceholderNames([{ shape }])[0];
        return {
            expression,
            name: names[i]!,
            unnamed: alone === 'value' && !('identifier' in shape && shape.identifier === 'value'),
        };
    });
}

/** The params object's entries for `variables`: one per placeholder, from the first expression it names. */
function paramEntries(variables: readonly NamedVariable[]): string[] {
    const named = new Set<string>();
    return variables
        .filter((v) => !named.has(v.name) && named.add(v.name))
        .map((v) => `${JSON.stringify(v.name)}: (${v.expression})`);
}

// ---------------------------------------------------------------------------------------------
// The template rewrite
// ---------------------------------------------------------------------------------------------

/** The slice of Vue's compiler AST this transform touches, typed loosely to stay dependency-free. */
interface AstNode {
    type: number;
    tag?: string;
    tagType?: number;
    ns?: number;
    content?: unknown;
    children?: AstNode[];
    props?: AstNode[];
    name?: string;
    arg?: AstNode & { content?: string };
    exp?: AstNode & { content?: string };
    value?: AstNode;
    loc?: unknown;
    ast?: unknown;
}

interface TransformContext {
    onWarn?: (warning: { message: string; loc?: unknown }) => void;
}

const expression = (content: string, isStatic: boolean, loc: unknown): AstNode =>
    ({ type: SIMPLE_EXPRESSION, content, isStatic, constType: isStatic ? 3 : 0, loc }) as AstNode;

function blockedBy(children: AstNode[] = []): string | null {
    for (const c of children) {
        if (c.type !== ELEMENT) continue;
        if (c.tag === 'slot') return 'slot';
        if (c.tagType === COMPONENT && !DONT_TRANSLATE.has(c.tag ?? '')) return 'component';
        const d = c.props?.find((p) => p.type === DIRECTIVE && BLOCKING_DIRECTIVES.has(p.name ?? ''));
        if (d) return `v-${d.name}`;
        const inner = blockedBy(c.children);
        if (inner) return inner;
    }
    return null;
}

/**
 * How an element bounds the sentence (TOK-1): an author's exclusion — `translate="no"` or
 * `data-notrans`, read by the core's own predicate, or `<DontTranslate>` — or code and notation.
 * Neither enters the phrase. A value printed inside an author's exclusion is marked (VAR-3) so a
 * block stores its name, not the value; inside code, foreign content, or an element whose exclusion
 * is bound at run time, it is left as written.
 */
type Within = 'author' | 'code' | null;

function within(outer: Within, node: AstNode): Within {
    if (outer === 'code') return 'code';
    const bound = boundBy(outer, node);
    // Foreign content (SVG, MathML) cannot hold the marker's <span>: a value there is left as written.
    return bound === 'author' && node.ns ? 'code' : bound;
}

function boundBy(outer: Within, node: AstNode): Within {
    if (DONT_TRANSLATE.has(node.tag ?? '')) return 'author';
    if (node.tagType !== PLAIN_ELEMENT) return outer;
    if (NON_TRANSLATABLE_ELEMENTS.includes((node.tag ?? '').toLowerCase())) return 'code';
    // A bound translate or data-notrans is known only when the page renders: its values are left as
    // written, for the runtime to read as excluded or as variables.
    const bindsExclusion = node.props?.some(
        (p) => p.type === DIRECTIVE && p.name === 'bind' && ['translate', 'data-notrans'].includes(p.arg?.content ?? '')
    );
    if (bindsExclusion) return 'code';
    const attr = (name: string) => node.props?.find((p) => p.type === ATTRIBUTE && p.name === name);
    const excluded = isTranslationExcluded({
        tagName: node.tag ?? '',
        getAttribute: (name) => (attr(name) ? String(attr(name)!.value?.content ?? '') : null),
        hasAttribute: (name) => attr(name) !== undefined,
    });
    return excluded ? 'author' : outer;
}

/** `<span data-ls-param="NAME">{{ value }}</span>`: VAR-3's attribute form around a printed value. */
const marker = (name: string, value: AstNode): AstNode =>
    ({
        type: ELEMENT,
        ns: 0,
        tag: 'span',
        tagType: PLAIN_ELEMENT,
        props: [
            {
                type: ATTRIBUTE,
                name: VAR_PARAM_ATTR,
                nameLoc: value.loc,
                value: { type: TEXT, content: name, loc: value.loc },
                loc: value.loc,
            },
        ],
        children: [value],
        isSelfClosing: false,
        codegenNode: undefined,
        loc: value.loc,
    }) as unknown as AstNode;

function warnUnnamed(context: TransformContext | undefined, variables: NamedVariable[], loc: unknown): void {
    for (const v of variables.filter((x) => x.unnamed)) {
        context?.onWarn?.({
            message: `[langsys] No placeholder name can be read from \`${v.expression}\`; it is registered as {${v.name}}. Name it explicitly with %name% and :params.`,
            loc,
        });
    }
}

function rewriteHost(host: AstNode, context: TransformContext | undefined): void {
    if (blockedBy(host.children)) return;

    // The sentence's values, and the values printed inside an author's exclusion.
    const interpolations: string[] = [];
    const excluded: string[] = [];
    const explicit = new Set<string>();
    const collect = (children: AstNode[] = [], bound: Within = null) => {
        for (const c of children) {
            if (c.type === INTERPOLATION) {
                const source = String((c.content as AstNode).content ?? '');
                if (bound === null) interpolations.push(source);
                else if (bound === 'author') excluded.push(source);
            } else if (c.type === TEXT)
                for (const m of String(c.content).matchAll(/%([a-z][a-z0-9_]*)%/g)) explicit.add(m[1]!);
            else if (c.type === ELEMENT) collect(c.children, within(bound, c));
        }
    };
    collect(host.children);
    if (!interpolations.length && !excluded.length) return;

    const variables = nameVariables(interpolations, explicit);
    // Excluded values are no part of the sentence, so they never change its names.
    const marked = nameVariables(excluded, [...explicit, ...variables.map((v) => v.name)]);
    warnUnnamed(context, [...variables, ...marked], host.loc);

    // The same walk as `collect`, so the k-th interpolation of each kind takes the k-th name.
    let k = 0;
    let e = 0;
    const rewrite = (children: AstNode[] = [], bound: Within = null): AstNode[] =>
        children.map((c) => {
            if (c.type === INTERPOLATION) {
                if (bound === null) return { type: TEXT, content: `%${variables[k++]!.name}%`, loc: c.loc } as AstNode;
                return bound === 'author' ? marker(marked[e++]!.name, c) : c;
            }
            if (c.type === ELEMENT) c.children = rewrite(c.children, within(bound, c));
            return c;
        });
    host.children = rewrite(host.children);
    if (!variables.length) return;

    const props = host.props ?? [];
    const existing = props.find((p) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === 'params');
    const entries = paramEntries(variables);
    // A developer's own params come last, so an explicit name always wins.
    if (existing?.exp?.content) entries.push(`...(${existing.exp.content})`);
    host.props = props.filter((p) => p !== existing);
    host.props.push({
        type: DIRECTIVE,
        name: 'bind',
        rawName: ':params',
        arg: expression('params', true, host.loc),
        exp: expression(`{ ${entries.join(', ')} }`, false, host.loc),
        modifiers: [],
        loc: host.loc,
    } as AstNode);
}

/**
 * Rewrite `t(\`…${x}…\`, …)` inside one template expression into `t('…{name}…', …, { name: x })`.
 * Returns the expression unchanged when it holds no such call, or one it cannot parse.
 */
export function rewriteTCalls(source: string, onUnnamed?: (variables: NamedVariable[]) => void): string {
    const call = /(^|[^\w$.])t\s*\(\s*`/g;
    let out = '';
    let cursor = 0;
    for (let m = call.exec(source); m; m = call.exec(source)) {
        const tick = m.index + m[0].length - 1;
        // The template literal: text and ${…} expressions, no nested template literals.
        const parts: string[] = [];
        const exprs: string[] = [];
        let text = '';
        let i = tick + 1;
        let ok = true;
        for (; i < source.length; i++) {
            const c = source[i]!;
            if (c === '\\') {
                text += source[i + 1] ?? '';
                i++;
            } else if (c === '`') break;
            else if (c === '$' && source[i + 1] === '{') {
                let depth = 1;
                let j = i + 2;
                for (; j < source.length && depth; j++) {
                    if (source[j] === '`') ok = false;
                    if (source[j] === '{') depth++;
                    if (source[j] === '}') depth--;
                }
                parts.push(text);
                text = '';
                exprs.push(source.slice(i + 2, j - 1));
                i = j - 1;
            } else text += c;
        }
        parts.push(text);
        if (!ok || i >= source.length || !exprs.length) continue;
        // The rest of the call: its other arguments, up to the matching ')'.
        const rest = topLevelArgs(source.slice(i + 1, matchingParen(source, i + 1)));
        const close = matchingParen(source, i + 1);
        if (close < 0 || !rest) continue;
        const others = rest.filter((a, k) => !(k === 0 && a === ''));
        const variables = nameVariables(exprs);
        onUnnamed?.(variables.filter((v) => v.unnamed));
        const phrase = parts.map((p, k) => p + (k < exprs.length ? `{${variables[k]!.name}}` : '')).join('');
        const params = `{ ${paramEntries(variables).join(', ')} }`;
        let args: string;
        if (others.length === 0) args = `${JSON.stringify(phrase)}, ${params}`;
        else if (others.length === 1 && /^(['"]).*\1$/s.test(others[0]!))
            args = `${JSON.stringify(phrase)}, ${others[0]}, ${params}`;
        else if (others.length === 1 && /^\{[^]*\}$/.test(others[0]!))
            args = `${JSON.stringify(phrase)}, { ...${params}, ...(${others[0]}) }`;
        // Anything else is read when the call runs, as the core reads it: a string is the
        // category, an object is params.
        else if (others.length === 1)
            args = `${JSON.stringify(phrase)}, ...((p, a) => (typeof a === 'object' ? [{ ...p, ...a }] : [a, p]))(${params}, ${others[0]})`;
        else args = `${JSON.stringify(phrase)}, ${others[0]}, { ...${params}, ...(${others[1]}) }`;
        out += source.slice(cursor, m.index) + m[1] + `t(${args})`;
        cursor = close + 1;
        call.lastIndex = cursor;
    }
    return out + source.slice(cursor);
}

/** Index of the ')' closing the call whose arguments start at `from` (just after the literal), or -1. */
function matchingParen(source: string, from: number): number {
    let depth = 0;
    let quote: string | null = null;
    for (let i = from; i < source.length; i++) {
        const c = source[i]!;
        if (quote) {
            if (c === '\\') i++;
            else if (c === quote) quote = null;
            continue;
        }
        if (c === '"' || c === "'" || c === '`') quote = c;
        else if ('([{'.includes(c)) depth++;
        else if (')]}'.includes(c)) {
            if (depth === 0) return c === ')' ? i : -1;
            depth--;
        }
    }
    return -1;
}

function rewriteExpressions(node: AstNode, context: TransformContext | undefined): void {
    const fix = (exp: AstNode | undefined) => {
        if (!exp || exp.type !== SIMPLE_EXPRESSION || typeof exp.content !== 'string') return;
        const rewritten = rewriteTCalls(exp.content, (unnamed) => warnUnnamed(context, unnamed, exp.loc));
        if (rewritten === exp.content) return;
        exp.content = rewritten;
        // With prefixIdentifiers (an inlined <script setup>, a server build) the parser has already
        // parsed the expression; its offsets index the old text, so drop it and let Vue re-parse.
        exp.ast = undefined;
    };
    if (node.type === INTERPOLATION) fix(node.content as AstNode);
    for (const p of node.props ?? []) if (p.type === DIRECTIVE) fix(p.exp);
}

/**
 * The Vue compiler `nodeTransform`. Acts once, on the template root, and rewrites the whole tree
 * before any per-element transform runs.
 */
export function langsysTransform(node: unknown, context?: unknown): void {
    const root = node as AstNode;
    if (root.type !== ROOT) return;
    const ctx = context as TransformContext | undefined;
    const visit = (n: AstNode) => {
        rewriteExpressions(n, ctx);
        if (n.type === ELEMENT && HOSTS.has(n.tag ?? '')) rewriteHost(n, ctx);
        for (const c of n.children ?? []) visit(c);
    };
    visit(root);
}

/** `compilerOptions` with the transform added, for configs that prefer an object. */
export function langsysCompilerOptions<T extends { nodeTransforms?: unknown[] }>(
    options?: T
): T & { nodeTransforms: unknown[] } {
    return { ...(options as T), nodeTransforms: [...(options?.nodeTransforms ?? []), langsysTransform] };
}
