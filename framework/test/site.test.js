import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { collectSecrets, redactText, redactDeep } from '../lib/site/redact.js';
import { sanitizeAllureResults } from '../lib/site/sanitize.js';
import { buildMeta, preparePublicRun } from '../lib/site/prepare.js';
import { findLeaks } from '../lib/site/leaks.js';
import { allureCaseLinks } from '../lib/site/allure-links.js';
import { addRuns, buildSite, listRuns, pruneRuns } from '../lib/site/build.js';
import { publishToBranch, squashBranch } from '../lib/site/publish.js';
import { tempDir } from './helpers.js';

const JWT = 'eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.abcdefghijk123456';

test('secrets, account names, JWTs, bearer tokens and secret query values are removed from text', () => {
  const secrets = collectSecrets({ TEST_USER_PASSWORD: 'p4ss-w0rd!', TEST_USER_USERNAME: 'qa.user@example.test', VERCEL_AUTOMATION_BYPASS_SECRET: 'bypass-123456', BASE_URL: 'https://app.test', SHORT_TOKEN: 'abc' });
  const text = `login qa.user@example.test with p4ss-w0rd! header x-bypass: bypass-123456 jwt ${JWT} Authorization: Bearer abcdefghijklmnop1234 url /rest?apikey=SECRETKEY&select=* https://app.test`;
  const out = redactText(text, secrets);
  for (const leaked of ['qa.user@example.test', 'p4ss-w0rd!', 'bypass-123456', JWT, 'abcdefghijklmnop1234', 'SECRETKEY']) assert.ok(!out.includes(leaked), `${leaked} must be gone`);
  assert.match(out, /\[username\]/);
  assert.match(out, /select=\*/, 'harmless query parameters stay');
  assert.match(out, /https:\/\/app\.test/, 'the public base URL is not treated as a secret');
  assert.deepEqual(redactDeep({ a: ['p4ss-w0rd!', { b: 'x' }] }, secrets), { a: ['[redacted]', { b: 'x' }] });
});

function allureResults(dir) {
  fs.mkdirSync(dir, { recursive: true });
  const att = (name, source, type) => ({ name, source, type });
  fs.writeFileSync(path.join(dir, 'a-result.json'), JSON.stringify({
    name: 'TC0001 - x',
    statusDetails: { message: 'password p4ss-w0rd! rejected', trace: `at ${JWT}` },
    attachments: [att('screenshot', 's1-attachment.png', 'image/png'), att('trace', 't1-attachment.zip', 'application/zip'), att('video', 'v1-attachment.webm', 'video/webm'), att('heal-evidence', 'h1-attachment.json', 'application/json'), att('heal-proposal', 'h2-attachment.json', 'application/json'), att('error-context', 'e1-attachment.md', 'text/markdown')],
    steps: [{ name: 'step', attachments: [att('trace', 't2-attachment.zip', 'application/zip'), att('shot', 's2-attachment.png', 'image/png')], steps: [] }],
  }));
  fs.writeFileSync(path.join(dir, 'a-container.json'), JSON.stringify({ befores: [{ name: 'b', attachments: [att('video', 'v2-attachment.webm', 'video/webm')] }] }));
  for (const f of ['s1-attachment.png', 't1-attachment.zip', 'v1-attachment.webm', 'h1-attachment.json', 'h2-attachment.json', 'e1-attachment.md', 't2-attachment.zip', 's2-attachment.png', 'v2-attachment.webm', 'orphan-attachment.png']) fs.writeFileSync(path.join(dir, f), f.endsWith('.json') ? '{"user":"p4ss-w0rd!"}' : 'x');
  fs.writeFileSync(path.join(dir, 'environment.properties'), 'host=ci\ntoken=p4ss-w0rd!\n');
}

test('sanitizing drops traces, videos, snapshots and unreferenced files, and rewrites references and texts', () => {
  const root = tempDir();
  allureResults(path.join(root, 'in'));
  const secrets = collectSecrets({ TEST_USER_PASSWORD: 'p4ss-w0rd!' });
  const { dropped } = sanitizeAllureResults({ src: path.join(root, 'in'), dest: path.join(root, 'out'), secrets });
  const files = fs.readdirSync(path.join(root, 'out')).sort();
  assert.deepEqual(files, ['a-container.json', 'a-result.json', 'environment.properties', 'h2-attachment.json']);
  assert.deepEqual(dropped.sort(), ['error-context', 'heal-evidence', 'screenshot', 'shot', 'trace', 'trace', 'video', 'video']);
  const result = JSON.parse(fs.readFileSync(path.join(root, 'out/a-result.json'), 'utf8'));
  assert.deepEqual(result.attachments.map((a) => a.name), ['heal-proposal']);
  assert.deepEqual(result.steps[0].attachments, []);
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(root, 'out/a-container.json'), 'utf8')).befores[0].attachments, []);
  const everything = files.map((f) => fs.readFileSync(path.join(root, 'out', f), 'utf8')).join('\n');
  assert.ok(!everything.includes('p4ss-w0rd!') && !everything.includes(JWT));
});

test('screenshots are published only when the project opts in; other file types never are', () => {
  const root = tempDir();
  allureResults(path.join(root, 'in'));
  const att = (name, source, type) => ({ name, source, type });
  const extra = JSON.parse(fs.readFileSync(path.join(root, 'in/a-result.json'), 'utf8'));
  extra.attachments.push(att('page', 'p1-attachment.html', 'text/html'), att('logo', 'l1-attachment.svg', 'image/svg+xml'), att('doc', 'd1-attachment.pdf', 'application/pdf'), att('blob', 'b1-attachment.bin', 'application/octet-stream'), att('log', 'g1-attachment.txt', 'text/plain'));
  fs.writeFileSync(path.join(root, 'in/a-result.json'), JSON.stringify(extra));
  for (const f of ['p1-attachment.html', 'l1-attachment.svg', 'd1-attachment.pdf', 'b1-attachment.bin']) fs.writeFileSync(path.join(root, 'in', f), '<script>alert(1)</script>');
  fs.writeFileSync(path.join(root, 'in/g1-attachment.txt'), 'password p4ss-w0rd!');
  const secrets = collectSecrets({ TEST_USER_PASSWORD: 'p4ss-w0rd!' });
  sanitizeAllureResults({ src: path.join(root, 'in'), dest: path.join(root, 'out'), secrets, screenshots: true });
  const kept = fs.readdirSync(path.join(root, 'out')).sort();
  assert.ok(kept.includes('s1-attachment.png') && kept.includes('s2-attachment.png'), 'opted-in screenshots stay');
  for (const gone of ['p1-attachment.html', 'l1-attachment.svg', 'd1-attachment.pdf', 'b1-attachment.bin', 't1-attachment.zip', 'v1-attachment.webm']) assert.ok(!kept.includes(gone), `${gone} is withheld`);
  assert.equal(fs.readFileSync(path.join(root, 'out/g1-attachment.txt'), 'utf8'), 'password [redacted]', 'text attachments are redacted');
});

test('encoded copies of a secret are redacted too (URL-encoded, JSON-escaped, base64)', () => {
  const password = 'p4ss w0rd"/&';
  const secrets = collectSecrets({ TEST_USER_PASSWORD: password });
  const text = [encodeURIComponent(password), JSON.stringify(password), Buffer.from(password).toString('base64'), password].join(' | ');
  const out = redactText(text, secrets);
  assert.equal(out.replace(/\[redacted\]/g, '').replace(/[ |"]/g, ''), '', out);
});

test('the leak scan finds secrets and token-shaped text left in a folder, without reporting the value', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/a.json'), '{"x":"clean"}');
  fs.writeFileSync(path.join(dir, 'data/b.json'), '{"x":"has p4ss-w0rd! inside"}');
  fs.writeFileSync(path.join(dir, 'c.html'), `<p>${JWT}</p>`);
  fs.writeFileSync(path.join(dir, 'd.txt'), 'Authorization: Bearer abcdefghijklmnop1234');
  fs.writeFileSync(path.join(dir, 'e.txt'), 'Authorization: Bearer [redacted] and apikey=[redacted]');
  const found = findLeaks(dir, collectSecrets({ TEST_USER_PASSWORD: 'p4ss-w0rd!' }));
  assert.deepEqual(found.map((f) => `${f.file}: ${f.what}`).sort(), ['c.html: a JWT', 'd.txt: a bearer token', 'data/b.json: a secret value'].sort());
  assert.ok(!JSON.stringify(found).includes('p4ss-w0rd!'));
});

test('publish-prepare refuses to produce a report when a secret survives sanitizing', () => {
  const root = tempDir();
  allureResults(path.join(root, 'allure-results'));
  const env = { TEST_USER_PASSWORD: 'p4ss-w0rd!' };
  const generate = ({ report }) => {
    fs.mkdirSync(report, { recursive: true });
    fs.writeFileSync(path.join(report, 'index.html'), '<html></html>');
    fs.writeFileSync(path.join(report, 'summary.json'), '{"leak":"p4ss-w0rd!"}');
  };
  assert.throws(() => preparePublicRun({ suite: 'smoke', root, env, generate }), /Nothing was published: 1 possible leak/);
  assert.ok(!fs.existsSync(path.join(root, 'qa-publish')), 'the folder to upload is removed');
  const ok = preparePublicRun({ suite: 'smoke', root, env, generate: ({ report }) => { fs.mkdirSync(report, { recursive: true }); fs.writeFileSync(path.join(report, 'index.html'), '<html></html>'); } });
  assert.equal(ok.meta.suite, 'smoke');
  assert.ok(fs.existsSync(path.join(root, 'qa-publish/meta.json')));
});

test('run metadata comes from Playwright stats and the CI environment', () => {
  const meta = buildMeta({ suite: 'smoke', results: { stats: { startTime: '2026-01-01T10:00:00.000Z', duration: 60000, expected: 5, unexpected: 1, flaky: 2, skipped: 1 } }, env: { GITHUB_RUN_ID: '42', GITHUB_RUN_ATTEMPT: '2', GITHUB_SHA: 'abcdef123456', GITHUB_REPOSITORY: 'o/r', GITHUB_EVENT_NAME: 'schedule', GITHUB_REF_NAME: 'main' } });
  assert.equal(meta.status, 'failed');
  assert.deepEqual(meta.counts, { passed: 5, failed: 1, flaky: 2, skipped: 1 });
  assert.equal(meta.finishedAt, '2026-01-01T10:01:00.000Z');
  assert.equal(meta.runUrl, 'https://github.com/o/r/actions/runs/42');
  assert.equal(buildMeta({ suite: 's', results: null, env: {} }).status, 'passed');
});

test('case links are read from the Allure suites tree, and a broken tree gives none', () => {
  const dir = tempDir();
  fs.mkdirSync(path.join(dir, 'data'));
  fs.writeFileSync(path.join(dir, 'data/suites.json'), JSON.stringify({ name: 'suites', children: [{ name: 'g', children: [{ name: 'TC0001 - a', uid: 'u1', parentUid: 'p1' }, { name: 'TC0001 - a [b]', uid: 'u2', parentUid: 'p1' }, { name: 'no id', uid: 'u3', parentUid: 'p1' }] }] }));
  assert.deepEqual(allureCaseLinks(dir), { TC0001: '#suites/p1/u1' });
  fs.writeFileSync(path.join(dir, 'data/suites.json'), '{broken');
  assert.deepEqual(allureCaseLinks(dir), {});
});

function incomingRun(root, name, { suite = 'smoke', runId = '100', attempt = '1', finishedAt = '2026-02-10T10:00:00.000Z', status = 'passed', links = { TC0001: '#suites/p/u' } } = {}) {
  const dir = path.join(root, name);
  fs.mkdirSync(path.join(dir, 'allure-report'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'allure-report/index.html'), '<html>report</html>');
  fs.writeFileSync(path.join(dir, 'meta.json'), JSON.stringify({ suite, runId, attempt, finishedAt, startedAt: finishedAt, status, sha: 'abc1234', event: 'schedule', counts: { passed: 3, failed: status === 'failed' ? 1 : 0, flaky: 0, skipped: 0 }, runUrl: 'https://github.com/o/r/actions/runs/100' }));
  fs.writeFileSync(path.join(dir, 'case-links.json'), JSON.stringify(links));
  fs.writeFileSync(path.join(dir, 'secrets.txt'), 'not in the allow list');
  fs.writeFileSync(path.join(dir, 'diagnosis.md'), '## Failure diagnosis\n<script>alert(1)</script>\n');
  fs.writeFileSync(path.join(dir, 'heal-report.md'), '## Healing\n');
  fs.writeFileSync(path.join(dir, 'heal.patch'), '--- a/x\n+++ b/x\n');
  return dir;
}
const catalog = { generatedAt: '2026-02-10T00:00:00Z', stats: { total: 1 }, areas: [], cases: [] };
const NOW = new Date('2026-02-12T00:00:00Z');

test('the site keeps each run in its own folder, one per suite and run, and copies only known files', () => {
  const root = tempDir();
  incomingRun(path.join(root, 'in'), 'site-run-smoke');
  incomingRun(path.join(root, 'in'), 'site-run-regression', { suite: 'regression', runId: '101' });
  const site = path.join(root, 'site');
  buildSite({ siteDir: site, incomingDir: path.join(root, 'in'), catalog, app: 'My <App>', now: NOW });
  assert.ok(fs.existsSync(path.join(site, 'runs/smoke/100-1/allure/index.html')));
  assert.ok(fs.existsSync(path.join(site, 'runs/regression/101-1/meta.json')));
  assert.ok(!fs.existsSync(path.join(site, 'runs/smoke/100-1/secrets.txt')), 'unknown files are never copied');
  assert.ok(fs.existsSync(path.join(site, 'latest/smoke/index.html')));
  assert.match(fs.readFileSync(path.join(site, 'latest/smoke/index.html'), 'utf8'), /runs\/smoke\/100-1\/allure\/index\.html/);
  const html = fs.readFileSync(path.join(site, 'runs/smoke/100-1/diagnosis.html'), 'utf8');
  assert.match(html, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/, 'report text is escaped');
  assert.doesNotMatch(html, /<script>/);
  const portal = fs.readFileSync(path.join(site, 'index.html'), 'utf8');
  assert.match(portal, /diagnosis\.html/);
  assert.match(portal, /heal-report\.html/);
  assert.match(portal, /heal\.patch/);
  assert.match(portal, /My &lt;App&gt;/);
  assert.match(portal, /href="tcm\/"/);
  assert.match(portal, /kept 15 days/);
  const siteJson = JSON.parse(fs.readFileSync(path.join(site, 'tcm/site.json'), 'utf8'));
  assert.equal(siteJson.caseLinks.TC0001.smoke, '../runs/smoke/100-1/allure/index.html#suites/p/u');
  assert.equal(siteJson.latest.regression, '../latest/regression/');
  assert.deepEqual(JSON.parse(fs.readFileSync(path.join(site, 'tcm/catalog.json'), 'utf8')), catalog);
});

test('a second run of the same suite never overwrites the first; the latest points to the newest', () => {
  const root = tempDir();
  incomingRun(path.join(root, 'in1'), 'a', { runId: '100', finishedAt: '2026-02-10T10:00:00.000Z' });
  incomingRun(path.join(root, 'in2'), 'a', { runId: '101', finishedAt: '2026-02-11T10:00:00.000Z', status: 'failed' });
  const site = path.join(root, 'site');
  buildSite({ siteDir: site, incomingDir: path.join(root, 'in1'), catalog, now: NOW });
  buildSite({ siteDir: site, incomingDir: path.join(root, 'in2'), catalog, now: NOW });
  assert.deepEqual(listRuns(site).map((r) => r.runId), ['101', '100']);
  assert.match(fs.readFileSync(path.join(site, 'latest/smoke/index.html'), 'utf8'), /101-1/);
});

test('runs older than the retention are removed, together with empty suites, and recent ones stay', () => {
  const root = tempDir();
  incomingRun(path.join(root, 'in'), 'old', { suite: 'regression', runId: '1', finishedAt: '2026-01-20T10:00:00.000Z' });
  incomingRun(path.join(root, 'in'), 'edge', { runId: '2', finishedAt: '2026-01-28T00:00:01.000Z' });
  incomingRun(path.join(root, 'in'), 'new', { runId: '3', finishedAt: '2026-02-11T10:00:00.000Z' });
  const site = path.join(root, 'site');
  addRuns({ siteDir: site, incomingDir: path.join(root, 'in') });
  const removed = pruneRuns({ siteDir: site, retentionDays: 15, now: NOW });
  assert.deepEqual(removed, ['runs/regression/1-1']);
  assert.ok(!fs.existsSync(path.join(site, 'runs/regression')));
  assert.deepEqual(listRuns(site).map((r) => r.runId).sort(), ['2', '3']);
  const cleaned = buildSite({ siteDir: site, catalog, now: new Date('2026-03-30T00:00:00Z') });
  assert.equal(cleaned.runs, 0, 'with no new runs, a later cleanup still expires everything');
  assert.match(fs.readFileSync(path.join(site, 'index.html'), 'utf8'), /No runs published yet/);
});

test('runs with unexpected identifiers are refused (no path tricks)', () => {
  const root = tempDir();
  incomingRun(path.join(root, 'in'), 'evil', { suite: '../../etc' });
  assert.throws(() => addRuns({ siteDir: path.join(root, 'site'), incomingDir: path.join(root, 'in') }), /unexpected identifiers/);
  incomingRun(path.join(root, 'in2'), 'evil', { runId: '1; rm -rf' });
  assert.throws(() => addRuns({ siteDir: path.join(root, 'site'), incomingDir: path.join(root, 'in2') }), /unexpected identifiers/);
});

const git = (cwd, ...args) => execFileSync('git', args, { cwd, encoding: 'utf8' }).trim();
function repoWithRemote() {
  const root = tempDir();
  const bare = path.join(root, 'remote.git');
  const work = path.join(root, 'work');
  fs.mkdirSync(work);
  git(root, 'init', '-q', '--bare', bare);
  git(work, 'init', '-q', '-b', 'main');
  git(work, 'remote', 'add', 'origin', bare);
  fs.writeFileSync(path.join(work, 'README.md'), 'x');
  git(work, 'add', '-A');
  git(work, '-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'init');
  return { root, bare, work };
}
const filesOnBranch = (bare) => git(bare, 'ls-tree', '-r', '--name-only', 'qa-reports').split('\n').filter(Boolean).sort();

test('publishing creates the branch, and a second publish adds to it', () => {
  const { bare, work } = repoWithRemote();
  const first = publishToBranch({ root: work, message: 'one', apply: (dir) => fs.writeFileSync(path.join(dir, 'a.txt'), 'a') });
  assert.deepEqual(first, { status: 'pushed', attempts: 1 });
  const second = publishToBranch({ root: work, message: 'two', apply: (dir) => fs.writeFileSync(path.join(dir, 'b.txt'), 'b') });
  assert.equal(second.status, 'pushed');
  assert.deepEqual(filesOnBranch(bare), ['a.txt', 'b.txt']);
  assert.equal(publishToBranch({ root: work, message: 'same', apply: () => {} }).status, 'unchanged');
});

test('two runs publishing at the same time both end up on the branch (retry on rejected push)', () => {
  const { root, bare, work } = repoWithRemote();
  publishToBranch({ root: work, message: 'seed', apply: (dir) => fs.writeFileSync(path.join(dir, 'seed.txt'), 's') });
  // Another runner pushes between our fetch and our push.
  const other = path.join(root, 'other');
  git(root, 'clone', '-q', bare, other);
  let calls = 0;
  const result = publishToBranch({
    root: work,
    message: 'mine',
    apply: (dir) => {
      calls++;
      fs.writeFileSync(path.join(dir, 'mine.txt'), 'm');
      if (calls === 1) {
        git(other, 'checkout', '-q', 'qa-reports');
        fs.writeFileSync(path.join(other, 'theirs.txt'), 't');
        git(other, 'add', '-A');
        git(other, '-c', 'user.name=o', '-c', 'user.email=o@o', 'commit', '-qm', 'theirs');
        git(other, 'push', '-q', 'origin', 'qa-reports');
      }
    },
  });
  assert.equal(result.status, 'pushed');
  assert.equal(result.attempts, 2);
  assert.deepEqual(filesOnBranch(bare), ['mine.txt', 'seed.txt', 'theirs.txt']);
});

test('a long history is squashed into one commit with the same files', () => {
  const { bare, work } = repoWithRemote();
  for (let i = 0; i < 4; i++) publishToBranch({ root: work, message: `r${i}`, apply: (dir) => fs.writeFileSync(path.join(dir, `f${i}.txt`), String(i)) });
  assert.deepEqual(squashBranch({ root: work, keepCommits: 100 }), { squashed: false, commits: 5 });
  assert.deepEqual(squashBranch({ root: work, keepCommits: 2 }), { squashed: true, commits: 5 });
  assert.equal(git(bare, 'rev-list', '--count', 'qa-reports'), '1');
  assert.equal(filesOnBranch(bare).length, 4);
});
