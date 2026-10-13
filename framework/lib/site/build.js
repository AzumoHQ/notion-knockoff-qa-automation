import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const tcmSource = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../tcm');
const SUITE = /^[a-z0-9][a-z0-9-]{0,40}$/;
const NUMBER = /^\d{1,20}$/;
const RUN_FILES = ['meta.json', 'diagnosis.json', 'diagnosis.md', 'heal-report.md', 'heal-proposals.json', 'heal.patch', 'case-links.json'];

export const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[c]);
/** Markdown reports are shown as escaped preformatted text: readable in a browser, with nothing executable in them. */
const textPage = (title, text) => `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(title)}</title><style>body{font:14px/1.5 system-ui,sans-serif;max-width:1000px;margin:16px auto;padding:0 16px}pre{white-space:pre-wrap;word-break:break-word}@media(prefers-color-scheme:dark){body{background:#0d1117;color:#e6edf3}}</style></head><body><p><a href="../../../index.html">All runs</a></p><h1>${esc(title)}</h1><pre>${esc(text)}</pre></body></html>\n`;
const runKey = (m) => `${m.runId}-${m.attempt}`;

export function listRuns(siteDir) {
  const runs = [];
  const base = path.join(siteDir, 'runs');
  for (const suite of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    for (const id of fs.readdirSync(path.join(base, suite))) {
      const metaFile = path.join(base, suite, id, 'meta.json');
      if (fs.existsSync(metaFile)) runs.push({ ...JSON.parse(fs.readFileSync(metaFile, 'utf8')), dir: `runs/${suite}/${id}` });
    }
  }
  return runs.sort((a, b) => b.finishedAt.localeCompare(a.finishedAt));
}

/** Copies the runs found under `incomingDir` (one folder per artifact) into the site. Only known files are copied. */
export function addRuns({ siteDir, incomingDir }) {
  const added = [];
  const dirs = [incomingDir, ...(fs.existsSync(incomingDir) ? fs.readdirSync(incomingDir).map((d) => path.join(incomingDir, d)) : [])];
  for (const dir of dirs) {
    const metaFile = path.join(dir, 'meta.json');
    if (!fs.existsSync(metaFile) || !fs.statSync(dir).isDirectory()) continue;
    const meta = JSON.parse(fs.readFileSync(metaFile, 'utf8'));
    if (!SUITE.test(meta.suite ?? '') || !NUMBER.test(String(meta.runId)) || !NUMBER.test(String(meta.attempt))) throw new Error(`Refusing run with unexpected identifiers: ${JSON.stringify({ suite: meta.suite, runId: meta.runId })}`);
    const target = path.join(siteDir, 'runs', meta.suite, runKey(meta));
    fs.rmSync(target, { recursive: true, force: true });
    fs.mkdirSync(target, { recursive: true });
    for (const name of RUN_FILES) if (fs.existsSync(path.join(dir, name))) fs.copyFileSync(path.join(dir, name), path.join(target, name));
    for (const [md, title] of [['diagnosis.md', 'Failure diagnosis'], ['heal-report.md', 'Selector healing suggestions']]) {
      const source = path.join(target, md);
      if (fs.existsSync(source)) fs.writeFileSync(source.replace(/\.md$/, '.html'), textPage(`${title} · ${meta.suite} run ${meta.runId}`, fs.readFileSync(source, 'utf8')));
    }
    if (fs.existsSync(path.join(dir, 'allure-report'))) fs.cpSync(path.join(dir, 'allure-report'), path.join(target, 'allure'), { recursive: true });
    added.push(`${meta.suite}/${runKey(meta)}`);
  }
  return added;
}

/** Removes runs that finished more than `retentionDays` ago. */
export function pruneRuns({ siteDir, retentionDays, now = new Date() }) {
  const cutoff = now.getTime() - retentionDays * 86_400_000;
  const removed = [];
  for (const run of listRuns(siteDir)) {
    if (new Date(run.finishedAt).getTime() < cutoff) {
      fs.rmSync(path.join(siteDir, run.dir), { recursive: true, force: true });
      removed.push(run.dir);
    }
  }
  const base = path.join(siteDir, 'runs');
  for (const suite of fs.existsSync(base) ? fs.readdirSync(base) : []) {
    if (!fs.readdirSync(path.join(base, suite)).length) fs.rmSync(path.join(base, suite), { recursive: true });
  }
  return removed;
}

const latestBySuite = (runs) => {
  const latest = {};
  for (const run of runs) if (!latest[run.suite]) latest[run.suite] = run;
  return latest;
};

function writeLatest(siteDir, runs) {
  fs.rmSync(path.join(siteDir, 'latest'), { recursive: true, force: true });
  for (const [suite, run] of Object.entries(latestBySuite(runs))) {
    const dir = path.join(siteDir, 'latest', suite);
    fs.mkdirSync(dir, { recursive: true });
    const href = `../../${run.dir}/allure/index.html`;
    fs.writeFileSync(path.join(dir, 'index.html'), `<!doctype html><meta charset="utf-8"><meta http-equiv="refresh" content="0; url=${esc(href)}"><title>Latest ${esc(suite)} report</title><a href="${esc(href)}">Latest ${esc(suite)} report</a>\n`);
  }
}

const badge = (status) => `<span class="s ${esc(status)}">${esc(status)}</span>`;

function portalHtml({ runs, app, retentionDays, now }) {
  const latest = latestBySuite(runs);
  const cards = Object.entries(latest).map(([suite, r]) => `<a class="card" href="latest/${esc(suite)}/">${badge(r.status)} <b>${esc(suite)}</b><br><small>${esc(r.finishedAt.slice(0, 16).replace('T', ' '))} UTC · ${r.counts.passed} passed · ${r.counts.failed} failed · ${r.counts.flaky} flaky</small></a>`).join('') || '<p>No runs published yet.</p>';
  const rows = runs.map((r) => `<tr><td>${esc(r.finishedAt.slice(0, 16).replace('T', ' '))}</td><td>${esc(r.suite)}</td><td>${badge(r.status)}</td><td>${r.counts.passed}/${r.counts.failed}/${r.counts.flaky}</td><td>${esc(r.event)} ${esc(r.sha)}</td><td><a href="${esc(r.dir)}/allure/index.html">Allure</a>${fs.existsSync(path.join(r._siteDir ?? '', r.dir, 'diagnosis.html')) ? ` · <a href="${esc(r.dir)}/diagnosis.html">diagnosis</a>` : ''}${fs.existsSync(path.join(r._siteDir ?? '', r.dir, 'heal-report.html')) ? ` · <a href="${esc(r.dir)}/heal-report.html">healing</a>` : ''}${fs.existsSync(path.join(r._siteDir ?? '', r.dir, 'heal.patch')) && fs.statSync(path.join(r._siteDir, r.dir, 'heal.patch')).size ? ` · <a href="${esc(r.dir)}/heal.patch">patch</a>` : ''}${r.runUrl ? ` · <a href="${esc(r.runUrl)}">workflow run</a>` : ''}</td></tr>`).join('');
  return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1"><title>${esc(app)} · QA reports</title>
<style>:root{--bg:#fff;--fg:#1f2328;--muted:#656d76;--line:#d8dee4}@media(prefers-color-scheme:dark){:root{--bg:#0d1117;--fg:#e6edf3;--muted:#8b949e;--line:#30363d}}
body{margin:0;padding:16px;font:14px/1.5 system-ui,sans-serif;background:var(--bg);color:var(--fg);max-width:1000px;margin-inline:auto}a{color:#0969da}
.cards{display:flex;gap:12px;flex-wrap:wrap}.card{border:1px solid var(--line);border-radius:8px;padding:10px 14px;text-decoration:none;color:var(--fg)}
table{width:100%;border-collapse:collapse}td,th{text-align:left;padding:6px 8px;border-bottom:1px solid var(--line)}.s{padding:0 8px;border-radius:10px;border:1px solid var(--line);font-size:12px}.s.failed{color:#cf222e;border-color:#cf222e}.s.passed{color:#1a7f37;border-color:#1a7f37}small,.muted{color:var(--muted)}</style></head><body>
<h1>${esc(app)} · QA reports</h1>
<p><a href="tcm/">Test case catalog</a></p>
<h2>Latest</h2><div class="cards">${cards}</div>
<h2>Runs</h2><p class="muted">Reports are kept ${retentionDays} days. Counts: passed/failed/flaky. Generated ${esc(now.toISOString().slice(0, 16).replace('T', ' '))} UTC. Traces, videos and page snapshots are never published.</p>
<table><thead><tr><th>Finished</th><th>Suite</th><th>Status</th><th>P/F/Fl</th><th>Trigger</th><th>Links</th></tr></thead><tbody>${rows}</tbody></table>
</body></html>
`;
}

/** Assembles the whole site: runs, portal, latest redirects and the TCM page with the current catalog. */
export function buildSite({ siteDir, incomingDir, catalog, app = 'QA', retentionDays = 15, now = new Date() }) {
  fs.mkdirSync(siteDir, { recursive: true });
  const added = incomingDir ? addRuns({ siteDir, incomingDir }) : [];
  const removed = pruneRuns({ siteDir, retentionDays, now });
  const runs = listRuns(siteDir).map((r) => ({ ...r, _siteDir: siteDir }));
  writeLatest(siteDir, runs);
  fs.writeFileSync(path.join(siteDir, 'index.html'), portalHtml({ runs, app, retentionDays, now }));
  fs.writeFileSync(path.join(siteDir, 'runs.json'), JSON.stringify(runs.map(({ _siteDir, ...r }) => r), null, 2));
  const tcm = path.join(siteDir, 'tcm');
  fs.rmSync(tcm, { recursive: true, force: true });
  fs.mkdirSync(tcm, { recursive: true });
  for (const file of ['index.html', 'app.js', 'model.js', 'tcm.css']) fs.copyFileSync(path.join(tcmSource, file), path.join(tcm, file));
  fs.writeFileSync(path.join(tcm, 'catalog.json'), JSON.stringify(catalog));
  const latest = latestBySuite(runs);
  const caseLinks = {};
  for (const [suite, run] of Object.entries(latest)) {
    const file = path.join(siteDir, run.dir, 'case-links.json');
    if (!fs.existsSync(file)) continue;
    for (const [id, hash] of Object.entries(JSON.parse(fs.readFileSync(file, 'utf8')))) (caseLinks[id] ??= {})[suite] = `../${run.dir}/allure/index.html${hash}`;
  }
  fs.writeFileSync(path.join(tcm, 'site.json'), JSON.stringify({ app, latest: Object.fromEntries(Object.keys(latest).map((s) => [s, `../latest/${s}/`])), caseLinks }));
  fs.writeFileSync(path.join(siteDir, '.nojekyll'), '');
  return { added, removed, runs: runs.length };
}
