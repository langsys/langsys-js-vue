#!/usr/bin/env python3
"""
Re-measures every absence probe in CONFORMANCE.md's Probes table, so the counts a row quotes are
computed, not remembered.

Usage:
  python3 _dev_/conformance-probes.py CORE_COMMIT [CONFORMANCE.md] [--core-repo PATH] [--check]

Each probe is the table's pattern, an extended regular expression, run as the documented
`probe()` runs it: over `*.ts` files, `*.test.ts` excluded, one count per matching line, with
lines that open with `*`, `//` or `/*` left out. It runs over this binding's `src/` and over the
core's `src/` at CORE_COMMIT, taken with `git archive` from the core repository (default
../langsys-js-typescript), so an uncommitted change in either checkout's core never counts.

Prints each probe's two counts and the sites they fire on; the core's sites shown are code, never
an import, a re-export or a type declaration, though each such line is counted. With --check it
exits 1 when a count differs from the table's: the binding's count in "This binding" (its leading
number), the core's in "Control". A probe whose control names another repository is reported, not
checked. --json prints the measurements as one JSON object instead.
"""
import io, json, os, re, subprocess, sys, tarfile

ROOT = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))


def cells(line):
    return [c.strip() for c in re.split(r'(?<!\\)\|', line)[1:-1]]


def probes(conformance):
    lines = conformance.split('\n')
    start = next(i for i, l in enumerate(lines) if re.match(r'\|\s*Probe\s*\|\s*Rule\s*\|\s*Pattern', l))
    out = []
    for l in lines[start + 2:]:
        if not l.startswith('|'):
            break
        c = cells(l)
        pattern = c[2].strip('`').replace('\\|', '|')
        out.append({'id': c[0], 'rule': c[1], 'pattern': pattern, 'binding': c[3], 'control': c[4]})
    return out


def sources_from_dir(src):
    files = {}
    for dirpath, _, names in os.walk(src):
        for n in names:
            if n.endswith('.ts') and not n.endswith('.test.ts'):
                p = os.path.join(dirpath, n)
                files[os.path.relpath(p, src)] = open(p, encoding='utf8').read()
    return files


def sources_from_commit(repo, commit):
    data = subprocess.run(['git', '-C', repo, 'archive', commit, 'src'], check=True, capture_output=True).stdout
    files = {}
    with tarfile.open(fileobj=io.BytesIO(data)) as tar:
        for m in tar.getmembers():
            if m.isfile() and m.name.endswith('.ts') and not m.name.endswith('.test.ts'):
                files[os.path.relpath(m.name, 'src')] = tar.extractfile(m).read().decode('utf8')
    return files


COMMENT = re.compile(r'^\s*(\*|//|/\*)')
DECLARATION = re.compile(r'^\s*(import\b|export\s*(type\s*)?\{|export\s+\*|(export\s+)?(declare\s+)?(interface|type)\s)|\}\s*from\s*[\'"]')


def count(pattern, files):
    rx = re.compile(pattern)
    hits = []
    for name in sorted(files):
        in_list = False  # inside a multi-line `import { … }` or `export { … }`
        for i, line in enumerate(files[name].split('\n'), 1):
            opens = re.match(r'^\s*(import\b[^;\'"]*\{|export\s+(type\s+)?\{)[^}]*$', line) is not None
            declaration = in_list or opens or bool(DECLARATION.search(line))
            if in_list and '}' in line:
                in_list = False
            elif opens:
                in_list = True
            if COMMENT.match(line):
                continue
            if rx.search(line):
                hits.append((name, i, declaration))
    return hits


def sites(hits, code_only=False):
    return [f'{name}:{i}' for name, i, declaration in hits if not (code_only and declaration)]


def leading_number(text):
    m = re.match(r'\s*(\d+)', text)
    return int(m.group(1)) if m else None


def main():
    args = [a for a in sys.argv[1:] if not a.startswith('--')]
    core_repo = os.path.join(ROOT, '..', 'langsys-js-typescript')
    if '--core-repo' in sys.argv:
        core_repo = sys.argv[sys.argv.index('--core-repo') + 1]
        args = [a for a in args if a != core_repo]
    commit = args[0]
    conformance = open(args[1] if len(args) > 1 else os.path.join(ROOT, 'CONFORMANCE.md'), encoding='utf8').read()
    binding = sources_from_dir(os.path.join(ROOT, 'src'))
    core = sources_from_commit(core_repo, commit)
    assert len(binding) >= 8 and len(core) >= 8, 'read too few files: a probe would report a false zero'
    measured = {}
    if '--json' not in sys.argv:
        print(f'binding src: {len(binding)} files   core {commit} src: {len(core)} files')
    differ = 0
    for p in probes(conformance):
        b, c = count(p['pattern'], binding), count(p['pattern'], core)
        want_b, want_c = leading_number(p['binding']), leading_number(p['control'])
        other_repo = re.search(r'in [a-z-]+$', p['control']) is not None and 'core' not in p['control']
        marks = []
        if want_b is not None and want_b != len(b):
            marks.append(f'binding {want_b} in the table')
        if not other_repo and want_c is not None and want_c != len(c):
            marks.append(f'control {want_c} in the table')
        differ += bool(marks)
        measured[p['id']] = {'binding': sites(b), 'core': len(c), 'core_sites': sites(c, True)[:2], 'differs': marks}
        if '--json' in sys.argv:
            continue
        sites_b = ', '.join(sites(b)) if b else '-'
        sites_c = ', '.join(sites(c, True)[:2]) if c else '-'
        flag = f'   DIFFERS: {"; ".join(marks)}' if marks else ''
        print(f'{p["id"]:<4} binding {len(b):>2} [{sites_b}]   core {len(c):>3} [{sites_c}]{flag}')
    if '--json' in sys.argv:
        print(json.dumps(measured))
    else:
        print(f'{differ} probe(s) differ from the table')
    if '--check' in sys.argv and differ:
        sys.exit(1)


main()
