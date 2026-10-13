import fs from 'node:fs';
import path from 'node:path';
import { endpointKey } from './normalize.js';

export const CALLS_DIR = '.qa-out/api-calls';
export const OBSERVED_FILE = 'docs/api-endpoints.json';
export const REPORT_FILE = 'docs/api-endpoints.md';

export const LIMITS = [
  'Observed endpoints come from navigating the UI as the QA account and from the flows in `api/discover.flows.js`; flows nobody walked are not listed.',
  'Documented endpoints come from an OpenAPI/Swagger document when the application exposes one.',
  'Only method and path template are stored. No headers, query values or bodies are recorded.',
  '"Covered" means an API test (project `api`) called the endpoint; it does not say the response was asserted well.',
];

/** Union of an earlier observation and a new one: counts add up, statuses merge. */
export function mergeObserved(previous, current) {
  const byKey = new Map();
  for (const e of [...(previous?.endpoints ?? []), ...current.endpoints]) {
    const key = endpointKey(e.method, e.path);
    const known = byKey.get(key);
    if (!known) byKey.set(key, { ...e, statuses: [...e.statuses], query: [...(e.query ?? [])] });
    else {
      known.count += e.count;
      known.statuses = [...new Set([...known.statuses, ...e.statuses])].sort();
      known.query = [...new Set([...known.query, ...(e.query ?? [])])].sort();
      known.authenticated = known.authenticated || e.authenticated;
    }
  }
  const documented = new Map();
  for (const d of [...(previous?.documented ?? []), ...(current.documented ?? [])]) documented.set(endpointKey(d.method, d.path), d);
  return {
    generatedAt: current.generatedAt,
    origins: [...new Set([...(previous?.origins ?? []), ...current.origins])].sort(),
    endpoints: [...byKey.values()].sort((a, b) => a.path.localeCompare(b.path) || a.method.localeCompare(b.method)),
    documented: [...documented.values()],
  };
}

export function readCalls(dir = CALLS_DIR) {
  const calls = [];
  for (const file of fs.existsSync(dir) ? fs.readdirSync(dir) : []) {
    if (file.endsWith('.json')) calls.push(...JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8')));
  }
  return calls;
}

/** Joins observed + documented endpoints with the calls made by tests. `project: 'api'` calls are tests; others are seeding. */
export function coverageReport(observed, calls) {
  const hit = new Map();
  for (const c of calls) {
    const key = endpointKey(c.method, c.path);
    const entry = hit.get(key) ?? { test: 0, seed: 0 };
    entry[c.project === 'api' ? 'test' : 'seed']++;
    hit.set(key, entry);
  }
  const observedKeys = new Set(observed.endpoints.map((e) => endpointKey(e.method, e.path)));
  const documentedKeys = new Set((observed.documented ?? []).map((d) => endpointKey(d.method, d.path)));
  const rows = observed.endpoints.map((e) => {
    const key = endpointKey(e.method, e.path);
    const h = hit.get(key) ?? { test: 0, seed: 0 };
    return { ...e, documented: documentedKeys.has(key), covered: h.test > 0, usedBySeedOnly: h.test === 0 && h.seed > 0 };
  });
  const documentedNotObserved = [...(observed.documented ?? [])].filter((d) => !observedKeys.has(endpointKey(d.method, d.path)));
  return {
    rows,
    documentedNotObserved: documentedNotObserved.map((d) => ({ ...d, covered: (hit.get(endpointKey(d.method, d.path))?.test ?? 0) > 0 })),
    summary: { observed: rows.length, covered: rows.filter((r) => r.covered).length, seedOnly: rows.filter((r) => r.usedBySeedOnly).length, documentedNotObserved: documentedNotObserved.length },
  };
}

export function renderMarkdown(report, generatedAt) {
  const s = report.summary;
  const lines = [
    '# API endpoints',
    '',
    `Generated ${generatedAt.slice(0, 10)} by \`npm run qa -- api-coverage\`. Do not edit by hand.`,
    '',
    `**Observed:** ${s.observed} · **covered by API tests:** ${s.covered} · **used only for seeding:** ${s.seedOnly} · **documented but never observed:** ${s.documentedNotObserved}`,
    '',
    '| Method | Path | Statuses | Seen | Documented | Covered |',
    '|---|---|---|---|---|---|',
    ...report.rows.map((r) => `| ${r.method} | \`${r.path}\` | ${r.statuses.join(', ')} | ${r.count} | ${r.documented ? 'yes' : 'no'} | ${r.covered ? 'yes' : r.usedBySeedOnly ? 'seed only' : 'no'} |`),
  ];
  if (report.documentedNotObserved.length) {
    lines.push('', '## Documented but not observed', '', '| Method | Path | Covered |', '|---|---|---|', ...report.documentedNotObserved.map((d) => `| ${d.method} | \`${d.path}\` | ${d.covered ? 'yes' : 'no'} |`));
  }
  lines.push('', '## Limits', '', ...LIMITS.map((l) => `- ${l}`), '');
  return lines.join('\n');
}
