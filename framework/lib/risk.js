import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';

export const RISK_MAP_FILE = 'risk.map.json';
const MAX_PATHS = 2000;

export function globToRegex(glob) {
  let out = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      out += '.*';
      i++;
      if (glob[i + 1] === '/') i++;
    } else if (c === '*') out += '[^/]*';
    else if (c === '?') out += '[^/]';
    else out += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${out}$`);
}

export function loadRiskMap(root = process.cwd()) {
  const file = path.join(root, RISK_MAP_FILE);
  if (!fs.existsSync(file)) return null;
  const map = JSON.parse(fs.readFileSync(file, 'utf8'));
  return { rules: map.rules ?? [], alwaysRun: map.alwaysRun ?? [], ignore: map.ignore ?? [] };
}

/** Changed file paths of the PRODUCT repository, from an env value, a file, or the GitHub compare API. */
export function parseChangedPaths(text) {
  return String(text ?? '')
    .split(/[\n,]/)
    .map((p) => p.trim())
    .filter((p) => p && !p.includes('\0'))
    .slice(0, MAX_PATHS);
}

export function changedPathsFromGithub({ repo, base, head, run = (args) => spawnSync('gh', args, { encoding: 'utf8' }) }) {
  const r = run(['api', `repos/${repo}/compare/${base}...${head}`, '--paginate', '--jq', '.files[].filename']);
  if (r.status !== 0) return null;
  return parseChangedPaths(r.stdout);
}

/**
 * Picks the areas to test from what changed in the product. It only narrows the suite when the evidence is
 * complete: a map exists, paths are known, every path is covered by a rule or ignored. Anything else runs everything.
 * `cases` come from the catalog ({ id, area, automation }).
 */
export function selectByRisk({ changedPaths, map, cases }) {
  const all = (reason) => ({ mode: 'all', reason, areas: [], ids: [] });
  if (!map) return all(`no ${RISK_MAP_FILE}`);
  if (!changedPaths?.length) return all('no information about what changed');
  const rules = map.rules.map((r) => ({ ...r, matchers: r.paths.map(globToRegex) }));
  const ignore = map.ignore.map(globToRegex);
  const areas = new Set();
  const unmapped = [];
  for (const p of changedPaths) {
    if (ignore.some((re) => re.test(p))) continue;
    const hits = rules.filter((r) => r.matchers.some((re) => re.test(p)));
    if (!hits.length) unmapped.push(p);
    for (const h of hits) h.areas.forEach((a) => areas.add(a));
  }
  if (unmapped.length) return all(`${unmapped.length} changed paths are not covered by the risk map (e.g. ${unmapped.slice(0, 3).join(', ')})`);
  map.alwaysRun.forEach((a) => areas.add(a));
  if (!areas.size) return all('every changed path is ignored and no alwaysRun area is configured');
  const known = new Set(cases.map((c) => c.area));
  const missing = [...areas].filter((a) => !known.has(a));
  if (missing.length) return all(`the risk map names areas that do not exist in the catalog: ${missing.join(', ')}`);
  const ids = cases.filter((c) => areas.has(c.area) && c.automation === 'automated').map((c) => c.id);
  if (!ids.length) return all('the selected areas have no automated cases');
  return { mode: 'risk', reason: `${changedPaths.length} changed paths map to ${[...areas].join(', ')}`, areas: [...areas], ids };
}

export const grepForIds = (ids) => ids.map((id) => `${id}\\b`).join('|');

/** Counts the tests a grep would run, from the tests Playwright lists. Used to sanity-check a selection. */
export function countSelected({ tests, grep, dir = '' }) {
  const inSuite = tests.filter((t) => !dir || t.file.startsWith(dir.replace(/\/$/, '') + '/') || t.file === dir);
  const re = grep ? new RegExp(grep) : null;
  return { selected: inSuite.filter((t) => !re || re.test(t.title)).length, total: inSuite.length };
}
