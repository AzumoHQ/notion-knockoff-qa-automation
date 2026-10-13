import test from 'node:test';
import assert from 'node:assert/strict';
import { globToRegex, selectByRisk, parseChangedPaths, grepForIds, countSelected, changedPathsFromGithub } from '../lib/risk.js';

const cases = [
  { id: 'TC0001', area: 'Authentication', automation: 'automated' },
  { id: 'TC0002', area: 'Pages', automation: 'automated' },
  { id: 'TC0003', area: 'Pages', automation: 'manual' },
  { id: 'TC0004', area: 'Editor', automation: 'automated' },
  { id: 'TC00010', area: 'Editor', automation: 'automated' },
];
const map = { rules: [{ paths: ['src/pages/**'], areas: ['Pages'] }, { paths: ['src/editor/**', 'src/blocks/*.ts'], areas: ['Editor', 'Pages'] }], alwaysRun: ['Authentication'], ignore: ['docs/**', '**/*.md'] };

test('globs: ** crosses folders, * does not, regex characters are literal', () => {
  assert.ok(globToRegex('src/**').test('src/a/b/c.ts'));
  assert.ok(globToRegex('src/*.ts').test('src/a.ts'));
  assert.ok(!globToRegex('src/*.ts').test('src/a/b.ts'));
  assert.ok(!globToRegex('a.b').test('axb'));
  assert.ok(globToRegex('**/*.md').test('README.md'));
});

test('everything is selected whenever the evidence is incomplete', () => {
  const none = (extra) => selectByRisk({ changedPaths: ['src/pages/a.ts'], map, cases, ...extra });
  assert.equal(none({ map: null }).mode, 'all');
  assert.equal(none({ changedPaths: [] }).mode, 'all');
  assert.match(none({ changedPaths: ['src/pages/a.ts', 'infra/deploy.yml'] }).reason, /not covered by the risk map \(e\.g\. infra\/deploy\.yml\)/);
  assert.match(none({ map: { ...map, rules: [{ paths: ['src/pages/**'], areas: ['Nope'] }] } }).reason, /do not exist in the catalog: Nope/);
  assert.match(none({ cases: [{ id: 'TC0001', area: 'Pages', automation: 'manual' }, { id: 'TC0009', area: 'Authentication', automation: 'manual' }] }).reason, /no automated cases/);
});

test('mapped changes select their areas plus the always-run ones, automated cases only', () => {
  const sel = selectByRisk({ changedPaths: ['src/pages/list.ts', 'docs/readme.md', 'README.md'], map, cases });
  assert.equal(sel.mode, 'risk');
  assert.deepEqual(sel.areas.sort(), ['Authentication', 'Pages']);
  assert.deepEqual(sel.ids, ['TC0001', 'TC0002']);
  assert.deepEqual(selectByRisk({ changedPaths: ['src/blocks/a.ts'], map, cases }).areas.sort(), ['Authentication', 'Editor', 'Pages']);
});

test('only ignored paths run just the always-run areas, and everything when there are none', () => {
  assert.deepEqual(selectByRisk({ changedPaths: ['docs/a.md'], map, cases }).ids, ['TC0001']);
  assert.equal(selectByRisk({ changedPaths: ['docs/a.md'], map: { ...map, alwaysRun: [] }, cases }).mode, 'all');
});

test('the grep matches whole case IDs only, and the selection is counted against the real test list', () => {
  const grep = grepForIds(['TC0001', 'TC0004']);
  assert.ok(new RegExp(grep).test('TC0001 - x'));
  assert.ok(!new RegExp(grep).test('TC00010 - ten'), 'TC0001 must not select TC00010');
  const tests = [{ title: 'TC0001 - a', file: 'tests/smoke-tests/a.spec.js' }, { title: 'TC0004 - b', file: 'tests/regression/b.spec.js' }, { title: 'TC0004 - b [x]', file: 'tests/regression/b.spec.js' }];
  assert.deepEqual(countSelected({ tests, grep, dir: 'tests/regression' }), { selected: 2, total: 2 });
  assert.deepEqual(countSelected({ tests, grep, dir: 'tests/smoke-tests' }), { selected: 1, total: 1 });
  assert.deepEqual(countSelected({ tests, grep: '', dir: '' }), { selected: 3, total: 3 });
});

test('changed paths from env text or the GitHub compare API are cleaned and capped', () => {
  assert.deepEqual(parseChangedPaths('a.ts, b.ts\n\n c/d.ts '), ['a.ts', 'b.ts', 'c/d.ts']);
  assert.equal(parseChangedPaths(Array.from({ length: 5000 }, (_, i) => `f${i}`).join('\n')).length, 2000);
  assert.deepEqual(changedPathsFromGithub({ repo: 'o/p', base: 'a', head: 'b', run: (args) => ({ status: 0, stdout: 'x.ts\ny.ts\n', args }) }), ['x.ts', 'y.ts']);
  assert.equal(changedPathsFromGithub({ repo: 'o/p', base: 'a', head: 'b', run: () => ({ status: 1, stdout: '' }) }), null);
});
