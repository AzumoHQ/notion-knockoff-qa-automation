import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { sanitizeAllureResults } from './sanitize.js';
import { collectSecrets, redactText } from './redact.js';
import { allureCaseLinks } from './allure-links.js';
import { findLeaks } from './leaks.js';

export const PUBLISH_DIR = 'qa-publish';

/** Run metadata published next to each report. Built from Playwright's stats and the CI environment only. */
export function buildMeta({ suite, results, env = process.env, now = new Date() }) {
  const stats = results?.stats ?? {};
  const started = stats.startTime ? new Date(stats.startTime) : now;
  const finished = new Date(started.getTime() + (stats.duration ?? 0));
  const repo = env.GITHUB_REPOSITORY;
  return {
    suite,
    runId: env.GITHUB_RUN_ID ?? String(now.getTime()),
    attempt: env.GITHUB_RUN_ATTEMPT ?? '1',
    sha: (env.GITHUB_SHA ?? '').slice(0, 7),
    branch: env.GITHUB_REF_NAME ?? '',
    event: env.GITHUB_EVENT_NAME ?? 'local',
    startedAt: started.toISOString(),
    finishedAt: finished.toISOString(),
    counts: { passed: stats.expected ?? 0, failed: stats.unexpected ?? 0, flaky: stats.flaky ?? 0, skipped: stats.skipped ?? 0 },
    status: (stats.unexpected ?? 0) > 0 ? 'failed' : 'passed',
    runUrl: repo && env.GITHUB_RUN_ID ? `${env.GITHUB_SERVER_URL ?? 'https://github.com'}/${repo}/actions/runs/${env.GITHUB_RUN_ID}` : '',
  };
}

/**
 * Builds the publishable folder for one run: sanitized Allure report, diagnosis, healing suggestions, case links
 * and metadata. Nothing here contains traces, videos, page snapshots or secrets.
 */
export function preparePublicRun({ suite, root = process.cwd(), env = process.env, generate = defaultGenerate, screenshots = env.QA_PUBLISH_SCREENSHOTS === 'true' }) {
  const out = path.join(root, PUBLISH_DIR);
  fs.rmSync(out, { recursive: true, force: true });
  fs.mkdirSync(out, { recursive: true });
  const secrets = collectSecrets(env);
  const resultsFile = path.join(root, 'playwright-report/results.json');
  const results = fs.existsSync(resultsFile) ? JSON.parse(fs.readFileSync(resultsFile, 'utf8')) : null;
  const sanitized = path.join(out, 'allure-results');
  const { dropped } = sanitizeAllureResults({ src: path.join(root, 'allure-results'), dest: sanitized, secrets, screenshots });
  const reportDir = path.join(out, 'allure-report');
  generate({ results: sanitized, report: reportDir });
  fs.rmSync(sanitized, { recursive: true, force: true });
  const caseLinks = allureCaseLinks(reportDir);
  fs.writeFileSync(path.join(out, 'case-links.json'), JSON.stringify(caseLinks));
  for (const [from, to] of [['.qa-out/diagnosis.json', 'diagnosis.json'], ['.qa-out/diagnosis.md', 'diagnosis.md'], ['.qa-out/heal/proposals.json', 'heal-proposals.json'], ['.qa-out/heal/heal-report.md', 'heal-report.md'], ['.qa-out/heal/heal.patch', 'heal.patch']]) {
    const file = path.join(root, from);
    if (fs.existsSync(file)) fs.writeFileSync(path.join(out, to), redactText(fs.readFileSync(file, 'utf8'), secrets));
  }
  const meta = buildMeta({ suite, results, env });
  fs.writeFileSync(path.join(out, 'meta.json'), JSON.stringify(meta, null, 2));
  // Fail closed: a secret that got past the redaction means nothing from this run is published.
  const leaks = findLeaks(out, secrets);
  if (leaks.length) {
    fs.rmSync(out, { recursive: true, force: true });
    throw new Error(`Nothing was published: ${leaks.length} possible leak(s) found after sanitizing (${[...new Set(leaks.map((l) => `${l.what} in ${l.file}`))].slice(0, 5).join('; ')}). Find where the test or app prints it.`);
  }
  return { meta, dropped, caseLinks };
}

function defaultGenerate({ results, report }) {
  const r = spawnSync('npx', ['allure', 'generate', results, '--clean', '-o', report], { encoding: 'utf8' });
  if (r.status !== 0) throw new Error(`allure generate failed: ${(r.stderr || r.stdout).slice(0, 300)}`);
}
