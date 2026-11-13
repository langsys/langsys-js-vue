#!/usr/bin/env python3
"""
Validates CONFORMANCE.md against the fleet's canonical format, so the tally a
report quotes is computed rather than asserted.

Usage:
  python3 _dev_/check-conformance.py SPEC.mdx [CONFORMANCE.md]
         [--carry RULE=OTHER_SPEC.mdx]...   a rule graded from a second spec revision (see below)
         [--core CORE_CONFORMANCE.md]       check every "Core row X: `status` (`tier`)" citation
         [--selftest]
Exit: 0 format-valid; 1 format violations; 2 selftest failed.
Format-valid is NOT green: green also needs zero partial / not implemented / held.

The spec revision is read from the files, never from a constant in this script: the header must
name the git blob id of SPEC.mdx (`git hash-object`), and its specVersion row must name the spec's
own specVersion and the number of rules graded.

Carrying a rule from a second spec revision. When a rule exists only on a spec line that has not
merged into the revision being graded, `--carry ICU-7=<spec that has it>` is the one way to grade
it: the rule must exist in that second spec and NOT in SPEC.mdx; the header must name the second
spec's blob; the rule's row must name the second spec's specVersion and the first eight characters
of its blob. Without the flag the rule is "not in spec", so no row can slip in unnamed.
"""
import hashlib, re, sys
from collections import Counter

PROFILE_ROW = '| **Profiles** | browser, binding, all — derived: binding over langsys-js-typescript |'
CLAIMED = {'browser', 'binding', 'all'}
STATUSES = re.compile(r'^(implemented|provisional|delegated|partial|not implemented|held \(strip ruling\)|waived|'
                      r'n/a \(profile: [^)]+\)|n/a \(architecture: .+\))$')
TIERS = {'live', 'contract', 'mock', 'n/a (pure)', '-'}
RULE = r'[A-Z]{3,6}-\d+'


def git_blob(data):
    return hashlib.sha1(b'blob %d\0' % len(data) + data).hexdigest()


def spec_version(text):
    m = re.search(r'^specVersion:\s*([0-9.]+)\s*$', text, re.M)
    return m.group(1) if m else ''


def spec_rules(text):
    out = {}
    for m in re.finditer(rf'^#{{2,4}} +({RULE})\b[^\n]*\n(.*?)(?=^#{{2,4}} +{RULE}\b|\Z)', text, re.M | re.S):
        pm = re.search(r'\*\*Profiles?:\*\*\s*([^\n]+)', m.group(2))
        out[m.group(1)] = pm.group(1) if pm else ''
    return out


def cells(line):
    return [c.strip() for c in re.split(r'(?<!\\)\|', line)[1:-1]]


def table_after(lines, header_prefix):
    idx = [i for i, l in enumerate(lines) if l.startswith(header_prefix)]
    if len(idx) != 1:
        return None
    rows = []
    for l in lines[idx[0] + 2:]:
        if not l.startswith('|'):
            break
        rows.append(cells(l))
    return rows


def tally_key(status):
    return 'n/a (architecture: …)' if status.startswith('n/a (architecture') else status


def core_rows(core_text):
    """Every graded row of the core's file: its status table, and the MOVE table it keeps apart
    while its header cites an earlier spec ('| Rule at 8.7.0 | Status | Tier | Evidence |')."""
    lines = core_text.split('\n')
    out = {}
    for i, l in enumerate(lines):
        if re.match(r'\| Rule( at [0-9.]+)? \| Status \| Tier \| Evidence \|', l):
            for r in lines[i + 2:]:
                if not r.startswith('|'): break
                c = cells(r)
                if len(c) == 4: out[c[0]] = (c[1], c[2])
    return out


def check(spec, conf, carries=None, core=None):
    """spec: text; carries: {rule: spec text}; core: core CONFORMANCE text or None."""
    carries = carries or {}
    errs = []
    blob = git_blob(spec.encode())
    version = spec_version(spec)
    rules = spec_rules(spec)
    carried_blob = {}
    for rid, ctext in carries.items():
        crules = spec_rules(ctext)
        if rid not in crules: errs.append(f'{rid}: --carry names a spec that does not hold it')
        if rid in rules: errs.append(f'{rid}: --carry for a rule the graded spec already holds')
        carried_blob[rid] = (git_blob(ctext.encode()), spec_version(ctext))
        if rid in crules and rid not in rules: rules[rid] = crules[rid]

    lines = conf.split('\n')
    rev = [l for l in lines if l.startswith('| **Spec revision read** |')]
    if len(rev) != 1: errs.append('header: exactly one Spec revision read row required')
    elif blob not in rev[0]: errs.append(f'header: Spec revision read row must name the spec file\'s blob {blob}')
    else:
        for rid, (cb, _) in carried_blob.items():
            if cb not in rev[0]: errs.append(f'header: Spec revision read row must name the blob {cb} of the spec {rid} is carried from')
    if PROFILE_ROW not in conf: errs.append('header: canonical Profiles row missing or altered')
    vrow = [l for l in lines if l.startswith('| specVersion |')]
    if len(vrow) != 1: errs.append('header: exactly one specVersion row required')
    else:
        want = f'**{version}** — {len(rules)} rules'
        if want not in vrow[0]: errs.append(f'header: specVersion row must read "{want}"')

    status_rows = table_after(lines, '| Rule | Status | Tier | Evidence |')
    if status_rows is None: errs.append('expected exactly one status table')
    seen, statuses = Counter(), Counter()
    cites = core_rows(core) if core else None
    for cs in status_rows or []:
        if len(cs) != 4: errs.append(f'row does not have 4 cells: {"|".join(cs)[:60]}'); continue
        rid, status, tier, ev = cs
        if not re.fullmatch(RULE, rid): errs.append(f'not a single rule id: {rid!r}'); continue
        seen[rid] += 1; statuses[status] += 1
        if rid not in rules: errs.append(f'{rid}: not in spec')
        if not STATUSES.match(status): errs.append(f'{rid}: status {status!r} not canonical')
        if tier not in TIERS: errs.append(f'{rid}: tier {tier!r} not canonical')
        if status == 'implemented' and tier not in {'live', 'contract', 'n/a (pure)'}: errs.append(f'{rid}: implemented needs live/contract/n/a (pure), got {tier}')
        if status == 'provisional' and tier != 'mock': errs.append(f'{rid}: provisional needs mock, got {tier}')
        if status == 'delegated':
            if tier != '-': errs.append(f'{rid}: delegated takes tier -, got {tier}')
            if not re.search(r'Core row', ev): errs.append(f'{rid}: delegated evidence must name the core row')
            if not re.search(r'probe', ev, re.I) or not re.search(r'control', ev, re.I): errs.append(f'{rid}: delegated evidence must name an absence probe and its control')
        pm = re.match(r'n/a \(profile: ([^)]+)\)', status)
        if pm and rid in rules:
            line = rules[rid].lower()
            if any(p in line for p in CLAIMED): errs.append(f'{rid}: n/a (profile) but its Profiles line names a claimed profile: {rules[rid]!r}')
        if rid in carried_blob:
            cb, cv = carried_blob[rid]
            if cb[:8] not in ev or f'spec {cv}' not in ev: errs.append(f'{rid}: a carried rule\'s evidence must name spec {cv} and blob {cb[:8]}')
        if cites is not None:
            for m in re.finditer(rf'Core row ({RULE}): `([^`]+)` \(`([^`]+)`\)', ev):
                crid, cst, cti = m.groups()
                if crid not in cites: errs.append(f'{rid}: cites core row {crid}, which the core file does not hold')
                elif cites[crid] != (cst, cti): errs.append(f'{rid}: cites core row {crid} as `{cst}` (`{cti}`), the core file has `{cites[crid][0]}` (`{cites[crid][1]}`)')
    for rid in rules:
        if seen[rid] == 0: errs.append(f'{rid}: not graded')
        elif seen[rid] > 1: errs.append(f'{rid}: graded {seen[rid]} times')

    tally = table_after(lines, '| Status | Rows |')
    if tally is None: errs.append('expected exactly one tally table')
    else:
        want = Counter()
        for k, v in statuses.items(): want[tally_key(k)] += v
        got, total = {}, None
        for cs in tally:
            if len(cs) != 2: continue
            if cs[0] == '**total**': total = cs[1].strip('*')
            else: got[cs[0].strip('`')] = cs[1]
        for k, v in want.items():
            if got.get(k) != str(v): errs.append(f'tally: {k!r} is {got.get(k)!r}, the table has {v}')
        for k in got:
            if k not in want: errs.append(f'tally: {k!r} has no rows in the table')
        if total != str(sum(statuses.values())): errs.append(f'tally: total is {total!r}, the table has {sum(statuses.values())}')
    return errs, statuses, len(rules), sum(seen.values())


def parse_args(argv):
    pos, carries, core, i = [], {}, None, 0
    while i < len(argv):
        a = argv[i]
        if a == '--carry':
            rid, _, path = argv[i + 1].partition('=')
            carries[rid] = open(path).read(); i += 2
        elif a == '--core':
            core = open(argv[i + 1]).read(); i += 2
        elif a.startswith('--'): i += 1
        else: pos.append(a); i += 1
    return pos, carries, core


def restatus(conf, rid, status, tier, new_status, new_tier):
    """`rid`'s row moved from one status and tier to another, the tally moved with it, so only the
    rule a plant targets can catch it, whatever statuses the file holds today."""
    conf = conf.replace(f'| {rid} | {status} | {tier} |', f'| {rid} | {new_status} | {new_tier} |', 1)
    conf = re.sub(rf'(\| `{re.escape(status)}` \| )(\d+)', lambda m: f'{m.group(1)}{int(m.group(2)) - 1}', conf, count=1)
    if re.search(rf'\| `{re.escape(new_status)}` \| \d+', conf):
        return re.sub(rf'(\| `{re.escape(new_status)}` \| )(\d+)', lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', conf, count=1)
    return re.sub(rf'(\| `{re.escape(status)}` \| \d+ \|\n)', lambda m: f'{m.group(1)}| `{new_status}` | 1 |\n', conf, count=1)


def selftest(spec, conf, carries, core):
    # Each plant must be CAUGHT by the rule it breaks, or the validator's pass means nothing. A
    # plant counts only when that rule's own error is raised: one that another rule catches first
    # (a cell boundary swallowed, a tally left unbalanced) would pass with its rule removed.
    blob = git_blob(spec.encode())
    mutants = {
        'duplicate id': (conf.replace('| GATE-2 |', '| GATE-1 |', 1), 'GATE-1: graded 2 times'),
        'wildcard family row': (conf.replace('| REG-1 |', '| REG-1..12 |', 1), 'not a single rule id'),
        'header names another blob': (conf.replace(blob, 'deadbeef' * 5, 1), "Spec revision read row must name the spec file's blob"),
        'header names no spec version': (re.sub(r'\| specVersion \|[^\n]*', '| specVersion | **0.0.0** — 1 rules |', conf, count=1), 'specVersion row must read'),
        'implemented with mock tier': (conf.replace('| BIND-1 | implemented | n/a (pure) |', '| BIND-1 | implemented | mock |', 1), 'BIND-1: implemented needs'),
        'provisional with a real tier': (restatus(conf, 'BIND-1', 'implemented', 'n/a (pure)', 'provisional', 'contract'), 'BIND-1: provisional needs mock'),
        'delegated without probe': (re.sub(r'(\| CAT-1 \| delegated \| - \| )[^|\n]*', r'\1Core row CAT-1 only. ', conf, count=1), 'CAT-1: delegated evidence must name an absence probe'),
        'n/a profile on a browser rule': (restatus(conf, 'HINT-3', 'delegated', '-', 'n/a (profile: server)', '-'), 'HINT-3: n/a (profile) but its Profiles line names a claimed profile'),
        'missing rule': (re.sub(r'\n\| CONF-3 \|[^\n]*', '', conf, count=1), 'CONF-3: not graded'),
        'tally count altered': (re.sub(r'(\| `delegated` \| )(\d+)', lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', conf, count=1), "tally: 'delegated' is"),
        'tally total altered': (re.sub(r'(\| \*\*total\*\* \| \*\*)(\d+)', lambda m: f'{m.group(1)}{int(m.group(2)) + 1}', conf, count=1), 'tally: total is'),
    }
    for rid, ctext in carries.items():
        cb = git_blob(ctext.encode())
        mutants[f'{rid} carried without the flag'] = (None, f'{rid}: not in spec')  # run with no carries below
        mutants[f'{rid} row removed'] = (re.sub(rf'\n\| {rid} \|[^\n]*', '', conf, count=1), f'{rid}: not graded')
        mutants[f'header drops the {rid} source blob'] = (conf.replace(cb, 'cafef00d' * 5, 1), f'of the spec {rid} is carried from')
        mutants[f'{rid} row names no source blob'] = (re.sub(rf'(\| {rid} \| [^|]*\| [^|]*\| )([^\n]*)', lambda m: m.group(1) + m.group(2).replace(cb[:8], 'xxxxxxxx'), conf, count=1), f"{rid}: a carried rule's evidence must name spec")
    if core:
        mutants['citation tier altered'] = (re.sub(r'(Core row GATE-1: `[^`]+` \(`)([^`]+)(`\))', lambda m: m.group(1) + ('n/a (pure)' if m.group(2) != 'n/a (pure)' else 'contract') + m.group(3), conf, count=1), 'cites core row GATE-1 as')
        mutants['citation of a row the core lacks'] = (conf.replace('Core row CAT-1:', 'Core row CAT-99:', 1), 'cites core row CAT-99, which the core file does not hold')
    ok = True
    for name, (mutant, expect) in mutants.items():
        if mutant is None: errs = check(spec, conf, {}, core)[0]
        else: errs = check(spec, mutant, carries, core)[0]
        caught = any(expect in e for e in errs)
        ok &= caught
        print(f'  selftest {"CAUGHT" if caught else "MISSED"}  {name}')
        if not caught:
            for e in errs[:3]: print(f'    raised instead: {e}')
    base_errs = check(spec, conf, carries, core)[0]
    print(f'  baseline file: {"valid" if not base_errs else "INVALID"}')
    for e in base_errs: print(f'    ✗ {e}')
    sys.exit(0 if ok and not base_errs else 2)


def main():
    pos, carries, core = parse_args(sys.argv[1:])
    spec = open(pos[0]).read()
    conf = open(pos[1] if len(pos) > 1 else 'CONFORMANCE.md').read()
    if '--selftest' in sys.argv: selftest(spec, conf, carries, core)
    errs, statuses, n_rules, n_rows = check(spec, conf, carries, core)
    print(f'spec rules: {n_rules}   graded rows: {n_rows}   spec blob: {git_blob(spec.encode())[:8]}')
    for k, v in sorted(statuses.items(), key=lambda x: -x[1]): print(f'  {k:<28} {v}')
    blocking = sum(v for k, v in statuses.items() if k in {'partial', 'not implemented'} or k.startswith('held'))
    print(f'format: {"VALID" if not errs else "INVALID"}   green: {"yes" if not errs and blocking == 0 else f"no ({blocking} blocking rows)"}')
    for e in errs: print(f'  ✗ {e}')
    sys.exit(1 if errs else 0)


main()
