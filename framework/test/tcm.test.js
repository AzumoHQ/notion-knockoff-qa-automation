import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { chromium, expect } from '@playwright/test';
import { parseRoute, routeFor, filterCases, buildTree } from '../tcm/model.js';

const tcmDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../tcm');
const cases = [
  { id: 'TC0001', title: 'Create a page', area: 'Pages', feature: 'Create', type: 'ui', priority: 'high', automation: 'automated', draft: false, tags: [], defect: null, preconditions: ['Signed in'], steps: ['Click New page'], expected: ['A page appears'], spec: { file: 'tests/p.spec.js', line: 4, tests: 1, projects: ['chromium'] } },
  { id: 'TC0002', title: 'List pages by API', area: 'Pages', feature: 'List', type: 'api', priority: 'medium', automation: 'automated', draft: false, tags: [], defect: null, preconditions: [], steps: ['GET /pages'], expected: ['200 and an array'], spec: null },
  { id: 'TC0003', title: '<img src=x onerror=alert(1)>', area: 'Auth', feature: 'Login', type: 'ui', priority: 'low', automation: 'manual', draft: true, tags: [], defect: 'DEF-01', preconditions: [], steps: [], expected: [], spec: null },
];
const catalog = { generatedAt: '2026-01-01T00:00:00Z', stats: { total: 3 }, areas: [{ name: 'Pages', features: [{ name: 'Create', cases: ['TC0001'] }, { name: 'List', cases: ['TC0002'] }] }, { name: 'Auth', features: [{ name: 'Login', cases: ['TC0003'] }] }], cases };

test('routes round-trip, including names with spaces and slashes', () => {
  assert.deepEqual(parseRoute(routeFor.feature('ui', 'A / B', 'C d')), { view: 'list', type: 'ui', area: 'A / B', feature: 'C d' });
  assert.deepEqual(parseRoute(routeFor.type('api')), { view: 'list', type: 'api' });
  assert.deepEqual(parseRoute(routeFor.case('TC0001')), { view: 'case', id: 'TC0001' });
  assert.deepEqual(parseRoute(''), { view: 'list' });
});

test('search needs every word and also looks into steps; filters combine', () => {
  assert.deepEqual(filterCases(cases, { query: 'click new' }).map((c) => c.id), ['TC0001']);
  assert.deepEqual(filterCases(cases, { query: 'pages api' }).map((c) => c.id), ['TC0002']);
  assert.deepEqual(filterCases(cases, { area: 'Pages', type: 'api' }).map((c) => c.id), ['TC0002']);
  assert.deepEqual(filterCases(cases, { automation: 'manual' }).map((c) => c.id), ['TC0003']);
});

test('the TCM page browses areas, searches, opens a case and never executes catalog text', async () => {
  const files = { '/catalog.json': JSON.stringify(catalog) };
  const server = http.createServer((req, res) => {
    const name = req.url === '/' ? '/index.html' : req.url.split('?')[0];
    if (files[name]) return res.writeHead(200, { 'content-type': 'application/json' }).end(files[name]);
    const file = path.join(tcmDir, name);
    if (!file.startsWith(tcmDir) || !fs.existsSync(file)) return res.writeHead(404).end();
    res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.css': 'text/css' }[path.extname(file)] }).end(fs.readFileSync(file));
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const browser = await chromium.launch();
  try {
    const page = await browser.newPage();
    let dialogs = 0;
    page.on('dialog', (d) => { dialogs++; d.dismiss(); });
    await page.goto(`http://127.0.0.1:${server.address().port}/`);
    await page.getByRole('link', { name: 'All cases (3)' }).waitFor();
    await expect(page.locator('tbody tr')).toHaveCount(3);

    // UI and API are the top level; every other area is a subfolder of one of them.
    await expect(page.locator('nav a.type')).toHaveText(['UI (2)', 'API (1)']);
    await page.getByRole('link', { name: 'API (1)' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('link', { name: 'Pages (1)' }).first().click();
    await expect(page.locator('tbody tr')).toHaveCount(1);
    await page.getByRole('link', { name: 'UI (2)' }).click();
    await expect(page.locator('tbody tr')).toHaveCount(2);

    await page.getByRole('searchbox', { name: 'Search cases' }).fill('click new');
    await expect(page.locator('tbody tr')).toHaveCount(1);

    await page.getByRole('link', { name: 'TC0001' }).click();
    await page.getByRole('heading', { name: /TC0001 · Create a page/ }).waitFor();
    await expect(page.getByText('Click New page')).toBeVisible();
    await expect(page.getByText('tests/p.spec.js:4')).toBeVisible();
    await expect(page.getByText(/Latest .* report/)).toHaveCount(0);

    await page.goto(`http://127.0.0.1:${server.address().port}/#/case/TC0003`);
    await page.getByRole('heading', { name: /TC0003/ }).waitFor();
    assert.equal(dialogs, 0);
    await expect(page.getByText('<img src=x onerror=alert(1)>').first()).toBeVisible();
    await expect(page.locator('img[src="x"]')).toHaveCount(0);
  } finally {
    await browser.close();
    server.close();
  }
});

test('the tree puts UI first, API second, and nests areas and features under them', () => {
  const tree = buildTree(cases);
  assert.deepEqual(tree.map((g) => [g.type, g.count]), [['ui', 2], ['api', 1]]);
  assert.deepEqual(tree[0].areas.map((a) => a.name), ['Pages', 'Auth']);
});
