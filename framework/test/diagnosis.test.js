import test from 'node:test';
import assert from 'node:assert/strict';
import { diagnoseMessage, diagnoseReport, renderDiagnosisMarkdown } from '../lib/diagnosis.js';

// Messages copied from a real CI run of the Notion-like project (see the first two) and from Playwright's formats.
const ACTION = "TimeoutError: locator.click: Timeout 10000ms exceeded.\nCall log:\n  - waiting for getByRole('button', { name: 'Seleccionar bloques', exact: true })\n";
const TOOLBAR = "Error: \x1b[2mexpect(\x1b[22m\x1b[31mlocator\x1b[39m\x1b[2m).\x1b[22mtoBeVisible\x1b[2m()\x1b[22m failed\n\nLocator: getByRole('toolbar', { name: 'Formato de texto' })\nExpected: visible\nTimeout: 15000ms\nError: element(s) not found\n";
const VALUE = "Error: expect(received).toBe(expected) // Object.is equality\n\nExpected: 200\nReceived: 500\n";
const TEXT = "Error: expect(locator).toHaveText(expected) failed\n\nLocator: getByTestId('title')\nExpected: 'Hello'\nReceived: 'Hola'\nTimeout: 5000ms\n";

test('a locator timeout on an action is a selector problem, but the product is named as an alternative', () => {
  const d = diagnoseMessage(ACTION);
  assert.equal(d.category, 'selector');
  assert.equal(d.confidence, 'medium');
  assert.deepEqual(d.alternatives, ['product']);
});

test('a visibility assertion on a missing element is NOT classified as a broken selector', () => {
  const d = diagnoseMessage(TOOLBAR);
  assert.equal(d.category, 'unknown');
  assert.deepEqual(d.alternatives, ['selector', 'product']);
});

test('strict mode violations are selector problems with high confidence', () => {
  assert.equal(diagnoseMessage("Error: locator.click: Error: strict mode violation: getByRole('button') resolved to 2 elements").confidence, 'high');
});

test('a wrong observed value is a product signal, a 500 from an API included', () => {
  assert.equal(diagnoseMessage(VALUE).category, 'product');
  assert.equal(diagnoseMessage(TEXT).category, 'product');
});

test('network, auth and data errors are told apart', () => {
  assert.equal(diagnoseMessage('page.goto: net::ERR_CONNECTION_REFUSED at https://x.test').category, 'infra');
  assert.equal(diagnoseMessage('page.goto: Timeout 30000ms exceeded.').category, 'infra');
  assert.equal(diagnoseMessage('Login failed for profile "viewer": still on the login form').category, 'auth');
  assert.equal(diagnoseMessage('login endpoint answered 401').category, 'auth');
  assert.equal(diagnoseMessage('create item failed: 409 duplicate key value violates unique constraint').category, 'data');
  assert.equal(diagnoseMessage('', { annotations: [{ type: 'cleanup-failed', description: 'page qa-auto-x' }] }).category, 'data');
  assert.equal(diagnoseMessage('something odd').category, 'unknown');
});

const spec = (title, status, results, annotations = []) => ({ title, file: 'a.spec.js', line: 1, tests: [{ projectName: 'chromium', status, annotations, results }] });
const failed = (message) => ({ status: 'failed', error: { message } });

test('report: flaky tests are flaky, annotated defects are known, and counts add up', () => {
  const report = {
    stats: { expected: 1, unexpected: 3, flaky: 1 },
    errors: [{ message: 'Login failed for profile "default": x' }],
    suites: [{ specs: [
      spec('TC0001 ok', 'expected', [{ status: 'passed' }]),
      spec('TC0002 flaky', 'flaky', [failed('page.goto: net::ERR_CONNECTION_RESET'), { status: 'passed' }]),
      spec('TC0003 defect', 'unexpected', [failed(TEXT), failed(TEXT)], [{ type: 'defect', description: 'DEF-01' }]),
      spec('TC0004 selector', 'unexpected', [failed(ACTION)]),
      spec('TC0005 unknown', 'unexpected', [failed(TOOLBAR)]),
    ] }],
  };
  const d = diagnoseReport(report);
  assert.deepEqual(d.counts, { selector: 1, 'known-defect': 1, flaky: 1, unknown: 1 });
  const flaky = d.items.find((i) => i.title.includes('flaky'));
  assert.deepEqual(flaky.causes, ['infra']);
  assert.match(flaky.reason, /first error: page\.goto: net::ERR_CONNECTION_RESET/);
  assert.match(d.items.find((i) => i.title.includes('defect')).reason, /DEF-01/);
  assert.equal(d.setupErrors[0].category, 'auth');
  const md = renderDiagnosisMarkdown(d);
  assert.match(md, /evidence-based guesses/);
  assert.match(md, /could also be: product/);
});

test('an all-green report diagnoses nothing', () => {
  const d = diagnoseReport({ stats: {}, suites: [{ specs: [spec('TC0001', 'expected', [{ status: 'passed' }])] }] });
  assert.deepEqual(d.items, []);
  assert.match(renderDiagnosisMarkdown(d), /No failed or flaky tests/);
});
