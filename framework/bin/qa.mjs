#!/usr/bin/env node
// Single entry point for framework commands: `node framework/bin/qa.mjs <command>`.
import { pathToFileURL } from 'node:url';

const arg = (args, name, fallback) => {
  const i = args.indexOf(name);
  return i >= 0 && args[i + 1] && !args[i + 1].startsWith('--') ? args[i + 1] : fallback;
};

async function apiContext() {
  const { loadEnv } = await import('../lib/env.js');
  const { ApiSession } = await import('../lib/api/session.js');
  const { chromium } = await import('@playwright/test');
  const { ensureProfileLogin } = await import('../lib/login.js');
  loadEnv();
  const root = process.cwd();
  const { default: config } = await import(pathToFileURL(`${root}/api/api.config.js`).href);
  const { PROFILES } = await import(pathToFileURL(`${root}/auth/environment-profile.js`).href);
  return { config, PROFILES, ApiSession, chromium, ensureProfileLogin, root };
}

function appendSummary(markdown) {
  if (process.env.GITHUB_STEP_SUMMARY) {
    return import('node:fs').then((fs) => fs.appendFileSync(process.env.GITHUB_STEP_SUMMARY, markdown + '\n'));
  }
}

const commands = {
  // qa env add NAME --secret|--variable: make CI receive a setting the app needs (API key, backend URL).
  env: async (args) => {
    const [action, name] = args;
    if (action !== 'add' || !name) throw new Error('Usage: qa env add NAME --secret|--variable');
    const kind = args.includes('--secret') ? 'secret' : args.includes('--variable') ? 'variable' : '';
    const { addEnvVar } = await import('../lib/envvars.js');
    const { loadEnv } = await import('../lib/env.js');
    const { readConfig } = await import('../lib/config.js');
    const { syncSecrets, syncVariables } = await import('../lib/secrets.js');
    const result = await addEnvVar({ name, kind });
    console.log(`env: ${name} registered as ${kind}; workflows updated: ${result.updated.join(', ') || 'none'}${result.kept.length ? `; customized (new version in .qa-out/upgrade/): ${result.kept.join(', ')}` : ''}`);
    loadEnv();
    const config = readConfig();
    const synced = kind === 'secret' ? syncSecrets(config, process.env, { only: [name] }) : syncVariables(config, process.env, { only: [name] });
    const outcome = synced.skipped ? `not uploaded (${synced.skipped}); run \`npm run qa -- secrets\` later` : synced.set.length ? 'uploaded to GitHub' : `no value for ${name} in .env: add it and run \`npm run qa -- secrets\``;
    console.log(`env: ${name} ${outcome}`);
  },
  // qa sync: regenerate the workflows from .qa-framework.json (customized ones are kept, new version in .qa-out/upgrade/).
  sync: async () => {
    const { readConfig, writeConfig } = await import('../lib/config.js');
    const { applyWorkflows, manifestOf } = await import('../lib/upgrade.js');
    const { renderWorkflows } = await import('../lib/scaffold.js');
    const config = readConfig();
    const { updated, kept } = applyWorkflows({ root: process.cwd(), config, rendered: renderWorkflows(config) });
    config.files = { ...config.files, ...manifestOf(process.cwd(), updated) };
    for (const rel of kept) delete config.files[rel];
    writeConfig(config);
    console.log(`sync: updated ${updated.join(', ') || 'none'}; kept ${kept.join(', ') || 'none'}`);
  },
  // qa explore: ask Claude Code to explore the app again and extend docs, page objects and tests.
  explore: async () => {
    const { runExplore } = await import('../lib/explore.js');
    process.exit(runExplore().status ?? 1);
  },
  // qa upgrade [--from dir | --ref tag] [--force] [--check]: bring this project to the template's framework version.
  upgrade: async (args) => {
    const fs = await import('node:fs');
    const os = await import('node:os');
    const path = await import('node:path');
    const { upgradeProject, fetchTemplate } = await import('../lib/upgrade.js');
    const local = arg(args, '--from', '');
    const templateDir = local || fetchTemplate({ ref: arg(args, '--ref', ''), dest: path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'qa-template-')), 'template') });
    const result = await upgradeProject({ templateDir, force: args.includes('--force') });
    if (result.status === 'up-to-date') return console.log(`upgrade: already at ${result.version}`);
    if (result.status === 'blocked') {
      console.log(`upgrade: ${result.from} -> ${result.to} is available, but these framework files were edited here:\n${result.modified.map((f) => `  - ${f}`).join('\n')}\nMove the changes out of framework/ (it is shared code), or run again with --force to overwrite them.`);
      process.exit(1);
    }
    console.log(`upgrade: ${result.from} -> ${result.to}\n  workflows updated: ${result.updated.join(', ') || 'none'}\n  workflows kept (customized; new version in .qa-out/upgrade/): ${result.kept.join(', ') || 'none'}\n  package.json: ${result.packageChanges.join('; ') || 'no change'}`);
    for (const n of result.notes) console.log(`\n## ${n.version}\n${n.notes}`);
    console.log('\nNext: npm install && npm run doctor, then review `git diff`.');
  },
  // qa adopt: first step for a project created before the framework was versioned (see framework/README.md).
  adopt: async () => {
    const { adoptProject } = await import('../lib/upgrade.js');
    const r = await adoptProject({});
    console.log(`adopt: recorded roles ${r.roles.join(', ')}; generated workflows to compare are in .qa-out/adopt/ (${r.aside.join(', ')})\npackage.json: ${r.packageChanges.join('; ') || 'no change'}\nManual steps:\n${r.manual.map((m) => `  - ${m}`).join('\n')}`);
  },
  // qa select [--suite tests/smoke-tests] [--changed-file f] [--product-repo o/r --base A --head B]
  // Chooses tests by risk from the product change. Anything doubtful selects everything. Writes $GITHUB_OUTPUT.
  select: async (args) => {
    const fs = await import('node:fs');
    const { loadRiskMap, parseChangedPaths, changedPathsFromGithub, selectByRisk, grepForIds, countSelected } = await import('../lib/risk.js');
    const { collectTests } = await import('../lib/collect.js');
    const { readDefinitions } = await import('../lib/catalog.js');
    const { loadEnv } = await import('../lib/env.js');
    loadEnv();
    let changed = parseChangedPaths(process.env.QA_CHANGED_PATHS);
    const file = arg(args, '--changed-file', '');
    if (file) changed = parseChangedPaths(fs.readFileSync(file, 'utf8'));
    const repo = arg(args, '--product-repo', '');
    if (repo) changed = changedPathsFromGithub({ repo, base: arg(args, '--base', ''), head: arg(args, '--head', '') }) ?? [];
    const suite = arg(args, '--suite', '');
    const tests = collectTests();
    const { cases } = readDefinitions();
    let selection = selectByRisk({ changedPaths: changed, map: loadRiskMap(), cases });
    let grep = selection.mode === 'risk' ? grepForIds(selection.ids) : '';
    const count = countSelected({ tests, grep, dir: suite });
    if (selection.mode === 'risk' && count.selected === 0) {
      selection = { mode: 'all', reason: 'the selection matches no test in this suite', areas: [], ids: [] };
      grep = '';
    }
    const final = grep ? count : countSelected({ tests, grep: '', dir: suite });
    console.log(`select: ${selection.mode} (${selection.reason}); ${final.selected} of ${final.total} tests${suite ? ` in ${suite}` : ''}`);
    if (process.env.GITHUB_OUTPUT) fs.appendFileSync(process.env.GITHUB_OUTPUT, `grep=${grep}\nmode=${selection.mode}\nselected=${final.selected}\ntotal=${final.total}\n`);
  },
  // qa ticket-draft --file ticket.md --key ABC-1 | --jira ABC-1: write DRAFT cases and a fixme spec from acceptance criteria.
  'ticket-draft': async (args) => {
    const fs = await import('node:fs');
    const { createDraft } = await import('../lib/tickets.js');
    const { loadEnv } = await import('../lib/env.js');
    loadEnv();
    let ticket;
    if (arg(args, '--jira', '')) {
      const { JiraClient } = await import('../lib/integrations/jira.js');
      const e = process.env;
      ticket = await new JiraClient({ baseUrl: e.JIRA_BASE_URL, email: e.JIRA_EMAIL, token: e.JIRA_API_TOKEN, projectKey: e.JIRA_PROJECT_KEY }).fetchIssue(arg(args, '--jira', ''));
    } else {
      const file = arg(args, '--file', '');
      if (!file) throw new Error('Use --jira ABC-1 or --file ticket.md --key ABC-1');
      const text = fs.readFileSync(file, 'utf8');
      const [first, ...rest] = text.split('\n');
      ticket = { key: arg(args, '--key', 'TICKET'), title: first.replace(/^#+\s*/, ''), description: rest.join('\n') };
    }
    const draft = createDraft({ ticket, area: arg(args, '--area', 'Tickets') });
    console.log(`ticket-draft: ${draft.cases.length} draft cases in ${draft.yamlFile}, skeleton ${draft.specFile} (all test.fixme). Next: implement, then npm run qa -- ticket-check --run`);
  },
  // qa ticket-check [--run]: structural gate for ticket-derived cases; --run also executes their specs.
  'ticket-check': async (args) => {
    const { checkDrafts } = await import('../lib/tickets.js');
    const { spawnSync } = await import('node:child_process');
    const report = checkDrafts({});
    if (args.includes('--run')) {
      for (const spec of new Set(report.filter((r) => r.status === 'needs-review').map((r) => r.spec))) {
        const run = spawnSync('npx', ['playwright', 'test', spec, '--retries=0'], { stdio: 'inherit' });
        if (run.status !== 0) for (const r of report.filter((x) => x.spec === spec && x.status === 'needs-review')) r.status = 'fails-against-the-app';
      }
    }
    for (const r of report) {
      console.log(`${r.id} (${r.source}): ${r.status}`);
      for (const p of r.problems) console.log(`  PROBLEM: ${p}`);
      for (const w of r.warnings) console.log(`  warning: ${w}`);
    }
    console.log('Passing the gate means "ready for human review", never "validated": a person must confirm each assertion proves its criterion.');
    process.exit(report.some((r) => r.status === 'incomplete' || r.status === 'fails-against-the-app') ? 1 : 0);
  },
  // qa notify: send the outcome of the run to Slack and Jira, when configured. Never fails the job.
  notify: async () => {
    const fs = await import('node:fs');
    const { notifyRun } = await import('../lib/integrations/notify.js');
    const { loadEnv } = await import('../lib/env.js');
    loadEnv();
    if (!fs.existsSync('qa-publish/meta.json')) {
      console.log('notify: no run metadata (nothing was prepared), skipping');
      return;
    }
    const meta = JSON.parse(fs.readFileSync('qa-publish/meta.json', 'utf8'));
    const diagnosis = fs.existsSync('.qa-out/diagnosis.json') ? JSON.parse(fs.readFileSync('.qa-out/diagnosis.json', 'utf8')) : { items: [], counts: {} };
    const summary = await notifyRun({ meta, diagnosis });
    console.log(`notify: slack ${typeof summary.slack === 'string' ? summary.slack : ''}; jira ${typeof summary.jira === 'string' ? summary.jira : JSON.stringify(summary.jira)}`);
  },
  // qa pages: enable GitHub Pages (GitHub Actions as source) for the current repository.
  pages: async () => {
    const { repoInfo, enablePages, pagesUrl, visibilityNotice } = await import('../lib/github.js');
    const { readConfig } = await import('../lib/config.js');
    const info = repoInfo();
    if (!info) throw new Error('No GitHub repository found for this folder (git remote + gh login needed).');
    const result = enablePages({ repo: info.repo });
    console.log(`pages: ${result.status}${result.reason ? ` - ${result.reason}` : ` - ${result.url ?? pagesUrl(info.repo)}`}`);
    console.log(visibilityNotice(info.visibility, readConfig().retentionDays));
    process.exit(result.status === 'pending' ? 1 : 0);
  },
  // qa publish-prepare --suite smoke: sanitized report + metadata for one run, ready to upload as an artifact.
  'publish-prepare': async (args) => {
    const { preparePublicRun } = await import('../lib/site/prepare.js');
    const { loadEnv } = await import('../lib/env.js');
    loadEnv();
    const suite = arg(args, '--suite', '');
    if (!suite) throw new Error('--suite is required');
    const { meta, dropped } = preparePublicRun({ suite });
    console.log(`publish-prepare: ${meta.suite} ${meta.status} ${JSON.stringify(meta.counts)}; withheld attachments: ${dropped.length}`);
  },
  // qa site-publish [--incoming dir] [--squash]: add runs to the reports branch, prune expired ones, push.
  'site-publish': async (args) => {
    const fs = await import('node:fs');
    const { buildSite } = await import('../lib/site/build.js');
    const { publishToBranch, squashBranch } = await import('../lib/site/publish.js');
    const { readConfig } = await import('../lib/config.js');
    const config = readConfig();
    const catalogFile = '.qa-out/catalog.json';
    const catalog = fs.existsSync(catalogFile) ? JSON.parse(fs.readFileSync(catalogFile, 'utf8')) : { stats: { total: 0 }, areas: [], cases: [], generatedAt: new Date().toISOString() };
    const incomingDir = arg(args, '--incoming', '');
    const message = `QA reports ${new Date().toISOString().slice(0, 16)}Z`;
    let summary;
    const result = publishToBranch({
      message,
      apply: (dir) => {
        summary = buildSite({ siteDir: dir, incomingDir: incomingDir || undefined, catalog, app: config.app.name || config.app.slug, retentionDays: config.retentionDays });
      },
    });
    console.log(`site-publish: ${result.status} (attempt ${result.attempts}); added ${summary.added.length}, expired ${summary.removed.length}, runs kept ${summary.runs}`);
    // The daily cleanup also rewrites the branch history to one commit: otherwise expired reports would stay
    // readable in old commits (and the repository would keep growing). A lost race is retried on the next run.
    if (args.includes('--squash')) {
      try {
        console.log(`site-publish: history ${JSON.stringify(squashBranch({ keepCommits: 1 }))}`);
      } catch (error) {
        console.log(`site-publish: history not squashed this time (${String(error.stderr ?? error.message).split('\n')[0]}); it is retried by the next daily cleanup`);
      }
    }
  },
  // qa diagnose [--results playwright-report/results.json]: classify failures from Playwright's own results.
  diagnose: async (args) => {
    const fs = await import('node:fs');
    const { diagnoseReport, renderDiagnosisMarkdown } = await import('../lib/diagnosis.js');
    const file = arg(args, '--results', 'playwright-report/results.json');
    if (!fs.existsSync(file)) {
      console.log(`diagnose: ${file} not found (the run produced no results)`);
      return;
    }
    const diagnosis = diagnoseReport(JSON.parse(fs.readFileSync(file, 'utf8')));
    fs.mkdirSync('.qa-out', { recursive: true });
    fs.writeFileSync('.qa-out/diagnosis.json', JSON.stringify(diagnosis, null, 2));
    const markdown = renderDiagnosisMarkdown(diagnosis);
    fs.writeFileSync('.qa-out/diagnosis.md', markdown);
    await appendSummary(markdown);
    console.log(`diagnose: ${diagnosis.items.length} failed or flaky tests ${JSON.stringify(diagnosis.counts)}`);
  },
  // qa heal [--results ...] [--verify]: suggest selector fixes for failed actions. Never edits the repository.
  heal: async (args) => {
    const fs = await import('node:fs');
    const { buildHealReport, verifyAll, writeHealReport, renderHealMarkdown, checkProposals } = await import('../lib/heal/report.js');
    // qa heal check [--proposals .qa-out/heal/proposals.json] [--patch .qa-out/heal/heal.patch]: does a downloaded patch still fit this code?
    if (args[0] === 'check') {
      const proposalsFile = arg(args, '--proposals', '.qa-out/heal/proposals.json');
      const patchFile = arg(args, '--patch', '.qa-out/heal/heal.patch');
      if (!fs.existsSync(proposalsFile)) {
        console.log(`heal check: ${proposalsFile} not found (download heal-proposals.json and heal.patch from the report)`);
        process.exit(1);
      }
      const saved = JSON.parse(fs.readFileSync(proposalsFile, 'utf8'));
      const result = checkProposals({ proposals: saved.proposals, revision: saved.revision });
      const { spawnSync } = await import('node:child_process');
      const apply = fs.existsSync(patchFile) && fs.statSync(patchFile).size ? spawnSync('git', ['apply', '--check', patchFile], { encoding: 'utf8' }) : null;
      console.log(`heal check: generated for ${result.revision ?? 'unknown revision'}, this code is ${result.head ?? 'not a git checkout'}${result.sameRevision ? ' (same revision)' : ''}`);
      for (const item of result.items) console.log(`  ${item.state === 'current' ? 'ok   ' : 'STALE'} ${item.file}: ${item.title}${item.reason ? ` (${item.reason})` : ''}`);
      if (apply) console.log(`  git apply --check: ${apply.status === 0 ? 'applies cleanly' : `does not apply (${apply.stderr.split('\n')[0]})`}`);
      const ok = result.stale === 0 && (!apply || apply.status === 0) && result.items.length > 0;
      console.log(ok ? 'heal check: the patch fits this code; a person still has to confirm each candidate before applying it' : result.items.length === 0 ? 'heal check: this report has no suggested change to apply' : 'heal check: do not apply; regenerate the suggestions from a new run');
      process.exit(ok ? 0 : 1);
    }
    const file = arg(args, '--results', 'playwright-report/results.json');
    if (!fs.existsSync(file)) {
      console.log(`heal: ${file} not found`);
      return;
    }
    const report = buildHealReport({ report: JSON.parse(fs.readFileSync(file, 'utf8')) });
    const { loadEnv } = await import('../lib/env.js');
    const { createLlm } = await import('../lib/llm/index.js');
    loadEnv();
    const llm = createLlm();
    if (llm) {
      const { applyLlmTier } = await import('../lib/heal/report.js');
      await applyLlmTier({ report, llm });
      console.log(`heal: tier 3 enabled (${llm.provider}, ${llm.model}): names of page elements were sent to the provider for undecided failures`);
    }
    if (args.includes('--verify')) {
      await verifyAll({ proposals: report.proposals });
    }
    const written = writeHealReport(report);
    await appendSummary(renderHealMarkdown(written));
    const by = (status) => written.proposals.filter((p) => p.status === status).length;
    console.log(`heal: ${written.proposals.length} failures, ${by('suggested')} suggestions -> .qa-out/heal/heal-report.md (suggestions only, nothing modified)`);
  },
  // qa sweep [--dry-run] [--older-than 2h] [--max 200]: delete QA data left by interrupted runs.
  sweep: async (args) => {
    const { config, PROFILES, ApiSession, chromium, ensureProfileLogin, root } = await apiContext();
    const { sweep, parseDuration } = await import('../lib/api/sweeper.js');
    if (config.auth?.mode !== 'none' && config.auth?.mode !== 'login-endpoint') {
      const browser = await chromium.launch();
      try {
        await ensureProfileLogin({ browser, profile: PROFILES[config.auth?.profile ?? 'default'], root });
      } finally {
        await browser.close();
      }
    }
    const api = await ApiSession.create({ config, profiles: PROFILES, root });
    try {
      const report = await sweep({ resources: config.resources ?? {}, api, prefix: config.prefix, olderThanMs: parseDuration(arg(args, '--older-than', '2h')), max: Number(arg(args, '--max', '200')), dryRun: args.includes('--dry-run') });
      console.log(`sweep${report.dryRun ? ' (dry run)' : ''}: checked ${report.checked}, ${report.dryRun ? 'would delete' : 'deleted'} ${report.deleted.length}, recent ${report.skippedRecent}, not ours ${report.skippedForeign}, failed ${report.failed.length}`);
      for (const f of report.failed) console.log(`  failed ${f.kind} ${f.name}: ${f.error}`);
      process.exit(report.failed.length ? 1 : 0);
    } finally {
      await api.dispose();
    }
  },
  // qa api-discover [--max-pages 15]: observe the API traffic of the UI and merge it into docs/api-endpoints.json.
  'api-discover': async (args) => {
    const fs = await import('node:fs');
    const { PROFILES, chromium, ensureProfileLogin, root } = await apiContext();
    const { discover } = await import('../lib/api/discover.js');
    const { mergeObserved, OBSERVED_FILE, REPORT_FILE, coverageReport, readCalls, renderMarkdown } = await import('../lib/api/coverage.js');
    const { bypassHeaders } = await import('../lib/env.js');
    const profile = PROFILES.default;
    const browser = await chromium.launch();
    try {
      await ensureProfileLogin({ browser, profile, root });
    } finally {
      await browser.close();
    }
    const flowsFile = `${root}/api/discover.flows.js`;
    const flows = fs.existsSync(flowsFile) ? (await import(pathToFileURL(flowsFile).href)).default : [];
    const observed = await discover({ baseURL: process.env.BASE_URL, storageState: profile.storageStatePath, headers: bypassHeaders(), maxPages: Number(arg(args, '--max-pages', '15')), flows });
    const previous = fs.existsSync(OBSERVED_FILE) ? JSON.parse(fs.readFileSync(OBSERVED_FILE, 'utf8')) : null;
    const merged = mergeObserved(previous, observed);
    fs.mkdirSync('docs', { recursive: true });
    fs.writeFileSync(OBSERVED_FILE, JSON.stringify(merged, null, 2) + '\n');
    fs.writeFileSync(REPORT_FILE, renderMarkdown(coverageReport(merged, readCalls()), merged.generatedAt));
    console.log(`api-discover: ${merged.endpoints.length} endpoints observed, ${merged.documented.length} documented -> ${REPORT_FILE}`);
  },
  // qa api-coverage: recompute docs/api-endpoints.md from the observed file and the calls the last test run made.
  'api-coverage': async () => {
    const fs = await import('node:fs');
    const { OBSERVED_FILE, REPORT_FILE, coverageReport, readCalls, renderMarkdown } = await import('../lib/api/coverage.js');
    if (!fs.existsSync(OBSERVED_FILE)) throw new Error(`${OBSERVED_FILE} not found: run \`npm run qa -- api-discover\` first`);
    const observed = JSON.parse(fs.readFileSync(OBSERVED_FILE, 'utf8'));
    const report = coverageReport(observed, readCalls());
    fs.writeFileSync(REPORT_FILE, renderMarkdown(report, new Date().toISOString()));
    console.log(`api-coverage: observed ${report.summary.observed}, covered ${report.summary.covered}, seed-only ${report.summary.seedOnly} -> ${REPORT_FILE}`);
  },
  // qa catalog [--check] [--stub]: build .qa-out/catalog.json from test-cases/*.yml + the tests Playwright lists.
  catalog: async (args) => {
    const fs = await import('node:fs');
    const { buildCatalog, stubMissing } = await import('../lib/catalog.js');
    const { loadEnv } = await import('../lib/env.js');
    loadEnv();
    if (args.includes('--stub')) {
      const ids = stubMissing();
      console.log(ids.length ? `Added draft definitions to test-cases/unsorted.yml: ${ids.join(', ')}` : 'Every test already has a definition');
    }
    const version = fs.readFileSync(new URL('../VERSION', import.meta.url), 'utf8').trim();
    const { catalog, issues } = buildCatalog({ version });
    fs.mkdirSync('.qa-out', { recursive: true });
    fs.writeFileSync('.qa-out/catalog.json', JSON.stringify(catalog, null, 2));
    for (const i of issues) console.log(`${i.level.toUpperCase()}: ${i.file ? `${i.file}: ` : ''}${i.message}`);
    console.log(`catalog: ${catalog.stats.total} cases -> .qa-out/catalog.json`);
    const errors = issues.filter((i) => i.level === 'error').length;
    if (errors && args.includes('--check')) process.exit(1);
  },
  secrets: async () => {
    const { loadEnv } = await import('../lib/env.js');
    const { readConfig } = await import('../lib/config.js');
    const { syncSecrets } = await import('../lib/secrets.js');
    loadEnv();
    const r = syncSecrets(readConfig(), process.env);
    if (r.skipped) console.log(`Secrets not set: ${r.skipped}`);
    console.log(`secrets set: ${r.set.join(', ') || '-'}\nmissing in .env: ${r.missing.join(', ') || '-'}\nfailed: ${r.failed.join(', ') || '-'}`);
    const { syncVariables } = await import('../lib/secrets.js');
    const v = syncVariables(readConfig(), process.env);
    console.log(`variables set: ${v.set.join(', ') || '-'}\nmissing in .env: ${v.missing.join(', ') || '-'}\nfailed: ${v.failed.join(', ') || '-'}`);
    process.exit(r.failed.length || v.failed.length || r.skipped ? 1 : 0);
  },
  doctor: async () => {
    const { runDoctor } = await import('../lib/doctor.js');
    const issues = runDoctor();
    for (const { level, message } of issues) console.log(`${level.toUpperCase()}: ${message}`);
    if (!issues.length) console.log('doctor: no issues found');
    process.exit(issues.some((i) => i.level === 'error') ? 1 : 0);
  },
};

const [name, ...args] = process.argv.slice(2);
if (!name || !commands[name]) {
  console.log(`Usage: qa <command>\nCommands: ${Object.keys(commands).join(', ')}`);
  process.exit(name ? 1 : 0);
}
await commands[name](args);
