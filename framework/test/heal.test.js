import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { parseFailure, parseExpression, parseAriaSnapshot, similarity, proposeReplacement, actionConflict } from '../lib/heal/locator.js';
import { findInSource, applyReplacement, unifiedDiff, sourcePattern } from '../lib/heal/source.js';
import { buildHealReport, verifyProposal, verifyAll, writeHealReport, renderHealMarkdown, checkProposals } from '../lib/heal/report.js';
import { startFixtureApp } from './fixture-app.js';
import { tempDir } from './helpers.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');

const ACTION = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Seleccionar bloques', exact: true })\n";
const ASSERTION = "Error: expect(locator).toBeVisible() failed\n\nLocator: getByRole('toolbar', { name: 'Formato de texto' })\nExpected: visible\nTimeout: 15000ms\nError: element(s) not found\n";
const STRICT = "Error: locator.click: Error: strict mode violation: getByRole('button', { name: 'Guardar' }) resolved to 2 elements:\n    1) <button>";

test('failures are read as action, assertion or strict, with the locator text', () => {
  assert.deepEqual(parseFailure(ACTION), { kind: 'action', action: 'click', expression: "getByRole('button', { name: 'Seleccionar bloques', exact: true })" });
  assert.deepEqual(parseFailure(ASSERTION), { kind: 'assertion', expression: "getByRole('toolbar', { name: 'Formato de texto' })" });
  assert.equal(parseFailure(STRICT).kind, 'strict');
  assert.equal(parseFailure('boom').kind, 'unknown');
});

test('waitFor failures give the locator without the awaited state (found on a real run)', () => {
  const waitFor = "TimeoutError: locator.waitFor: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Cambiar de espacio de trabajo actual' }) to be visible\n";
  const failure = parseFailure(waitFor);
  assert.deepEqual(failure, { kind: 'action', action: 'waitFor', expression: "getByRole('button', { name: 'Cambiar de espacio de trabajo actual' })" });
  assert.equal(parseExpression(failure.expression).supported, true);
});

test('simple locators parse; scoped, filtered and regex ones are refused with a reason', () => {
  assert.deepEqual(parseExpression("getByRole('button', { name: 'Guardar', exact: true }).first()"), { supported: true, method: 'getByRole', role: 'button', text: 'Guardar', exact: true, chain: '.first()', exactGiven: true });
  assert.equal(parseExpression("getByText('Hola \\'mundo\\'')").text, "Hola 'mundo'");
  assert.equal(parseExpression("getByLabel('Email')").method, 'getByLabel');
  assert.equal(parseExpression("locator('.menu').getByRole('button', { name: 'X' })").supported, false);
  assert.equal(parseExpression("getByRole('button', { name: /guardar/i })").supported, false);
  assert.equal(parseExpression("getByRole('button').filter({ hasText: 'x' })").supported, false);
  assert.equal(parseExpression(null).supported, false);
});

test('ARIA snapshot lines give role, name and disabled state', () => {
  const nodes = parseAriaSnapshot(`- heading "Ajustes" [level=1]
- button "Guardar cambios" [disabled]
- link "Inicio":
  - /url: /
- textbox "Correo \\"principal\\""
- button`);
  assert.deepEqual(nodes.map((n) => [n.role, n.name, n.disabled]), [['heading', 'Ajustes', false], ['button', 'Guardar cambios', true], ['link', 'Inicio', false], ['textbox', 'Correo "principal"', false], ['button', '', false]]);
});

test('similarity ignores case, accents and punctuation, and rewards containment', () => {
  assert.equal(similarity('Guardar', 'guardar!'), 1);
  assert.equal(similarity('Configuración', 'configuracion'), 1);
  assert.ok(similarity('Guardar', 'Guardar cambios') >= 0.75);
  assert.ok(similarity('Sign in now', 'Sign in') >= 0.6);
  assert.ok(similarity('Exportar PDF', 'Eliminar cuenta') < 0.4);
});

const parsedOf = (e) => parseExpression(e);

test('a long shared word does not make unrelated names similar (real case: "Archivar página" vs "Nueva página")', () => {
  assert.ok(similarity('Archivar página', 'Nueva página') < 0.6);
  const p = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Archivar página', exact: true })"), snapshot: '- button "Nueva página"\n- button "Cerrar sesión"\n- button "Ir a la papelera"', action: 'click' });
  assert.equal(p.status, 'none');
  const ok = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Archivar página', exact: true })"), snapshot: '- button "Archivar"\n- button "Nueva página"', action: 'click' });
  assert.equal(ok.candidate.name, 'Archivar');
  assert.deepEqual(ok.alternatives, [], 'the weak look-alike is not even listed');
});

test('a renamed button gets a suggestion with a unique, same-role, exact replacement', () => {
  const p = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- heading "Ajustes"\n- button "Guardar cambios"\n- button "Cancelar"', action: 'click' });
  assert.equal(p.status, 'suggested');
  assert.equal(p.replacement, "getByRole('button', { name: 'Guardar cambios', exact: true })");
  assert.equal(p.candidate.role, 'button');
});

test('the chain (.first, .nth) is kept; a text locator is proposed as a role locator', () => {
  const p = proposeReplacement({ parsed: parsedOf("getByText('Crear página').first()"), snapshot: '- button "Crear pagina nueva"', action: 'click' });
  assert.equal(p.replacement, "getByRole('button', { name: 'Crear pagina nueva', exact: true }).first()");
});

test('nothing is proposed when the element is gone, when the name still exists, or when candidates tie', () => {
  const gone = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Exportar PDF' })"), snapshot: '- button "Cancelar"\n- button "Guardar"', action: 'click' });
  assert.equal(gone.status, 'none');
  assert.match(gone.reason, /removed \(possible product change\)/);

  const present = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- button "Guardar"\n- button "Guardar cambios"', action: 'click' });
  assert.equal(present.status, 'none');
  assert.match(present.reason, /state, visibility or timing/);

  const tie = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- button "Guardar copia"\n- button "Guardar borrador"', action: 'click' });
  assert.equal(tie.status, 'ambiguous');
  assert.equal(tie.alternatives.length, 2);
});

test('other roles never match, a disabled candidate is skipped for clicks, duplicates are ambiguous', () => {
  assert.equal(proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- link "Guardar cambios"', action: 'click' }).status, 'none');
  assert.equal(proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- button "Guardar cambios" [disabled]', action: 'click' }).status, 'none');
  assert.equal(proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Guardar' })"), snapshot: '- button "Guardar cambios"\n- button "Guardar cambios"', action: 'click' }).status, 'ambiguous');
  assert.equal(proposeReplacement({ parsed: parsedOf("getByTestId('save')"), snapshot: '- button "Save"', action: 'click' }).status, 'unsupported');
});

function project(files) {
  const root = tempDir('qa-heal-');
  for (const [file, content] of Object.entries(files)) {
    fs.mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    fs.writeFileSync(path.join(root, file), content);
  }
  return root;
}

test('the failing locator is found once, in a page object, even with other quotes and spacing', () => {
  const root = project({ 'pages/Settings.js': "export class S {\n  constructor(page) {\n    this.save = page.getByRole( \"button\", {name:  \"Guardar\"} );\n  }\n}\n" });
  const parsed = parsedOf("getByRole('button', { name: 'Guardar' })");
  const hit = findInSource({ root, parsed });
  assert.equal(hit.status, 'found');
  assert.equal(hit.file, 'pages/Settings.js');
  assert.equal(hit.line, 3);
  const before = fs.readFileSync(path.join(root, hit.file), 'utf8');
  const after = applyReplacement(before, hit, "getByRole('button', { name: 'Guardar cambios', exact: true })");
  assert.equal(after.split('\n').length, before.split('\n').length);
  assert.match(unifiedDiff(hit.file, before, after), /^-.*"Guardar".*\n\+.*Guardar cambios/m);
});

test('a locator inside expect(), a repeated locator and a dynamic one are never patched', () => {
  const parsed = parsedOf("getByRole('button', { name: 'Guardar' })");
  const inExpect = project({ 'tests/a.spec.js': "await expect(page.getByRole('button', { name: 'Guardar' })).toBeVisible();\n" });
  assert.equal(findInSource({ root: inExpect, parsed }).status, 'assertion-target');
  const twice = project({ 'pages/A.js': "this.a = page.getByRole('button', { name: 'Guardar' });\n", 'pages/B.js': "this.b = page.getByRole('button', { name: 'Guardar' });\n" });
  assert.equal(findInSource({ root: twice, parsed }).status, 'ambiguous');
  const dynamic = project({ 'pages/A.js': 'this.a = page.getByRole(`button`, { name: label });\n' });
  assert.equal(findInSource({ root: dynamic, parsed }).status, 'not-found');
  assert.ok(sourcePattern(parsed).test("getByRole('button', { name: 'Guardar' })"));
  assert.ok(!sourcePattern(parsed).test("getByRole('button', { name: 'Guardar', exact: true })"), 'exact must match as printed');
});

const attach = (proposal) => [{ name: 'heal-proposal', contentType: 'application/json', body: Buffer.from(JSON.stringify(proposal)).toString('base64') }];
const failedSpec = (title, message, attachments = [], annotations = []) => ({ title, file: 'a.spec.js', line: 1, tests: [{ projectName: 'chromium', status: 'unexpected', annotations, results: [{ status: 'failed', error: { message }, attachments }] }] });
const suggested = { status: 'suggested', candidate: { role: 'button', name: 'Guardar cambios', score: 0.75 }, replacement: "getByRole('button', { name: 'Guardar cambios', exact: true })", live: { count: 1, visible: true, enabled: true }, alternatives: [] };

test('the report suggests only for selector-like action failures and says why for everything else', () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({
    root,
    report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [
      failedSpec('TC1 renamed', action, attach(suggested)),
      failedSpec('TC2 assertion', ASSERTION, attach(suggested)),
      failedSpec('TC3 defect', action, attach(suggested), [{ type: 'defect', description: 'DEF-1' }]),
      failedSpec('TC4 no evidence', action),
      failedSpec('TC5 live check failed', action, attach({ ...suggested, live: { count: 2, visible: true } })),
      failedSpec('TC6 server error', 'Error: expect(received).toBe(expected)\n\nExpected: 200\nReceived: 500\n'),
    ] }] },
  });
  const by = Object.fromEntries(report.proposals.map((p) => [p.title.split(' ')[0], p]));
  assert.equal(by.TC1.status, 'suggested');
  assert.deepEqual({ ...by.TC1.source, sha256: undefined }, { file: 'pages/S.js', line: 1, sha256: undefined });
  assert.match(by.TC1.source.sha256, /^[0-9a-f]{64}$/);
  assert.match(by.TC2.reason, /assertions are never healed/);
  assert.match(by.TC3.reason, /known defect/);
  assert.equal(by.TC4.status, 'no-evidence');
  assert.equal(by.TC5.status, 'rejected');
  assert.equal(by.TC6.status, 'not-applicable');
  const written = writeHealReport(report, root);
  assert.ok(fs.readFileSync(path.join(root, '.qa-out/heal/heal.patch'), 'utf8').includes('+this.save = page.getByRole(\'button\', { name: \'Guardar cambios\', exact: true });'));
  assert.ok(!JSON.stringify(written).includes('_patch'));
  assert.match(renderHealMarkdown(written), /Suggestions only\. Nothing in the repository was modified/);
});

test('verification applies the change, runs the test, then always restores the file', async () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: root });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 renamed', action, attach(suggested))] }] } });
  const proposal = report.proposals[0];
  const original = fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8');
  let seen;
  const ok = await verifyProposal({ proposal, root, run: () => { seen = fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8'); return { passed: true, detail: 'ok' }; } });
  assert.equal(ok.status, 'passed');
  assert.match(seen, /Guardar cambios/);
  assert.equal(fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8'), original);
  await assert.rejects(verifyProposal({ proposal, root, run: () => { throw new Error('crash'); } }), /crash/);
  assert.equal(fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8'), original, 'restored even when the run crashes');
  fs.appendFileSync(path.join(root, 'pages/S.js'), '// local edit\n');
  assert.equal((await verifyProposal({ proposal, root, run: () => ({ passed: true }) })).status, 'skipped');
});

// ---- real Playwright run: fixture captures, report maps, verify re-runs, assertions untouched ---------------------

test('end to end: a renamed button is suggested and verified; a removed one and a failed assertion are left alone', async () => {
  const app = await startFixtureApp();
  try {
    const root = tempDir('qa-heal-e2e-');
    fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
    fs.cpSync(path.join(repo, 'framework'), path.join(root, 'framework'), { recursive: true });
    fs.mkdirSync(path.join(root, 'pages'));
    fs.mkdirSync(path.join(root, 'tests'));
    fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
    fs.writeFileSync(path.join(root, 'playwright.config.js'), `export default { testDir: './tests', retries: 0, timeout: 20000, use: { baseURL: ${JSON.stringify(app.url)}, actionTimeout: 2000 }, projects: [{ name: 'chromium' }], reporter: [['json', { outputFile: 'results.json' }]] };\n`);
    fs.writeFileSync(path.join(root, 'fixtures.js'), "import { test as base, expect } from '@playwright/test';\nimport { healFixtures } from './framework/playwright/heal-fixtures.js';\nexport const test = base.extend(healFixtures);\nexport { expect };\n");
    fs.writeFileSync(path.join(root, 'pages/Login.js'), `export class Login {
  constructor(page) {
    this.page = page;
    this.submit = page.getByRole('button', { name: 'Sign in now' });
    this.export = page.getByRole('button', { name: 'Export PDF' });
  }
}
`);
    fs.writeFileSync(path.join(root, 'tests/login.spec.js'), `import { test, expect } from '../fixtures.js';
import { Login } from '../pages/Login.js';
test('TC1 renamed submit', async ({ page }) => { await page.goto('/'); await new Login(page).submit.click(); });
test('TC2 removed export', async ({ page }) => { await page.goto('/'); await new Login(page).export.click(); });
test('TC3 wrong heading', async ({ page }) => { await page.goto('/'); await expect(page.getByRole('heading', { name: 'Welcome' })).toBeVisible({ timeout: 1000 }); });
`);
    const sourceBefore = fs.readFileSync(path.join(root, 'pages/Login.js'), 'utf8');
    spawnSync('git', ['init', '-q'], { cwd: root });
    spawnSync('git', ['add', '-A'], { cwd: root });
    spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: root });
    const run = await new Promise((resolve) => {
      const child = spawn('npx', ['playwright', 'test'], { cwd: root, env: { ...process.env, CI: '' } });
      child.on('close', resolve);
      child.stdout.resume();
      child.stderr.resume();
    });
    assert.equal(run, 1, 'the three tests fail: nothing was healed during the run');

    const report = buildHealReport({ root, report: JSON.parse(fs.readFileSync(path.join(root, 'results.json'), 'utf8')) });
    const by = Object.fromEntries(report.proposals.map((p) => [p.title.split(' ')[0], p]));
    assert.equal(by.TC1.status, 'suggested', JSON.stringify(by.TC1));
    assert.equal(by.TC1.candidate.name, 'Sign in');
    assert.deepEqual(by.TC1.live, { count: 1, visible: true, enabled: true });
    assert.equal(by.TC2.status, 'none', 'a removed element gets no suggestion');
    assert.equal(by.TC3.status, 'not-applicable', 'an assertion failure is never healed');

    // Re-run through the real runner with the proposal applied to the working tree.
    const verification = await verifyProposal({ proposal: by.TC1, root });
    assert.equal(verification.status, 'passed', JSON.stringify(verification));
    assert.equal(fs.readFileSync(path.join(root, 'pages/Login.js'), 'utf8'), sourceBefore, 'source restored');
    assert.equal(spawnSync('git', ['status', '--porcelain', '--', 'pages', 'tests'], { cwd: root, encoding: 'utf8' }).stdout, '', 'working tree untouched');
    assert.match(fs.readFileSync(path.join(root, 'test-results/.last-run.json'), 'utf8'), /"status": "failed"/, 'the original failure evidence was not overwritten by the re-run');
    assert.ok(fs.existsSync(path.join(root, '.qa-out/heal/test-results')), 'the re-run wrote to its own output folder');
  } finally {
    app.close();
  }
});

// ---- optional tier 3 (LLM): picks from the page's own elements, validated mechanically --------------------------------

import http from 'node:http';
import { createLlm } from '../lib/llm/index.js';
import { applyLlmTier } from '../lib/heal/report.js';
import { llmPick } from '../lib/heal/llm-tier.js';

async function mockLlm(answerFor) {
  const requests = [];
  const server = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => {
      requests.push({ url: req.url, headers: req.headers, body: JSON.parse(body) });
      const answer = answerFor(requests.at(-1));
      if (answer === 'fail') return res.writeHead(500).end('boom');
      res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ content: [{ type: 'text', text: answer }] }));
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  return { url: `http://127.0.0.1:${server.address().port}`, requests, close: () => server.close() };
}
const llmEnv = (url) => ({ LLM_PROVIDER: 'anthropic', LLM_MODEL: 'test-model', LLM_API_KEY: 'sk-test-secret-key', LLM_BASE_URL: url });

test('no provider means no LLM: createLlm returns null and a half-configured one fails loudly', () => {
  assert.equal(createLlm({}), null);
  assert.equal(createLlm({ LLM_PROVIDER: 'none' }), null);
  assert.throws(() => createLlm({ LLM_PROVIDER: 'anthropic' }), /LLM_MODEL and LLM_API_KEY/);
  assert.throws(() => createLlm({ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm', LLM_API_KEY: 'k' }), /LLM_BASE_URL/);
  assert.throws(() => createLlm({ LLM_PROVIDER: 'other', LLM_MODEL: 'm', LLM_API_KEY: 'k' }), /Unknown LLM_PROVIDER/);
});

test('the anthropic and openai-compatible providers speak their own request formats', async () => {
  const anthropic = await mockLlm(() => '{"choice":1}');
  try {
    const llm = createLlm(llmEnv(anthropic.url));
    assert.equal(await llm.complete({ system: 's', prompt: 'p' }), '{"choice":1}');
    assert.equal(anthropic.requests[0].url, '/v1/messages');
    assert.equal(anthropic.requests[0].headers['x-api-key'], 'sk-test-secret-key');
    assert.equal(anthropic.requests[0].body.model, 'test-model');
  } finally {
    anthropic.close();
  }
  const compat = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => res.writeHead(200, { 'content-type': 'application/json' }).end(JSON.stringify({ choices: [{ message: { content: `echo ${req.url} ${req.headers.authorization}` } }] })));
  });
  await new Promise((r) => compat.listen(0, '127.0.0.1', r));
  try {
    const llm = createLlm({ LLM_PROVIDER: 'openai-compatible', LLM_MODEL: 'm', LLM_API_KEY: 'k1', LLM_BASE_URL: `http://127.0.0.1:${compat.address().port}/v1/` });
    assert.equal(await llm.complete({ prompt: 'p' }), 'echo /v1/chat/completions Bearer k1');
  } finally {
    compat.close();
  }
});

const snapshotsOf = (text) => [{ url: '/', snapshot: text }];
const parsedRole = parseExpression("getByRole('button', { name: 'Exportar' })");

test('the LLM can only pick from the listed elements: a valid pick is accepted, others are not', async () => {
  const snapshot = snapshotsOf('- button "Descargar informe"\n- button "Cancelar"\n- link "Inicio"');
  for (const [answer, expected] of [['{"choice": 1, "reason": "same download action"}', 'suggested'], ['{"choice": null, "reason": "nothing similar"}', 'none'], ['{"choice": 9}', 'rejected'], ['{"choice": "Descargar"}', 'rejected'], ['not json', 'none']]) {
    const server = await mockLlm(() => answer);
    try {
      const pick = await llmPick({ llm: createLlm(llmEnv(server.url)), parsed: parsedRole, action: 'click', snapshots: snapshot });
      assert.equal(pick.status, expected, answer);
      if (expected === 'suggested') {
        assert.equal(pick.proposedBy, 'llm');
        assert.equal(pick.replacement, "getByRole('button', { name: 'Descargar informe', exact: true })");
      }
      const prompt = server.requests[0].body.messages[0].content;
      assert.match(prompt, /1\. button "Descargar informe"/);
      assert.doesNotMatch(prompt, /link "Inicio"/, 'only elements of a compatible kind are offered');
      assert.ok(!JSON.stringify(server.requests[0].body).includes('sk-test-secret-key'), 'the key is a header, never part of the content');
    } finally {
      server.close();
    }
  }
});

test('an LLM outage or a duplicated name never produces a suggestion', async () => {
  const down = await mockLlm(() => 'fail');
  try {
    const pick = await llmPick({ llm: createLlm(llmEnv(down.url)), parsed: parsedRole, action: 'click', snapshots: snapshotsOf('- button "Descargar"') });
    assert.equal(pick.status, 'none');
    assert.match(pick.reason, /could not be reached/);
    assert.ok(!pick.reason.includes('sk-test-secret-key'));
  } finally {
    down.close();
  }
  const twice = await mockLlm(() => '{"choice":1}');
  try {
    const pick = await llmPick({ llm: createLlm(llmEnv(twice.url)), parsed: parsedRole, action: 'click', snapshots: snapshotsOf('- button "Descargar"\n- button "Descargar"') });
    assert.equal(pick.status, 'ambiguous');
  } finally {
    twice.close();
  }
});

test('the report only asks the LLM about undecided failures, and labels what it picks', async () => {
  const root = project({ 'pages/S.js': "this.export = page.getByRole('button', { name: 'Exportar' });\nthis.other = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  const act = (name) => `TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: '${name}' })\n`;
  const evidence = (text) => [{ name: 'heal-evidence', contentType: 'application/json', body: Buffer.from(JSON.stringify(snapshotsOf(text))).toString('base64') }];
  const none = (text) => [...attach({ status: 'none', reason: 'no element of the same kind has a similar name: the element may have been removed (possible product change)' }), ...evidence(text)];
  const stateIssue = [...attach({ status: 'none', reason: 'an element with the original name exists in the snapshot: the failure is about state, visibility or timing, not the name' }), ...evidence('- button "Guardar"')];
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 renamed', act('Exportar'), none('- button "Descargar informe"')), failedSpec('TC2 state', act('Guardar'), stateIssue)] }] } });
  assert.equal(report.proposals[0].status, 'none');
  const server = await mockLlm(() => '{"choice":1,"reason":"same download action"}');
  try {
    await applyLlmTier({ report, llm: createLlm(llmEnv(server.url)), root });
    assert.equal(server.requests.length, 1, 'the state problem is not sent to the LLM');
    const [first, second] = report.proposals;
    assert.equal(first.status, 'suggested');
    assert.equal(first.proposedBy, 'llm');
    assert.deepEqual({ ...first.source, sha256: undefined }, { file: 'pages/S.js', line: 1, sha256: undefined });
    assert.equal(second.status, 'none');
    const md = renderHealMarkdown(writeHealReport(report, root));
    assert.match(md, /picked by an LLM from the page's elements: same download action/);
  } finally {
    server.close();
  }
});

test('tests that fail on the same locator share one verification and one patch hunk', async () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'x'], { cwd: root });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 first', action, attach(suggested)), failedSpec('TC2 second', action, attach(suggested))] }] } });
  let runs = 0;
  await verifyAll({ proposals: report.proposals, root, run: () => { runs++; return { passed: true, detail: 'ok' }; } });
  assert.equal(runs, 1);
  assert.deepEqual(report.proposals.map((p) => p.verification.status), ['passed', 'passed']);
  writeHealReport(report, root);
  const patch = fs.readFileSync(path.join(root, '.qa-out/heal/heal.patch'), 'utf8');
  assert.equal(patch.split('--- a/pages/S.js').length - 1, 1);
  assert.equal(spawnSync('git', ['apply', '--check', '.qa-out/heal/heal.patch'], { cwd: root }).status, 0, 'the patch applies');
});

test('the generated diff applies with git apply wherever the line sits in the file', () => {
  const cases = {
    'single line': "this.a = page.getByRole('button', { name: 'Guardar' });\n",
    'first line': "this.a = page.getByRole('button', { name: 'Guardar' });\nline 2\nline 3\nline 4\nline 5\n",
    'last line': "line 1\nline 2\nline 3\nline 4\nthis.a = page.getByRole('button', { name: 'Guardar' });\n",
    'middle': "1\n2\n3\n4\nthis.a = page.getByRole('button', { name: 'Guardar' });\n6\n7\n8\n9\n",
    'no final newline': "x\ny\nthis.a = page.getByRole('button', { name: 'Guardar' });",
  };
  for (const [label, content] of Object.entries(cases)) {
    const root = project({ 'pages/S.js': content });
    spawnSync('git', ['init', '-q'], { cwd: root });
    const hit = findInSource({ root, parsed: parseExpression("getByRole('button', { name: 'Guardar' })") });
    const after = applyReplacement(content, hit, "getByRole('button', { name: 'Guardar cambios', exact: true })");
    fs.writeFileSync(path.join(root, 'change.patch'), unifiedDiff('pages/S.js', content, after));
    const check = spawnSync('git', ['apply', '--check', 'change.patch'], { cwd: root, encoding: 'utf8' });
    assert.equal(check.status, 0, `${label}: ${check.stderr}`);
    spawnSync('git', ['apply', 'change.patch'], { cwd: root });
    assert.equal(fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8'), after, label);
  }
});

// ---- review hardening: look-alikes with another meaning, names used elsewhere, stale patches -----------------------

test('look-alike names that mean another action are rejected, not suggested', () => {
  const cases = [
    ['Archivar página', '- button "Desarchivar página"\n- button "Nueva página"'],
    ['Eliminar', '- button "Eliminar para siempre"\n- button "Cancelar"'],
    ['Open menu', '- button "Close menu"'],
    ['Aceptar', '- button "Rechazar"'],
    ['Guardar', '- button "Guardar todo"'],
  ];
  for (const [name, snapshot] of cases) {
    const p = proposeReplacement({ parsed: parsedOf(`getByRole('button', { name: '${name}' })`), snapshot, action: 'click' });
    assert.equal(p.status, 'none', `${name}: ${JSON.stringify(p)}`);
    assert.ok(p.rejectedLookalikes?.length || p.reason, name);
  }
  const p = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Archivar página' })"), snapshot: '- button "Desarchivar página"', action: 'click' });
  assert.match(p.reason, /different action/);
  assert.match(p.rejectedLookalikes[0].reason, /negates|opposite/);
  assert.equal(actionConflict('Guardar', 'Guardar cambios'), null, 'a longer name for the same action is fine');
  assert.equal(actionConflict('Sign in now', 'Sign in'), null);
  // The same pair is accepted next to a clean candidate: only the look-alike is dropped.
  const mixed = proposeReplacement({ parsed: parsedOf("getByRole('button', { name: 'Archivar página' })"), snapshot: '- button "Desarchivar página"\n- button "Archivar"', action: 'click' });
  assert.equal(mixed.status, 'suggested');
  assert.equal(mixed.candidate.name, 'Archivar');
  assert.equal(mixed.rejectedLookalikes[0].name, 'Desarchivar página');
  assert.deepEqual(mixed.differences, { removed: ['pagina'], added: [] });
});

test('a candidate whose name another locator already targets goes to review: in the report, not in the patch', () => {
  const root = project({
    'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\nthis.saveCopy = page.getByRole('button', { name: 'Guardar cambios' });\n",
    'tests/a.spec.js': '',
  });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 renamed', action, attach(suggested))] }] } });
  assert.equal(report.proposals[0].status, 'needs-review');
  assert.match(report.proposals[0].reason, /already used by other locators \(pages\/S\.js:2\)/);
  const written = writeHealReport(report, root);
  assert.match(written.proposals[0].diff, /Guardar cambios/, 'the diff is shown for a person to apply by hand');
  assert.equal(fs.readFileSync(path.join(root, '.qa-out/heal/heal.patch'), 'utf8'), '', 'but it is not part of the patch');
  assert.match(renderHealMarkdown(written), /needs-review\*\* \(not a confirmed fix/);
});

test('an ambiguous candidate and a failed assertion produce no diff and no patch', () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [
    failedSpec('TC1 ambiguous', action, attach({ status: 'ambiguous', reason: 'several elements look equally close', alternatives: [] })),
    failedSpec('TC2 assertion', ASSERTION, attach(suggested)),
  ] }] } });
  assert.deepEqual(report.proposals.map((p) => p.status), ['ambiguous', 'not-applicable']);
  writeHealReport(report, root);
  assert.equal(fs.readFileSync(path.join(root, '.qa-out/heal/heal.patch'), 'utf8'), '');
  assert.equal(fs.readFileSync(path.join(root, 'pages/S.js'), 'utf8'), "this.save = page.getByRole('button', { name: 'Guardar' });\n");
});

test('a patch is tied to the revision it was made for: edits after that are detected as stale', () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  const commit = (m) => spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qam', m], { cwd: root });
  commit('base');
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  const report = buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 renamed', action, attach(suggested))] }] } });
  const written = writeHealReport(report, root);
  assert.match(written.revision, /^[0-9a-f]{40}$/);
  const patch = fs.readFileSync(path.join(root, '.qa-out/heal/heal.patch'), 'utf8');
  assert.match(patch, /^# generated for revision [0-9a-f]{40}$/m);
  assert.equal(spawnSync('git', ['apply', '--check', '.qa-out/heal/heal.patch'], { cwd: root }).status, 0, 'git ignores the preamble');

  const fresh = checkProposals({ proposals: written.proposals, revision: written.revision, root });
  assert.equal(fresh.stale, 0);
  assert.equal(fresh.sameRevision, true);

  // The code moves on: the same line is edited by someone else, so the patch no longer fits.
  fs.writeFileSync(path.join(root, 'pages/S.js'), "// moved\nthis.save = page.getByRole('button', { name: 'Guardar' });\n");
  commit('someone edits the page object');
  const stale = checkProposals({ proposals: written.proposals, revision: written.revision, root });
  assert.equal(stale.stale, 1);
  assert.equal(stale.sameRevision, false);
  assert.match(stale.items[0].reason, /changed since/);
  fs.rmSync(path.join(root, 'pages/S.js'));
  assert.match(checkProposals({ proposals: written.proposals, revision: written.revision, root }).items[0].reason, /no longer exists/);
});

test('qa heal check exits 1 for a stale patch and 0 for a current one', () => {
  const root = project({ 'pages/S.js': "this.save = page.getByRole('button', { name: 'Guardar' });\n", 'tests/a.spec.js': '' });
  spawnSync('git', ['init', '-q'], { cwd: root });
  spawnSync('git', ['add', '-A'], { cwd: root });
  spawnSync('git', ['-c', 'user.email=a@b.c', '-c', 'user.name=t', 'commit', '-qm', 'base'], { cwd: root });
  const action = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Guardar' })\n";
  writeHealReport(buildHealReport({ root, report: { config: { rootDir: path.join(root, 'tests') }, suites: [{ specs: [failedSpec('TC1 renamed', action, attach(suggested))] }] } }), root);
  const qa = path.join(repo, 'framework/bin/qa.mjs');
  const run = () => spawnSync('node', [qa, 'heal', 'check'], { cwd: root, encoding: 'utf8' });
  const ok = run();
  assert.equal(ok.status, 0, ok.stdout + ok.stderr);
  assert.match(ok.stdout, /applies cleanly/);
  fs.writeFileSync(path.join(root, 'pages/S.js'), "this.save = page.getByRole('button', { name: 'Guardar' });\n// edited\n");
  const bad = run();
  assert.equal(bad.status, 1);
  assert.match(bad.stdout, /STALE/);
  assert.match(bad.stdout, /do not apply/);
});
