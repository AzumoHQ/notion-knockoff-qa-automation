import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { stringify } from 'yaml';
import { idFromTitle, nextId } from '../lib/ids.js';
import { buildCatalog, stubMissing } from '../lib/catalog.js';
import { tempDir } from './helpers.js';

const caseDef = (id, extra = {}) => ({ id, title: `Case ${id}`, priority: 'high', steps: ['do'], expected: ['see'], ...extra });
const found = (id, file = 'tests/a.spec.js', project = 'chromium') => ({ id, title: `${id} - t`, file, line: 3, project, tags: [] });

function project(cases, { area = 'Pages', feature = 'Create', extraFiles = [] } = {}) {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'test-cases'));
  fs.writeFileSync(path.join(root, 'test-cases/pages.yml'), stringify({ area, feature, cases }));
  for (const file of ['tests/a.spec.js', 'tests/b.spec.js', ...extraFiles]) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), '');
  }
  return root;
}
const errorsOf = (r) => r.issues.filter((i) => i.level === 'error').map((i) => i.message);

test('ids are read from the start of a title, including parametrized variants', () => {
  assert.equal(idFromTitle('TC0001 - login works'), 'TC0001');
  assert.equal(idFromTitle('TC0030: paste [html]'), 'TC0030');
  assert.equal(idFromTitle('TC12345 - five digits'), 'TC12345');
  assert.equal(idFromTitle('TC0030 [mobile]'), 'TC0030');
  assert.equal(idFromTitle('tc0001 - lower case'), null);
  assert.equal(idFromTitle('TC001 - too short'), null);
  assert.equal(idFromTitle('Login TC0001'), null);
  assert.equal(nextId(['TC0002', 'TC0010']), 'TC0011');
});

test('a consistent project builds a grouped catalog', () => {
  const root = project([caseDef('TC0001'), caseDef('TC0002', { type: 'ui', priority: 'low' })]);
  const r = buildCatalog({ root, collected: [found('TC0001'), found('TC0002')] });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.catalog.stats.total, 2);
  assert.deepEqual(r.catalog.areas, [{ name: 'Pages', features: [{ name: 'Create', cases: ['TC0001', 'TC0002'] }] }]);
  assert.equal(r.catalog.cases[0].spec.file, 'tests/a.spec.js');
});

test('a parametrized case: one definition, several tests, one result group', () => {
  const root = project([caseDef('TC0001')]);
  const r = buildCatalog({ root, collected: [found('TC0001'), found('TC0001'), found('TC0001', 'tests/a.spec.js', 'mobile')] });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.catalog.cases[0].spec.tests, 3);
  assert.deepEqual(r.catalog.cases[0].spec.projects, ['chromium', 'mobile']);
});

test('tests without definition, without ID, or sharing an ID across files are errors', () => {
  const root = project([caseDef('TC0001')]);
  const r = buildCatalog({ root, collected: [found('TC0001'), found('TC0001', 'tests/b.spec.js'), found('TC0009'), { id: null, title: 'no id', file: 'tests/a.spec.js', line: 1, project: 'chromium', tags: [] }] });
  const errors = errorsOf(r);
  assert.ok(errors.some((m) => /TC0001.*several files/.test(m)));
  assert.ok(errors.some((m) => /TC0009.*no definition/.test(m)));
  assert.ok(errors.some((m) => /without a case ID/.test(m)));
});

test('definitions without a test are errors unless manual or planned', () => {
  const root = project([caseDef('TC0001'), caseDef('TC0002', { automation: 'manual' }), caseDef('TC0003', { automation: 'planned' })]);
  const errors = errorsOf(buildCatalog({ root, collected: [] }));
  assert.deepEqual(errors, ['TC0001: automated but no test carries this ID']);
});

test('a manual case with an automated test is an error', () => {
  const root = project([caseDef('TC0002', { automation: 'manual' })]);
  assert.ok(errorsOf(buildCatalog({ root, collected: [found('TC0002')] })).some((m) => /manual but has an automated test/.test(m)));
});

test('steps and expected results are required unless the case is a draft', () => {
  const root = project([caseDef('TC0001', { steps: [] }), caseDef('TC0002', { expected: [], draft: true })]);
  const r = buildCatalog({ root, collected: [found('TC0001'), found('TC0002')] });
  assert.deepEqual(errorsOf(r), ['TC0001: steps are required (write them, or mark the case draft: true)']);
  assert.ok(r.issues.some((i) => i.level === 'warn' && /TC0002: draft/.test(i.message)));
});

test('duplicated definitions, bad enums and a wrong spec path are reported', () => {
  const root = project([caseDef('TC0001'), caseDef('TC0001'), caseDef('TC0002', { priority: 'urgent', spec: 'tests/missing.spec.js' }), caseDef('TC0003', { spec: 'tests/b.spec.js' })]);
  const errors = errorsOf(buildCatalog({ root, collected: [found('TC0001'), found('TC0002'), found('TC0003')] }));
  assert.ok(errors.some((m) => /TC0001: defined twice/.test(m)));
  assert.ok(errors.some((m) => /TC0002: priority/.test(m)));
  assert.ok(errors.some((m) => /TC0002: spec file tests\/missing.spec.js does not exist/.test(m)));
  assert.ok(errors.some((m) => /TC0003: spec is tests\/b.spec.js but the test lives in tests\/a.spec.js/.test(m)));
});

test('UI and API cases must run in their own project', () => {
  const root = project([caseDef('TC0001', { type: 'api' }), caseDef('TC0002', { type: 'ui' })]);
  const errors = errorsOf(buildCatalog({ root, collected: [found('TC0001'), found('TC0002', 'tests/a.spec.js', 'api')] }));
  assert.ok(errors.some((m) => /TC0001: type api/.test(m)));
  assert.ok(errors.some((m) => /TC0002: type ui/.test(m)));
});

test('stub adds draft definitions with the test title and nothing invented', () => {
  const root = project([caseDef('TC0001')]);
  const added = stubMissing({ root, collected: [found('TC0001'), { id: 'TC0007', title: 'TC0007 - drag a block', file: 'tests/b.spec.js', line: 9, project: 'chromium', tags: [] }] });
  assert.deepEqual(added, ['TC0007']);
  const text = fs.readFileSync(path.join(root, 'test-cases/unsorted.yml'), 'utf8');
  assert.match(text, /title: "drag a block"/);
  assert.doesNotMatch(text, /steps:/);
  const r = buildCatalog({ root, collected: [found('TC0001'), { id: 'TC0007', title: 'TC0007 - drag a block', file: 'tests/b.spec.js', line: 9, project: 'chromium', tags: [] }] });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.catalog.cases.find((c) => c.id === 'TC0007').draft, true);
});

test('a real `playwright --list` run feeds the catalog (no injected data)', () => {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'tests'));
  fs.writeFileSync(path.join(root, 'playwright.config.js'), "export default { testDir: './tests', projects: [{ name: 'chromium' }] };\n");
  fs.writeFileSync(path.join(root, 'tests/x.spec.js'), "import { test } from '@playwright/test';\nfor (const v of ['a','b']) test(`TC0001 - param [${v}]`, async () => {});\ntest('TC0002 - plain', async () => {});\n");
  fs.symlinkSync(path.resolve('node_modules'), path.join(root, 'node_modules'));
  fs.mkdirSync(path.join(root, 'test-cases'));
  fs.writeFileSync(path.join(root, 'test-cases/x.yml'), stringify({ area: 'A', feature: 'F', cases: [caseDef('TC0001'), caseDef('TC0002')] }));
  const r = buildCatalog({ root });
  assert.deepEqual(errorsOf(r), []);
  assert.equal(r.catalog.cases.find((c) => c.id === 'TC0001').spec.tests, 2);
  assert.equal(r.catalog.cases.find((c) => c.id === 'TC0002').spec.file, 'tests/x.spec.js');
});
