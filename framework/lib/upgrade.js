import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { pathToFileURL } from 'node:url';
import { readConfig, writeConfig, defaultConfig } from './config.js';

export const TEMPLATE_REPO = 'AzumoHQ/ai-driven-automation-framework-template';

export const hashContent = (content) => crypto.createHash('sha256').update(content).digest('hex');
const hashFile = (file) => hashContent(fs.readFileSync(file));

function* walk(dir, base = dir) {
  for (const entry of fs.existsSync(dir) ? fs.readdirSync(dir, { withFileTypes: true }) : []) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) yield* walk(full, base);
    else yield path.relative(base, full).split(path.sep).join('/');
  }
}

/** Hashes of every file the framework owns in a project: `framework/**` and the workflows it generated. */
export function manifestOf(root, generated = []) {
  const files = {};
  for (const rel of walk(path.join(root, 'framework'), root)) files[rel] = hashFile(path.join(root, rel));
  for (const rel of generated) if (fs.existsSync(path.join(root, rel))) files[rel] = hashFile(path.join(root, rel));
  return files;
}

export function compareVersions(a, b) {
  const pa = a.split('.').map(Number);
  const pb = b.split('.').map(Number);
  for (let i = 0; i < 3; i++) if ((pa[i] ?? 0) !== (pb[i] ?? 0)) return (pa[i] ?? 0) - (pb[i] ?? 0);
  return 0;
}

/** Changelog entries newer than `from` up to and including `to`. */
export function notesBetween(changelog, from, to) {
  return changelog
    .split(/^## /m)
    .slice(1)
    .map((block) => {
      const [head, ...rest] = block.split('\n');
      return { version: head.trim(), notes: rest.join('\n').trim() };
    })
    .filter((e) => /^\d+\.\d+\.\d+$/.test(e.version) && compareVersions(e.version, from) > 0 && compareVersions(e.version, to) <= 0);
}

const readVersion = (dir) => fs.readFileSync(path.join(dir, 'framework/VERSION'), 'utf8').trim();

/**
 * Brings a project up to the framework version found in `templateDir`:
 *  - `framework/` is replaced, unless someone edited it (then it stops and lists the files; `force` overrides);
 *  - generated workflows are regenerated, unless the project customized them (the new version is written to
 *    .qa-out/upgrade/ for a manual diff);
 *  - pinned dependencies and scripts in package.json are brought in line.
 * Project-owned files (config, fixtures, page objects, tests) are never touched: the changelog says what to do there.
 */
export async function upgradeProject({ root = process.cwd(), templateDir, force = false }) {
  const config = readConfig(root);
  const target = readVersion(templateDir);
  if (compareVersions(target, config.frameworkVersion) <= 0 && !force) return { status: 'up-to-date', version: config.frameworkVersion };
  const recorded = config.files ?? {};
  const modified = Object.keys(recorded).filter((rel) => rel.startsWith('framework/') && fs.existsSync(path.join(root, rel)) && hashFile(path.join(root, rel)) !== recorded[rel]);
  if (modified.length && !force) return { status: 'blocked', modified, from: config.frameworkVersion, to: target };

  fs.rmSync(path.join(root, 'framework'), { recursive: true, force: true });
  fs.cpSync(path.join(templateDir, 'framework'), path.join(root, 'framework'), { recursive: true });
  const fresh = await import(`${pathToFileURL(path.join(root, 'framework/lib/scaffold.js')).href}?upgrade=${Date.now()}`);
  const { updated, kept } = applyWorkflows({ root, config, rendered: fresh.renderWorkflows(config) });
  const packageChanges = fresh.syncPackageJson(config, root);
  const changelog = fs.readFileSync(path.join(root, 'framework/CHANGELOG.md'), 'utf8');
  const notes = notesBetween(changelog, config.frameworkVersion, target);
  const from = config.frameworkVersion;
  config.frameworkVersion = target;
  config.files = manifestOf(root, updated);
  for (const rel of kept) delete config.files[rel];
  writeConfig(config, root);
  return { status: 'upgraded', from, to: target, updated, kept, packageChanges, notes };
}

/**
 * Writes the generated workflows, but only over files nobody customized (unchanged since the framework wrote them, or
 * already identical). A customized one is left alone and the new version goes to .qa-out/upgrade/ for a manual diff.
 */
export function applyWorkflows({ root, config, rendered }) {
  const recorded = config.files ?? {};
  const updated = [];
  const kept = [];
  for (const [rel, content] of Object.entries(rendered)) {
    const file = path.join(root, rel);
    const pristine = !fs.existsSync(file) || (recorded[rel] && hashFile(file) === recorded[rel]) || hashFile(file) === hashContent(content);
    if (pristine) {
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, content);
      updated.push(rel);
    } else {
      const aside = path.join(root, '.qa-out/upgrade', rel);
      fs.mkdirSync(path.dirname(aside), { recursive: true });
      fs.writeFileSync(aside, content);
      kept.push(rel);
    }
  }
  return { updated, kept };
}

/** Gets the template at `ref` (or the default branch) with gh, so private repositories work. Returns the folder. */
export function fetchTemplate({ repo = process.env.QA_TEMPLATE_REPO ?? TEMPLATE_REPO, ref = '', dest }) {
  const args = ['repo', 'clone', repo, dest, '--', '--depth', '1', ...(ref ? ['--branch', ref] : [])];
  const r = spawnSync('gh', args, { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`Could not fetch ${repo}${ref ? `@${ref}` : ''}: ${(r.stderr || r.stdout).split('\n')[0]}`);
  return dest;
}

/**
 * First step for a project created before the framework was versioned (no .qa-framework.json): the folder
 * `framework/` has been copied in by hand; this records the configuration it can detect and writes what it
 * would generate to .qa-out/adopt/ for a manual merge. It never overwrites existing project files.
 */
export async function adoptProject({ root = process.cwd() }) {
  if (fs.existsSync(path.join(root, '.qa-framework.json'))) throw new Error('.qa-framework.json already exists: use upgrade');
  const profilesFile = path.join(root, 'auth/environment-profile.js');
  const roles = [];
  if (fs.existsSync(profilesFile)) {
    for (const m of fs.readFileSync(profilesFile, 'utf8').matchAll(/name:\s*'([\w-]+)'[\s\S]*?credentialsEnvPrefix:\s*'(\w+)'/g)) roles.push({ name: m[1], prefix: m[2], login: 'password' });
  }
  const pkg = JSON.parse(fs.readFileSync(path.join(root, 'package.json'), 'utf8'));
  const config = defaultConfig({ app: { name: pkg.name ?? '', slug: pkg.name ?? '', loginType: 'password', vercelProtected: false }, roles: roles.length ? roles : [{ name: 'default', login: 'password' }] });
  config.frameworkVersion = readVersion(root);
  const fresh = await import(`${pathToFileURL(path.join(root, 'framework/lib/scaffold.js')).href}?adopt=${Date.now()}`);
  const aside = [];
  for (const [rel, content] of Object.entries(fresh.renderWorkflows(config))) {
    const target = path.join(root, '.qa-out/adopt', rel);
    fs.mkdirSync(path.dirname(target), { recursive: true });
    fs.writeFileSync(target, content);
    aside.push(rel);
  }
  const packageChanges = fresh.syncPackageJson(config, root);
  config.files = manifestOf(root);
  writeConfig(config, root);
  return { config, roles: config.roles.map((r) => r.name), aside, packageChanges, manual: ADOPT_STEPS };
}

export const ADOPT_STEPS = [
  "fixtures/base.fixture.js: spread `...qaFixtures` and `...healFixtures` into test.extend (see framework/templates/fixtures.base.fixture.js).",
  "playwright.config.js: use `allureOptions()` for allure-playwright and add the `api` project if you use API tests (see framework/templates/playwright.config.js).",
  "Add a test-cases/*.yml definition for every test, then run `npm run catalog` (start with `npm run qa -- catalog --stub`).",
  "Compare .qa-out/adopt/.github/workflows/* with your workflows and copy what you want; then run `npm run doctor`.",
  "Run `npm install` to apply the pinned dependency versions.",
];
