import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { spawn } from 'node:child_process';
import { renderPlaywrightConfig } from '../lib/scaffold.js';
import { sampleConfig, tempDir } from './helpers.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const run = (root, args, env = {}) =>
  new Promise((resolve) => {
    const child = spawn('npx', ['playwright', 'test', ...args], { cwd: root, env: { ...process.env, ...env, CI: '' } });
    let out = '';
    child.stdout.on('data', (d) => (out += d));
    child.stderr.on('data', (d) => (out += d));
    child.on('close', (status) => resolve({ status, out }));
  });

test('visual checks: skipped by default, baselines are explicit, a changed page fails, a masked change does not', async () => {
  const root = tempDir('qa-visual-');
  fs.symlinkSync(path.join(repo, 'node_modules'), path.join(root, 'node_modules'));
  fs.cpSync(path.join(repo, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.mkdirSync(path.join(root, 'tests'));
  fs.mkdirSync(path.join(root, 'utils'));
  fs.mkdirSync(path.join(root, 'auth'));
  fs.copyFileSync(path.join(repo, 'framework/templates/visual.js'), path.join(root, 'utils/visual.js'));
  fs.writeFileSync(path.join(root, 'package.json'), '{"type":"module"}');
  fs.writeFileSync(path.join(root, 'auth/environment-profile.js'), "export const PROFILES = { default: { name: 'default', storageStatePath: 'auth/none.json' } };\n");
  fs.writeFileSync(path.join(root, 'playwright.config.js'), renderPlaywrightConfig(sampleConfig({ visual: true })).replace("globalSetup: './auth/global-setup.js',", '').replace(/storageState: [^,]+,/, '').replace(/reporter: \[[\s\S]*?\n {2}\],/, "reporter: 'list',"));
  fs.writeFileSync(path.join(root, 'tests/visual.spec.js'), `import { test } from '@playwright/test';
import { expectVisual } from '../utils/visual.js';
test('TC0001 - card looks right @visual', async ({ page }) => {
  await page.setContent(process.env.CARD ?? '<h1>Card</h1><p>stable text</p><span id="clock">10:00</span>');
  await expectVisual(page, 'card', { mask: [page.locator('#clock')] });
});
test('TC0002 - plain check', async () => {});
`);

  const skipped = await run(root, ['--project=chromium']);
  assert.match(skipped.out, /1 passed/, 'visual tests do not run without VISUAL=1');

  const missing = await run(root, ['--project=chromium'], { VISUAL: '1' });
  assert.notEqual(missing.status, 0, 'no baseline: the check fails instead of passing silently');

  const update = await run(root, ['--project=chromium', '--update-snapshots'], { VISUAL: '1' });
  assert.equal(update.status, 0, update.out);
  const baselines = [];
  const walk = (d) => fs.readdirSync(d, { withFileTypes: true }).forEach((e) => (e.isDirectory() ? walk(path.join(d, e.name)) : baselines.push(path.join(d, e.name))));
  walk(path.join(root, 'tests/__screenshots__'));
  assert.equal(baselines.length, 1);
  assert.match(baselines[0], /-(linux|darwin|win32)\.png$/, 'baselines are per platform');

  assert.equal((await run(root, ['--project=chromium'], { VISUAL: '1' })).status, 0, 'unchanged page passes');
  const changed = await run(root, ['--project=chromium'], { VISUAL: '1', CARD: '<h1>Changed</h1><p style="font-size:40px">a clearly different card with much more text</p><span id="clock">10:00</span>' });
  assert.notEqual(changed.status, 0, 'a real change fails');
  assert.equal((await run(root, ['--project=chromium'], { VISUAL: '1', CARD: '<h1>Card</h1><p>stable text</p><span id="clock">23:59</span>' })).status, 0, 'a masked change is ignored');
});
