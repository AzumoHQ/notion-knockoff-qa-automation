import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { parseAcceptanceCriteria, createDraft, checkDrafts } from '../lib/tickets.js';
import { buildCatalog } from '../lib/catalog.js';
import { adfToText, JiraClient } from '../lib/integrations/jira.js';
import { tempDir } from './helpers.js';

test('acceptance criteria are read from bullets, numbered lines and only from their own section', () => {
  const text = `Some intro that is not a criterion.\n- decoy before the section\n\n## Acceptance criteria\n- A saved page keeps its title after reload\n2. The sidebar shows the new page\n\n## Notes\n- not a criterion`;
  assert.deepEqual(parseAcceptanceCriteria(text).map((c) => c.text), ['A saved page keeps its title after reload', 'The sidebar shows the new page']);
  assert.deepEqual(parseAcceptanceCriteria('Criterios de aceptación:\n* Se guarda el título').map((c) => c.id), ['AC1']);
  assert.deepEqual(parseAcceptanceCriteria('nothing here'), []);
});

test('Given/When/Then scenarios keep their parts, in English and Spanish', () => {
  const [a, b] = parseAcceptanceCriteria(`Given a signed in user\nAnd a page "A"\nWhen they archive it\nThen it disappears from the sidebar\nAnd it shows in the trash\n\nDado un invitado\nCuando abre una página no compartida\nEntonces ve un aviso`);
  assert.deepEqual(a.given, ['a signed in user', 'a page "A"']);
  assert.deepEqual(a.when, ['they archive it']);
  assert.deepEqual(a.then, ['it disappears from the sidebar', 'it shows in the trash']);
  assert.deepEqual(b.then, ['ve un aviso']);
});

const ticket = { key: 'QA-12', title: 'Archive pages', description: '## Acceptance criteria\n- Archived pages leave the sidebar\n- Archived pages appear in the trash' };

function project() {
  const root = tempDir();
  fs.mkdirSync(path.join(root, 'test-cases'));
  fs.writeFileSync(path.join(root, 'test-cases/base.yml'), 'area: A\nfeature: F\ncases:\n  - id: TC0007\n    title: existing\n    priority: low\n    automation: manual\n    steps: [a]\n    expected: [b]\n');
  return root;
}

test('a draft is honest: planned, draft, fixme, with steps only when the ticket gave them', () => {
  const root = project();
  const draft = createDraft({ root, ticket });
  assert.deepEqual(draft.cases.map((c) => c.id), ['TC0008', 'TC0009']);
  assert.ok(draft.cases.every((c) => c.draft && c.automation === 'planned' && c.steps.length === 0));
  assert.deepEqual(draft.cases[0].expected, ['Archived pages leave the sidebar']);
  const spec = fs.readFileSync(path.join(root, 'tests/regression/qa-12.spec.js'), 'utf8');
  assert.equal([...spec.matchAll(/test\.fixme\(/g)].length, 2);
  assert.doesNotMatch(spec, /expect\(/, 'a draft asserts nothing');
  const { issues } = buildCatalog({ root, collected: [{ id: 'TC0008', title: 'TC0008 - x', file: 'tests/regression/qa-12.spec.js', line: 1, project: 'chromium', tags: [] }, { id: 'TC0009', title: 'TC0009 - y', file: 'tests/regression/qa-12.spec.js', line: 2, project: 'chromium', tags: [] }] });
  assert.deepEqual(issues.filter((i) => i.level === 'error'), [], 'drafts do not break the catalog');
  assert.ok(issues.some((i) => i.level === 'warn' && /draft/.test(i.message)));
  assert.throws(() => createDraft({ root, ticket: { ...ticket, description: 'no criteria' } }), /No acceptance criteria/);
});

test('the gate rejects drafts, tautologies and tests that assert nothing, and passes only to human review', () => {
  const root = project();
  createDraft({ root, ticket });
  const state = () => Object.fromEntries(checkDrafts({ root }).map((r) => [r.id, r]));
  assert.ok(state().TC0008.problems.some((p) => /test\.fixme/.test(p)));

  const write = (a, b) => fs.writeFileSync(path.join(root, 'tests/regression/qa-12.spec.js'), `import { test, expect } from '../../fixtures/base.fixture.js';
test('TC0008 - Archived pages leave the sidebar', async ({ page }) => {
  // AC: AC1
${a}
});
test('TC0009 - Archived pages appear in the trash', async ({ page }) => {
  // AC: AC2
${b}
});
`);
  write('  await page.goto("/");', '  expect(true).toBe(true);');
  let s = state();
  assert.ok(s.TC0008.problems.some((p) => /asserts nothing/.test(p)));
  assert.ok(s.TC0009.problems.some((p) => /tautological/.test(p)));
  assert.equal(s.TC0008.status, 'incomplete');

  write('  await page.goto("/");\n  await expect(page.getByRole("link", { name: "Home" })).toHaveCount(1);', '  await expect(page).toHaveTitle(/.+/);');
  s = state();
  assert.equal(s.TC0008.status, 'needs-review');
  assert.ok(s.TC0009.problems.some((p) => /tautological/.test(p)));
  assert.ok(s.TC0008.warnings.some((w) => /marked draft/.test(w)), 'a person still has to confirm and clear the draft flag');

  write('  await expect(page.getByRole("heading")).toBeVisible();', '  // TODO assert\n  await expect(page.getByText("x")).toHaveText("x");');
  s = state();
  assert.ok(s.TC0008.warnings.some((w) => /only visibility/.test(w)));
  assert.ok(s.TC0009.problems.some((p) => /TODO/.test(p)));
  assert.ok(Object.values(s).every((r) => r.status !== 'validated'), 'the tool never claims a test is validated');
});

test('a criterion without its marker is reported', () => {
  const root = project();
  createDraft({ root, ticket });
  fs.writeFileSync(path.join(root, 'tests/regression/qa-12.spec.js'), "test('TC0008 - x', async ({ page }) => {\n  await expect(page.getByText('a')).toHaveText('a');\n});\ntest('TC0009 - y', async ({ page }) => {\n  // AC: AC2\n  await expect(page.getByText('b')).toHaveText('b');\n});\n");
  const s = Object.fromEntries(checkDrafts({ root }).map((r) => [r.id, r]));
  assert.ok(s.TC0008.problems.some((p) => /\/\/ AC: AC1/.test(p)));
  assert.equal(s.TC0009.status, 'needs-review');
});

test('Jira descriptions become plain text and a ticket can be fetched', async () => {
  const adf = { type: 'doc', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Intro' }] }, { type: 'heading', content: [{ type: 'text', text: 'Acceptance criteria' }] }, { type: 'bulletList', content: [{ type: 'listItem', content: [{ type: 'paragraph', content: [{ type: 'text', text: 'It saves' }] }] }] }] };
  const text = adfToText(adf);
  assert.deepEqual(parseAcceptanceCriteria(text).map((c) => c.text), ['It saves']);
  const server = http.createServer((req, res) => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ fields: { summary: 'Save pages', description: adf } })));
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  try {
    const issue = await new JiraClient({ baseUrl: `http://127.0.0.1:${server.address().port}`, email: 'a@b.c', token: 't', projectKey: 'QA' }).fetchIssue('QA-1');
    assert.equal(issue.title, 'Save pages');
    assert.match(issue.description, /- It saves/);
  } finally {
    server.close();
  }
});
