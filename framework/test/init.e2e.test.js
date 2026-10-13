import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import http from 'node:http';
import { spawn, spawnSync } from 'node:child_process';
import { chromium, expect } from '@playwright/test';
import { buildSite } from '../lib/site/build.js';
import { fileURLToPath } from 'node:url';
import { startFixtureApp } from './fixture-app.js';
import { tempDir } from './helpers.js';

const repo = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

/** Copies the template the way "Use this template" would (no git history, no installed modules). */
function newProjectFromTemplate() {
  const root = tempDir('qa-new-project-');
  const skip = new Set(['node_modules', '.git', 'allure-results', 'allure-report', 'playwright-report', 'test-results', 'auth', '.env']);
  fs.cpSync(repo, root, { recursive: true, filter: (src) => !skip.has(path.basename(src)) });
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
  return root;
}

// Async on purpose: the fixture app lives in this process and must keep answering while the child runs.
const run = (root, cmd, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn(cmd, args, { cwd: root, env: { ...process.env, ...env, CI: '' } });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (status) => resolve({ status, stdout, stderr }));
  });

const hasJava = spawnSync('java', ['-version']).status === 0;

test('a project created from the template: init, doctor, the smoke suite, the report and its links work with no manual edits', { skip: !hasJava && 'Java is needed to generate Allure reports' }, async () => {
  const app = await startFixtureApp();
  try {
    const root = newProjectFromTemplate();
    const init = await run(root, 'node', ['scripts/init.mjs'], {
      INIT_URL: app.url,
      INIT_APP_NAME: 'Fixture App',
      INIT_USER_USERNAME: 'qa',
      INIT_USER_PASSWORD: 'good',
      INIT_ROLE_0: '',
      INIT_API: 'y',
      INIT_SLACK: 'n',
      INIT_JIRA: 'n',
      INIT_SECRETS: 'n',
      INIT_PUSH: 'n',
      INIT_SKIP_CLAUDE: '1',
      INIT_SKIP_INSTALL: '1',
    });
    assert.equal(init.status, 0, init.stdout + init.stderr);

    const envFile = fs.readFileSync(path.join(root, '.env'), 'utf8');
    assert.match(envFile, /^TEST_USER_USERNAME=qa$/m);
    assert.ok(!fs.readFileSync(path.join(root, '.gitignore'), 'utf8').split('\n').every((l) => l !== '.env'));

    // `npm install` rewrites the lockfile in a real project; the template's lock already pins the same versions.
    const doctor = await run(root, 'node', ['framework/bin/qa.mjs', 'doctor']);
    assert.equal(doctor.status, 0, doctor.stdout + doctor.stderr);

    const catalog = await run(root, 'npm', ['run', 'catalog']);
    assert.equal(catalog.status, 0, catalog.stdout + catalog.stderr);
    assert.equal(JSON.parse(fs.readFileSync(path.join(root, '.qa-out/catalog.json'), 'utf8')).stats.total, 4);

    const tests = await run(root, 'npx', ['playwright', 'test', '--project=chromium', '--retries=0'], { TCM_BASE_URL: 'https://example.test/tcm/' });
    assert.equal(tests.status, 0, tests.stdout + tests.stderr);
    assert.match(tests.stdout, /4 passed/);
    assert.ok(fs.existsSync(path.join(root, 'allure-results')), 'allure results are written');
    assert.ok(fs.existsSync(path.join(root, 'playwright-report/results.json')), 'json report is written');
    const results = fs.readdirSync(path.join(root, 'allure-results')).filter((f) => f.endsWith('-result.json')).map((f) => JSON.parse(fs.readFileSync(path.join(root, 'allure-results', f), 'utf8')));
    const tms = results.flatMap((r) => r.links.filter((l) => l.type === 'tms').map((l) => l.url));
    const sweepRun = await run(root, 'npm', ['run', 'sweep', '--', '--dry-run']);
    assert.equal(sweepRun.status, 0, sweepRun.stdout + sweepRun.stderr);
    assert.match(sweepRun.stdout, /sweep \(dry run\): checked 0/);

    const discoverRun = await run(root, 'npm', ['run', 'api:discover']);
    assert.equal(discoverRun.status, 0, discoverRun.stdout + discoverRun.stderr);
    assert.match(fs.readFileSync(path.join(root, 'docs/api-endpoints.md'), 'utf8'), /\| GET \| `\/api\/items` \|/);
    const publish = await run(root, 'npm', ['run', 'qa', '--', 'publish-prepare', '--suite', 'smoke'], { GITHUB_RUN_ID: '777', GITHUB_RUN_ATTEMPT: '1' });
    assert.equal(publish.status, 0, publish.stdout + publish.stderr);
    const prepared = path.join(root, 'qa-publish');
    const meta = JSON.parse(fs.readFileSync(path.join(prepared, 'meta.json'), 'utf8'));
    assert.deepEqual(meta.counts, { passed: 4, failed: 0, flaky: 0, skipped: 0 });
    const published = fs.readdirSync(prepared, { recursive: true });
    const media = published.filter((f) => /\.(zip|webm|mp4|png|jpe?g)$/.test(f));
    assert.deepEqual(media, [], 'no traces, videos or screenshots in the published report unless the project opts in');

    // Assemble the site like the Pages workflow does, then follow the TCM link into the real Allure report.
    const siteDir = path.join(root, 'site');
    const catalogJson = JSON.parse(fs.readFileSync(path.join(root, '.qa-out/catalog.json'), 'utf8'));
    buildSite({ siteDir, incomingDir: prepared, catalog: catalogJson, app: 'Fixture App', now: new Date(meta.finishedAt) });
    const server = http.createServer((req, res) => {
      const file = path.join(siteDir, decodeURIComponent(req.url.split('?')[0]).replace(/\/$/, '/index.html'));
      if (!file.startsWith(siteDir) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) return res.writeHead(404).end();
      res.writeHead(200, { 'content-type': { '.html': 'text/html', '.js': 'text/javascript', '.json': 'application/json', '.css': 'text/css', '.png': 'image/png' }[path.extname(file)] ?? 'application/octet-stream' }).end(fs.readFileSync(file));
    });
    await new Promise((r) => server.listen(0, '127.0.0.1', r));
    const browser = await chromium.launch();
    try {
      const page = await browser.newPage();
      await page.goto(`http://127.0.0.1:${server.address().port}/tcm/#/case/TC0001`);
      await page.getByRole('link', { name: 'Open in the latest smoke report' }).click();
      await page.locator('.pane__title', { hasText: 'TC0001 - login screen asks for credentials' }).waitFor({ timeout: 20_000 });
      assert.match(page.url(), /#suites\/\w+\/\w+$/, 'the link opens the test result, not just the report');
      await page.goto(`http://127.0.0.1:${server.address().port}/`);
      await expect(page.getByRole('link', { name: /smoke/ }).first(), 'the portal lists the latest run').toBeVisible();
    } finally {
      await browser.close();
      server.close();
    }
    assert.deepEqual(tms.sort(), [1, 2, 3, 4].map((n) => `https://example.test/tcm/#/case/TC000${n}`));
  } finally {
    app.close();
  }
});
