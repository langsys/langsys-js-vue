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
 * Build-time only: this module has no runtime dependencies and never reaches a browser bundle.
 */

/** The compiler's node types this transform reads (`@vue/compiler-core` `NodeTypes`). */
const ROOT = 0;
const ELEMENT = 1;
const TEXT = 2;
const SIMPLE_EXPRESSION = 4;
const INTERPOLATION = 5;
const DIRECTIVE = 7;
const COMPONENT = 1;

const HOSTS = new Set(['Translate', 'Phrase']);
const BLOCKING_DIRECTIVES = new Set(['if', 'else', 'else-if', 'for', 'html', 'text', 'slot']);
/** `m<N>o` / `m<N>c` are the `<Phrase>` markup tokens (VAR-2). */
const RESERVED = /^m\d+[oc]$/;
const IDENT = '[A-Za-z_$][\\w$]*';

// ---------------------------------------------------------------------------------------------
// VAR-2 naming
// ---------------------------------------------------------------------------------------------

/** `firstName` → `first_name`; null when the result is not a valid name. */
function snake(segment: string): string | null {
    const name = segment
        .replace(/^[$_]+/, '')
        .replace(/([a-z0-9])([A-Z])/g, '$1_$2')
        .replace(/([A-Z]+)([A-Z][a-z])/g, '$1_$2')
        .toLowerCase()
        .replace(/[^a-z0-9_]+/g, '_')
        .replace(/_+/g, '_')
        .replace(/_$/, '');
    return /^[a-z][a-z0-9_]*$/.test(name) ? name : null;
}

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

/**
 * The member chain a name is read from: an identifier or a dotted chain, or the argument of a
 * one-argument call. Null for anything else (VAR-2's last row).
 */
function chainOf(expression: string): string[] | null {
    const expr = expression.trim();
    const chain = new RegExp(`^${IDENT}(?:\\s*\\??\\.\\s*${IDENT})*$`);
    if (chain.test(expr)) return expr.split(/\s*\??\.\s*/);
    const call = new RegExp(`^${IDENT}(?:\\s*\\??\\.\\s*${IDENT})*\\s*\\(([\\s\\S]*)\\)$`).exec(expr);
    if (call) {
        const args = topLevelArgs(call[1]!);
        if (args && args.length === 1 && args[0]) return chainOf(args[0]);
    }
    return null;
}

/** A name for one expression, and the segment before the one it was read from (for collisions). */
function baseName(expression: string): { name: string; prefix: string | null } | null {
    const chain = chainOf(expression);
    if (!chain) return null;
    const last = chain.length - 1;
    const at = (i: number) => (i >= 0 ? snake(chain[i]!) : null);
    let name: string | null;
    let from: number;
    if (last > 0 && /^(length|size|count)$/.test(chain[last]!)) {
        const prev = at(last - 1);
        name = prev ? `${prev}_count` : null;
        from = last - 1;
    } else if (last > 0 && /^(value|current)$/.test(chain[last]!)) {
        name = at(last - 1);
        from = last - 1;
    } else {
        name = at(last);
        from = last;
    }
    return name ? { name, prefix: at(from - 1) } : null;
}

export interface NamedVariable {
    expression: string;
    name: string;
    /** True when no name could be derived and `value` was used (a build-time warning). */
    unnamed: boolean;
}

/**
 * Name the variables of one phrase, per VAR-2: the same expression twice is one variable; names
 * already `taken` (a developer's explicit `%name%`) are avoided.
 */
export function nameVariables(expressions: readonly string[], taken: Iterable<string> = []): NamedVariable[] {
    const unique = [...new Set(expressions.map((e) => e.trim()))];
    const derived = unique.map((expression) => ({ expression, base: baseName(expression) }));
    const counts = new Map<string, number>();
    for (const d of derived) if (d.base) counts.set(d.base.name, (counts.get(d.base.name) ?? 0) + 1);

    const named = derived.map(({ expression, base }) => {
        if (!base) return { expression, name: 'value', unnamed: true };
        const collides = (counts.get(base.name) ?? 0) > 1;
        return {
            expression,
            name: collides && base.prefix ? `${base.prefix}_${base.name}` : base.name,
            unnamed: false,
        };
    });

    const used = new Set<string>(taken);
    for (const variable of named) {
        let name = variable.name;
        if (used.has(name) || RESERVED.test(name)) {
            let n = 2;
            while (used.has(`${name}_${n}`)) n++;
            name = `${name}_${n}`;
        }
        used.add(name);
        variable.name = name;
    }
    return named;
}

// ---------------------------------------------------------------------------------------------
// The template rewrite
// ---------------------------------------------------------------------------------------------

/** The slice of Vue's compiler AST this transform touches, typed loosely to stay dependency-free. */
interface AstNode {
    type: number;
    tag?: string;
    tagType?: number;
    content?: unknown;
    children?: AstNode[];
    props?: AstNode[];
    name?: string;
    arg?: AstNode & { content?: string };
    exp?: AstNode & { content?: string };
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
        if (c.tagType === COMPONENT || c.tag === 'slot') return c.tag === 'slot' ? 'slot' : 'component';
        const d = c.props?.find((p) => p.type === DIRECTIVE && BLOCKING_DIRECTIVES.has(p.name ?? ''));
        if (d) return `v-${d.name}`;
        const inner = blockedBy(c.children);
        if (inner) return inner;
    }
    return null;
}

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

    const interpolations: string[] = [];
    const explicit = new Set<string>();
    const collect = (children: AstNode[] = []) => {
        for (const c of children) {
            if (c.type === INTERPOLATION) interpolations.push(String((c.content as AstNode).content ?? ''));
            else if (c.type === TEXT)
                for (const m of String(c.content).matchAll(/%([a-z][a-z0-9_]*)%/g)) explicit.add(m[1]!);
            else if (c.type === ELEMENT) collect(c.children);
        }
    };
    collect(host.children);
    if (!interpolations.length) return;

    const variables = nameVariables(interpolations, explicit);
    const byExpression = new Map(variables.map((v) => [v.expression, v.name]));
    warnUnnamed(context, variables, host.loc);

    const rewrite = (children: AstNode[] = []): AstNode[] =>
        children.map((c) => {
            if (c.type === INTERPOLATION) {
                const name = byExpression.get(String((c.content as AstNode).content ?? '').trim());
                return { type: TEXT, content: `%${name}%`, loc: c.loc } as AstNode;
            }
            if (c.type === ELEMENT) c.children = rewrite(c.children);
            return c;
        });
    host.children = rewrite(host.children);

    const props = host.props ?? [];
    const existing = props.find((p) => p.type === DIRECTIVE && p.name === 'bind' && p.arg?.content === 'params');
    const entries = variables.map((v) => `${JSON.stringify(v.name)}: (${v.expression})`);
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
        const byExpression = new Map(variables.map((v) => [v.expression, v.name]));
        const phrase = parts
            .map((p, k) => p + (k < exprs.length ? `{${byExpression.get(exprs[k]!.trim())}}` : ''))
            .join('');
        const params = `{ ${variables.map((v) => `${JSON.stringify(v.name)}: (${v.expression})`).join(', ')} }`;
        let args: string;
        if (others.length === 0) args = `${JSON.stringify(phrase)}, ${params}`;
        else if (others.length === 1 && /^(['"]).*\1$/s.test(others[0]!))
            args = `${JSON.stringify(phrase)}, ${others[0]}, ${params}`;
        else if (others.length === 1) args = `${JSON.stringify(phrase)}, { ...${params}, ...(${others[0]}) }`;
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
