import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { endpointTemplate, endpointKey } from '../lib/api/normalize.js';
import { ApiSession, tokenFromStorageState } from '../lib/api/session.js';
import { CreatedResources, makeName, createdAtFromName } from '../lib/api/registry.js';
import { sweep, parseDuration } from '../lib/api/sweeper.js';
import { mergeObserved, coverageReport, renderMarkdown } from '../lib/api/coverage.js';
import { documentedEndpoints } from '../lib/api/openapi.js';
import { discover } from '../lib/api/discover.js';
import { startMockApi, loginConfig, mockProfiles, mockEnv, itemResources } from './mock-api.js';
import { startFixtureApp } from './fixture-app.js';
import { tempDir } from './helpers.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const open = (mock, extra = {}) => ApiSession.create({ config: loginConfig(mock.url), env: mockEnv, profiles: mockProfiles, ...extra });

test('endpoint templates hide ids and keep only query parameter names', () => {
  assert.deepEqual(endpointTemplate('https://x.test/rest/v1/pages/123e4567-e89b-12d3-a456-426614174000?select=*&id=eq.SECRET&id=eq.2'), { origin: 'https://x.test', path: '/rest/v1/pages/{id}', query: ['id', 'select'] });
  assert.equal(endpointTemplate('/api/items/42').path, '/api/items/{id}');
  assert.equal(endpointTemplate('/api/v2/items').path, '/api/v2/items');
  assert.equal(endpointKey('get', '/a/{userId}/b'), 'GET /a/{id}/b');
});

test('names carry their creation time and a foreign name has none', () => {
  const name = makeName('qa-auto-', 1_800_000_000_000, 0.5);
  assert.equal(createdAtFromName(name), 1_800_000_000_000);
  assert.equal(createdAtFromName('someone-elses-page'), null);
  assert.equal(createdAtFromName('qa-auto-notatime'), null);
});

test('login-endpoint session logs in, and logs in again once after a 401', async () => {
  const mock = await startMockApi();
  try {
    const api = await open(mock);
    assert.equal((await api.get('/api/items')).status(), 200);
    mock.state.expire();
    assert.equal((await api.get('/api/items')).status(), 200, 'retried after re-login');
    assert.equal(mock.state.logins, 2);
    assert.deepEqual(api.calls.map((c) => c.path), ['/api/items', '/api/items']);
    await api.dispose();
  } finally {
    mock.close();
  }
});

test('a rejected login names the problem and never prints the password', async () => {
  const mock = await startMockApi();
  try {
    await assert.rejects(open(mock, { env: { TEST_USER_USERNAME: 'qa', TEST_USER_PASSWORD: 'wrong-pw-777' } }), (e) => /login endpoint answered 401/.test(e.message) && !e.message.includes('wrong-pw-777'));
  } finally {
    mock.close();
  }
});

test('bearer token is read from a storage state localStorage entry', () => {
  const root = tempDir();
  const file = path.join(root, 's.json');
  fs.writeFileSync(file, JSON.stringify({ cookies: [], origins: [{ origin: 'https://x', localStorage: [{ name: 'sb-abc-auth-token', value: JSON.stringify({ access_token: 'jwt-1', user: {} }) }] }] }));
  assert.equal(tokenFromStorageState(file, { keyPattern: '^sb-.*-auth-token$', tokenPath: 'access_token' }), 'jwt-1');
  assert.throws(() => tokenFromStorageState(file, { keyPattern: 'nope' }), /No localStorage key/);
});

test('created resources are removed in reverse order, and one failure does not stop the rest', async () => {
  const mock = await startMockApi();
  try {
    const api = await open(mock);
    const removed = [];
    const resources = { item: { ...itemResources.item, remove: async (a, item) => { removed.push(item.name); if (item.name.endsWith('b')) throw new Error('boom'); return itemResources.item.remove(a, item); } } };
    const created = new CreatedResources({ resources, api });
    await created.create('item', { name: 'qa-auto-a' });
    await created.create('item', { name: 'qa-auto-b' });
    await created.create('item', { name: 'qa-auto-c' });
    const failures = await created.cleanup();
    assert.deepEqual(removed, ['qa-auto-c', 'qa-auto-b', 'qa-auto-a']);
    assert.equal(failures.length, 1);
    assert.equal(failures[0].name, 'qa-auto-b');
    assert.deepEqual(mock.state.items.map((i) => i.name), ['qa-auto-b'], 'only the failing one is left');
    await assert.rejects(created.create('unknown'), /Unknown resource kind/);
    await api.dispose();
  } finally {
    mock.close();
  }
});

const ageMs = (hours) => Date.now() - hours * 3_600_000;
function fakeResources(items, removed = []) {
  return { removed, resources: { item: { list: async () => items, remove: async (_a, item) => { removed.push(item.name); } } } };
}

test('sweep only deletes our prefix, older than the limit, and never anything foreign', async () => {
  const old = makeName('qa-auto-', ageMs(5));
  const { resources, removed } = fakeResources([
    { id: '1', name: old },
    { id: '2', name: makeName('qa-auto-', Date.now()) },
    { id: '3', name: 'Quarterly plan' },
    { id: '4', name: 'qa-auto-handmade', createdAt: new Date(ageMs(9)).toISOString() },
    { id: '5', name: 'qa-auto-nodate' },
  ]);
  const report = await sweep({ resources, api: null });
  assert.deepEqual(removed.sort(), [old, 'qa-auto-handmade'].sort());
  assert.equal(report.skippedRecent, 2, 'recent and undatable names are kept');
  assert.equal(report.skippedForeign, 1);
});

test('sweep dry run deletes nothing, and an oversized batch is refused', async () => {
  const items = Array.from({ length: 4 }, (_, i) => ({ id: String(i), name: makeName('qa-auto-', ageMs(10) + i) }));
  const dry = fakeResources(items);
  const report = await sweep({ resources: dry.resources, api: null, dryRun: true });
  assert.equal(report.deleted.length, 4);
  assert.deepEqual(dry.removed, []);
  await assert.rejects(sweep({ resources: fakeResources(items).resources, api: null, max: 3 }), /Refusing to delete 4/);
});

test('sweep reports a failed removal and keeps going', async () => {
  const items = [{ id: '1', name: makeName('qa-auto-', ageMs(9)) }, { id: '2', name: makeName('qa-auto-', ageMs(8)) }];
  const resources = { item: { list: async () => items, remove: async (_a, item) => { if (item.id === '1') throw new Error('locked'); } } };
  const report = await sweep({ resources, api: null });
  assert.equal(report.deleted.length, 1);
  assert.equal(report.failed[0].error, 'locked');
  assert.equal(parseDuration('30m'), 1_800_000);
  assert.throws(() => parseDuration('soon'), /Invalid duration/);
});

// ---- the real Playwright fixtures: normal end, failing test, timeout and an interrupted process --------------------

function writeProject(mock) {
  const root = tempDir('qa-api-');
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
  fs.cpSync(path.join(repo, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests/api'), { recursive: true });
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'playwright.config.js'), "export default { testDir: './tests', timeout: 4000, retries: 0, projects: [{ name: 'api', testMatch: '**/*.spec.js' }], reporter: 'list' };\n");
  fs.writeFileSync(path.join(root, 'fixtures.js'), `import { test as base, expect } from '@playwright/test';
import { apiFixtures } from './framework/playwright/api-fixtures.js';
import { loginConfig, mockProfiles } from './framework/test/mock-api.js';
export const test = base.extend(apiFixtures(loginConfig(${JSON.stringify(mock.url)}), mockProfiles));
export { expect };
`);
  return root;
}

function runPlaywright(root, env = {}) {
  return new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test'], { cwd: root, env: { ...process.env, ...mockEnv, ...env, CI: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (status) => resolve({ status, out }));
  });
}

test('seeded data is removed after a pass, an assertion failure and a timeout; other data is untouched', async () => {
  const mock = await startMockApi();
  try {
    mock.state.seedForeign('Quarterly plan');
    mock.state.seedForeign('qa-auto-other-account', 'another-user');
    const root = writeProject(mock);
    fs.writeFileSync(path.join(root, 'tests/api/seed.spec.js'), `import { test, expect } from '../../fixtures.js';
test('passes', async ({ seed, api }) => {
  const item = await seed.create('item');
  expect((await api.get('/api/items')).status()).toBe(200);
  expect(item.name).toMatch(/^qa-auto-/);
});
test('fails after creating', async ({ seed }) => {
  await seed.create('item');
  await seed.create('item');
  expect(1).toBe(2);
});
test('times out after creating', async ({ seed }) => {
  await seed.create('item');
  await new Promise((r) => setTimeout(r, 30000));
});
test('creates in parallel', async ({ seed }) => { await seed.create('item'); await seed.create('item'); });
`);
    const run = await runPlaywright(root);
    assert.match(run.out, /1 failed|2 failed/, run.out);
    assert.match(run.out, /2 passed/, run.out);
    assert.deepEqual(mock.state.items.map((i) => i.name).sort(), ['Quarterly plan', 'qa-auto-other-account']);
    const calls = fs.readdirSync(path.join(root, '.qa-out/api-calls'));
    assert.ok(calls.length >= 1, 'API calls are written for the coverage report');
  } finally {
    mock.close();
  }
});

test('data left by a killed process is recovered by a later sweep', async () => {
  const mock = await startMockApi();
  try {
    const root = writeProject(mock);
    // A process that creates data and is killed before any cleanup could run.
    const script = path.join(root, 'leak.mjs');
    fs.writeFileSync(script, `import { ApiSession } from './framework/lib/api/session.js';
import { CreatedResources } from './framework/lib/api/registry.js';
import { loginConfig, mockProfiles, mockEnv } from './framework/test/mock-api.js';
const config = loginConfig(${JSON.stringify(mock.url)});
const api = await ApiSession.create({ config, profiles: mockProfiles, env: mockEnv });
const created = new CreatedResources({ resources: config.resources, api });
await created.create('item'); await created.create('item');
console.log('created'); setInterval(() => {}, 1000);
`);
    const leaker = spawn('node', [script], { cwd: root });
    await new Promise((resolve) => leaker.stdout.on('data', (d) => /created/.test(String(d)) && resolve()));
    leaker.kill('SIGKILL');
    await new Promise((r) => leaker.on('close', r));
    assert.equal(mock.state.items.length, 2, 'data was left behind');

    mock.state.seedForeign('Quarterly plan');
    const api = await open(mock);
    const recent = await sweep({ resources: itemResources, api, olderThanMs: 3_600_000 });
    assert.equal(recent.deleted.length, 0, 'fresh data of a possibly running suite is not touched');
    const later = await sweep({ resources: itemResources, api, olderThanMs: 0 });
    assert.equal(later.deleted.length, 2);
    assert.deepEqual(mock.state.items.map((i) => i.name), ['Quarterly plan']);
    await api.dispose();
  } finally {
    mock.close();
  }
});

test('discovery records endpoint templates from the UI, reads OpenAPI, and keeps no secret or value', async () => {
  const app = await startFixtureApp();
  try {
    const root = tempDir();
    const { chromium } = await import('@playwright/test');
    const browser = await chromium.launch();
    const context = await browser.newContext();
    const page = await context.newPage();
    await page.goto(app.url);
    await page.locator('input[type="password"]').fill('good');
    await page.locator('input:not([type="password"]):visible').first().fill('qa');
    await page.locator('button[type="submit"]').click();
    await page.locator('h1').waitFor();
    const state = path.join(root, 'state.json');
    await context.storageState({ path: state });
    await browser.close();

    const observed = await discover({ baseURL: app.url, storageState: state });
    const keys = observed.endpoints.map((e) => `${e.method} ${e.path}`).sort();
    assert.deepEqual(keys, ['GET /api/items', 'GET /api/settings/{id}']);
    const items = observed.endpoints.find((e) => e.path === '/api/items');
    assert.deepEqual(items.query, ['id', 'select']);
    assert.equal(items.authenticated, true);
    assert.deepEqual(observed.endpoints.find((e) => e.path === '/api/settings/{id}').count, 2, 'numeric and uuid ids collapse');
    assert.equal(observed.documented.length, 4);
    const text = JSON.stringify(observed);
    assert.ok(!text.includes('SECRET-TOKEN-123') && !text.includes('eq.123') && !text.includes('session=ok'));
    assert.ok(!text.includes('/logout'), 'logout links are not followed');
  } finally {
    app.close();
  }
});

test('OpenAPI 3 and Swagger 2 documents list their operations; prefixes are applied', () => {
  assert.deepEqual(documentedEndpoints({ openapi: '3.0.0', paths: { '/a': { get: {}, post: {} } } }), [{ method: 'GET', path: '/a' }, { method: 'POST', path: '/a' }]);
  assert.deepEqual(documentedEndpoints({ swagger: '2.0', basePath: '/v1', paths: { '/a/{id}': { delete: {} } } }), [{ method: 'DELETE', path: '/v1/a/{id}' }]);
  assert.deepEqual(documentedEndpoints({ swagger: '2.0', paths: { '/pages': { get: {} } } }, { prefix: '/rest/v1' }), [{ method: 'GET', path: '/rest/v1/pages' }]);
  assert.deepEqual(documentedEndpoints({}), []);
});

test('coverage separates API-test calls from seed-only calls and lists documented endpoints nobody saw', () => {
  const observed = mergeObserved(null, {
    generatedAt: '2026-01-01T00:00:00Z',
    origins: ['https://x.test'],
    endpoints: [
      { method: 'GET', origin: 'https://x.test', path: '/api/items', query: [], statuses: [200], count: 3, authenticated: true },
      { method: 'POST', origin: 'https://x.test', path: '/api/items', query: [], statuses: [201], count: 1, authenticated: true },
      { method: 'GET', origin: 'https://x.test', path: '/api/settings/{id}', query: [], statuses: [200], count: 1, authenticated: true },
    ],
    documented: [{ method: 'DELETE', path: '/api/items/{id}' }],
  });
  const merged = mergeObserved(observed, { generatedAt: '2026-01-02T00:00:00Z', origins: [], endpoints: [{ method: 'GET', origin: 'https://x.test', path: '/api/items', query: ['id'], statuses: [403], count: 2, authenticated: false }], documented: [] });
  assert.equal(merged.endpoints.find((e) => e.method === 'GET' && e.path === '/api/items').count, 5);
  assert.deepEqual(merged.endpoints.find((e) => e.method === 'GET' && e.path === '/api/items').statuses, [200, 403]);
  const report = coverageReport(merged, [
    { method: 'GET', path: '/api/items', status: 200, project: 'api' },
    { method: 'POST', path: '/api/items', status: 201, project: 'chromium' },
  ]);
  const row = (m, p) => report.rows.find((r) => r.method === m && r.path === p);
  assert.equal(row('GET', '/api/items').covered, true);
  assert.equal(row('POST', '/api/items').covered, false);
  assert.equal(row('POST', '/api/items').usedBySeedOnly, true);
  assert.equal(row('GET', '/api/settings/{id}').covered, false);
  assert.equal(report.documentedNotObserved.length, 1);
  const md = renderMarkdown(report, '2026-01-02T00:00:00Z');
  assert.match(md, /## Limits/);
  assert.match(md, /seed only/);
  assert.match(md, /Documented but not observed/);
});
