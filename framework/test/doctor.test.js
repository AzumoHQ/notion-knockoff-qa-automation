import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { runDoctor } from '../lib/doctor.js';
import { scaffoldedProject } from './helpers.js';

const errors = (root) => runDoctor(root).filter((i) => i.level === 'error').map((i) => i.message);

test('a freshly scaffolded project has no errors', () => {
  const { root } = scaffoldedProject();
  assert.deepEqual(errors(root), []);
});

test('flags a Playwright range, a stale lockfile and a missing script', () => {
  const { root } = scaffoldedProject();
  const pkgFile = path.join(root, 'package.json');
  const pkg = JSON.parse(fs.readFileSync(pkgFile, 'utf8'));
  pkg.dependencies['@playwright/test'] = '^1.49.0';
  fs.writeFileSync(pkgFile, JSON.stringify(pkg));
  assert.ok(errors(root).some((m) => /exact version/.test(m)));

  const wf = path.join(root, '.github/workflows/smoke.yml');
  fs.appendFileSync(wf, '      - run: npm run does-not-exist\n      - run: node scripts/notify-slack.sh\n');
  const messages = errors(root);
  assert.ok(messages.some((m) => /does-not-exist/.test(m)));
  assert.ok(messages.some((m) => /notify-slack\.sh/.test(m)));
});

test('flags secrets that init never sets and MCP steps nothing uses', () => {
  const { root } = scaffoldedProject();
  const wf = path.join(root, '.github/workflows/smoke.yml');
  fs.appendFileSync(wf, '        EXTRA: ${{ secrets.TEST_USER_EMAIL }}\n      - run: npx @playwright/mcp@latest\n');
  const messages = errors(root);
  assert.ok(messages.some((m) => /TEST_USER_EMAIL/.test(m)));
  assert.ok(messages.some((m) => /MCP/.test(m)));
});

test('flags a missing .gitignore entry for secrets', () => {
  const { root } = scaffoldedProject();
  fs.writeFileSync(path.join(root, '.gitignore'), 'node_modules/\n');
  assert.ok(errors(root).some((m) => /\.env/.test(m)));
});
