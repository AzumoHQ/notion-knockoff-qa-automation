import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { idFromTitle } from './ids.js';

/**
 * Flattens Playwright's JSON list output into one record per test (a test = one spec in one project).
 * Spec files are relative to the config's testDir; they are reported relative to the project root.
 */
export function flattenList(report, projectRoot) {
  const testDir = report.config?.rootDir ?? projectRoot;
  projectRoot = fs.realpathSync(projectRoot);
  const out = [];
  const walk = (suite) => {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) {
        out.push({
          id: idFromTitle(spec.title),
          title: spec.title,
          file: path.relative(projectRoot, path.resolve(testDir, spec.file)).split(path.sep).join('/'),
          line: spec.line,
          project: t.projectName,
          tags: spec.tags ?? [],
        });
      }
    }
    for (const child of suite.suites ?? []) walk(child);
  };
  for (const suite of report.suites ?? []) walk(suite);
  return out;
}

/**
 * Asks Playwright itself which tests exist (so the catalog can never drift from what really runs).
 * `list` is injectable for tests; the default shells out to `playwright test --list`.
 */
export function collectTests({ root = process.cwd(), list } = {}) {
  if (list) return flattenList(list, root);
  const out = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-list-')), 'list.json');
  const r = spawnSync('npx', ['playwright', 'test', '--list', '--reporter=json'], {
    cwd: root,
    encoding: 'utf8',
    env: { ...process.env, PLAYWRIGHT_JSON_OUTPUT_NAME: out },
    maxBuffer: 64 * 1024 * 1024,
  });
  if (!fs.existsSync(out)) throw new Error(`playwright --list failed: ${(r.stderr || r.stdout || '').slice(0, 500)}`);
  const report = JSON.parse(fs.readFileSync(out, 'utf8'));
  if (report.errors?.length) throw new Error(`playwright --list reported errors: ${report.errors[0].message?.split('\n')[0]}`);
  return flattenList(report, root);
}
