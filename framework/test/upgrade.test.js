import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { compareVersions, notesBetween, upgradeProject, adoptProject, manifestOf } from '../lib/upgrade.js';
import { readConfig } from '../lib/config.js';
import { runDoctor } from '../lib/doctor.js';
import { scaffoldedProject, tempDir } from './helpers.js';

const repo = path.resolve(path.dirname(new URL(import.meta.url).pathname), '../..');
const CURRENT = fs.readFileSync(path.join(repo, 'framework/VERSION'), 'utf8').trim();
const NEXT = (([major, minor]) => `${major}.${Number(minor) + 1}.0`)(CURRENT.split('.'));

/** A project as `init` leaves it: framework/ present (it came with the template), scaffold run, manifest recorded. */
function newProject() {
  const made = scaffoldedProject();
  fs.cpSync(path.join(repo, 'framework'), path.join(made.root, 'framework'), { recursive: true });
  const config = readConfig(made.root);
  config.files = manifestOf(made.root, ['.github/workflows/smoke.yml', '.github/workflows/regression.yml', '.github/workflows/api.yml', '.github/workflows/pages.yml', '.github/workflows/checks.yml']);
  fs.writeFileSync(path.join(made.root, '.qa-framework.json'), JSON.stringify(config));
  return made.root;
}

/** The "next release" of the template: same framework, a new version, a changelog entry and a changed workflow template. */
function nextRelease(version = NEXT) {
  const dir = tempDir('qa-template-');
  fs.cpSync(path.join(repo, 'framework'), path.join(dir, 'framework'), { recursive: true });
  fs.writeFileSync(path.join(dir, 'framework/VERSION'), `${version}\n`);
  fs.appendFileSync(path.join(dir, 'framework/CHANGELOG.md'), `\n## ${version}\n\n- Manual step: add the new fixture to fixtures/base.fixture.js.\n`);
  fs.writeFileSync(path.join(dir, 'framework/lib/new-feature.js'), 'export const added = true;\n');
  const suite = path.join(dir, 'framework/workflows/suite.yml');
  fs.writeFileSync(suite, fs.readFileSync(suite, 'utf8').replace('      - run: npm ci\n', '      - run: npm ci\n      - run: echo "from release ' + version + '"\n'));
  return dir;
}

test('versions compare numerically and changelog notes are cut between two versions', () => {
  assert.ok(compareVersions('1.10.0', '1.9.0') > 0);
  assert.equal(compareVersions('1.0.0', '1.0.0'), 0);
  const log = '# Log\n\n## 1.2.0\n\n- c\n\n## 1.1.0\n\n- b\n\n## 1.0.0\n\n- a\n';
  assert.deepEqual(notesBetween(log, '1.0.0', '1.2.0').map((n) => n.version), ['1.2.0', '1.1.0']);
  assert.deepEqual(notesBetween(log, '1.1.0', '1.1.0'), []);
});

test('a project is upgraded: framework replaced, pristine workflows regenerated, notes returned', async () => {
  const root = newProject();
  const oldConfig = readConfig(root);
  const result = await upgradeProject({ root, templateDir: nextRelease() });
  assert.equal(result.status, 'upgraded');
  assert.equal(`${result.from} -> ${result.to}`, `${CURRENT} -> ${NEXT}`);
  assert.ok(fs.existsSync(path.join(root, 'framework/lib/new-feature.js')));
  assert.match(fs.readFileSync(path.join(root, '.github/workflows/smoke.yml'), 'utf8'), new RegExp(`from release ${NEXT.replaceAll('.', '\\.')}`));
  assert.ok(result.updated.includes('.github/workflows/smoke.yml'));
  assert.deepEqual(result.kept, []);
  assert.match(result.notes[0].notes, /Manual step: add the new fixture/);
  const config = readConfig(root);
  assert.equal(config.frameworkVersion, NEXT);
  assert.notDeepEqual(config.files, oldConfig.files);
  assert.equal(fs.readFileSync(path.join(root, 'framework/VERSION'), 'utf8').trim(), NEXT);
  assert.deepEqual(runDoctor(root).filter((i) => i.level === 'error'), []);
  assert.equal((await upgradeProject({ root, templateDir: nextRelease() })).status, 'up-to-date');
});

test('a customized workflow is kept, and the new version is written aside for a manual diff', async () => {
  const root = newProject();
  const smoke = path.join(root, '.github/workflows/smoke.yml');
  fs.appendFileSync(smoke, '# our own change\n');
  const result = await upgradeProject({ root, templateDir: nextRelease() });
  assert.deepEqual(result.kept, ['.github/workflows/smoke.yml']);
  assert.match(fs.readFileSync(smoke, 'utf8'), /our own change/);
  assert.match(fs.readFileSync(path.join(root, '.qa-out/upgrade/.github/workflows/smoke.yml'), 'utf8'), new RegExp(`from release ${NEXT.replaceAll('.', '\\.')}`));
  assert.ok(result.updated.includes('.github/workflows/regression.yml'), 'the others are still updated');
});

test('edited framework files block the upgrade unless forced, and nothing is changed while blocked', async () => {
  const root = newProject();
  fs.appendFileSync(path.join(root, 'framework/lib/ids.js'), '// local hack\n');
  const blocked = await upgradeProject({ root, templateDir: nextRelease() });
  assert.equal(blocked.status, 'blocked');
  assert.deepEqual(blocked.modified, ['framework/lib/ids.js']);
  assert.equal(readConfig(root).frameworkVersion, CURRENT);
  assert.ok(!fs.existsSync(path.join(root, 'framework/lib/new-feature.js')));
  assert.equal((await upgradeProject({ root, templateDir: nextRelease(), force: true })).status, 'upgraded');
  assert.ok(!fs.readFileSync(path.join(root, 'framework/lib/ids.js'), 'utf8').includes('local hack'));
});

test('adopting an older project records what it can detect and never overwrites its files', async () => {
  const root = tempDir('qa-old-');
  fs.cpSync(path.join(repo, 'framework'), path.join(root, 'framework'), { recursive: true });
  fs.mkdirSync(path.join(root, 'auth'));
  fs.mkdirSync(path.join(root, '.github/workflows'), { recursive: true });
  fs.writeFileSync(path.join(root, 'auth/environment-profile.js'), "export const PROFILES = {\n  default: {\n    name: 'default',\n    credentialsEnvPrefix: 'TEST_USER',\n  },\n  viewer: {\n    name: 'viewer',\n    credentialsEnvPrefix: 'VIEWER_USER',\n  },\n};\n");
  fs.writeFileSync(path.join(root, '.github/workflows/smoke.yml'), 'name: my own smoke\n');
  fs.writeFileSync(path.join(root, 'package.json'), JSON.stringify({ name: 'old-project', dependencies: { '@playwright/test': '^1.49.0' } }));
  const result = await adoptProject({ root });
  assert.deepEqual(result.roles, ['default', 'viewer']);
  assert.equal(fs.readFileSync(path.join(root, '.github/workflows/smoke.yml'), 'utf8'), 'name: my own smoke\n');
  assert.ok(fs.existsSync(path.join(root, '.qa-out/adopt/.github/workflows/smoke.yml')));
  assert.ok(result.packageChanges.some((c) => c.startsWith('@playwright/test: ^1.49.0 -> 1.64.0')));
  assert.equal(readConfig(root).app.slug, 'old-project');
  await assert.rejects(adoptProject({ root }), /already exists/);
  assert.ok(result.manual.some((m) => /qaFixtures/.test(m)));
});
