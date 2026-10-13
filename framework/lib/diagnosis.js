/**
 * Deterministic failure diagnosis from Playwright's own results (results.json). No history, no network, no LLM.
 * It says what the evidence supports and says "unknown" when it does not: a locator timeout can be a broken
 * selector or a removed feature, and only a person (or a validated healing proposal) can tell which.
 */
const ANSI = /\x1b\[[0-9;]*m/g; // eslint-disable-line no-control-regex

export const CATEGORIES = ['product', 'selector', 'data', 'auth', 'infra', 'known-defect', 'flaky', 'unknown'];

const INFRA = /net::ERR_(INTERNET_DISCONNECTED|NAME_NOT_RESOLVED|CONNECTION_\w+|TIMED_OUT|EMPTY_RESPONSE|NETWORK_CHANGED)|ECONNREFUSED|ECONNRESET|ENOTFOUND|ETIMEDOUT|socket hang up|Target (page, context or browser )?(has been )?closed|browser has been closed|Protocol error|\b50[234]\b|page\.goto: Timeout|Navigation timeout/i;
const AUTH = /Login failed for profile|login endpoint answered 4\d\d|\b40[13]\b.*(unauthorized|forbidden)|(unauthorized|forbidden).*\b40[13]\b|storageState|session expired|token expired/i;
const DATA = /(?:create|seed|list|delete|remove)[\w\s]* failed: (4\d\d|5\d\d)|duplicate key|already exists|unique constraint|violates .* constraint|cleanup-failed/i;
const ACTION_TIMEOUT = /locator\.(\w+): (?:Error: )?Timeout \d+ms exceeded/;
const STRICT = /strict mode violation/i;
const ASSERTION = /expect\((?:locator|page|response|received|[^)]*)\)\.(?:not\.)?\w+\(.*\) failed|Expected( string| pattern| substring)?:|toBe\w*\(|toHave\w*\(|toContain\w*\(/;
const ELEMENT_MISSING = /element\(s\) not found|waiting for (?:getBy|locator)/i;

export function clean(text = '') {
  return String(text).replace(ANSI, '');
}

/** Diagnoses one error message. `ctx` may carry { annotations: [{type, description}] }. */
export function diagnoseMessage(rawMessage, ctx = {}) {
  const message = clean(rawMessage);
  const notes = (ctx.annotations ?? []).map((a) => a.type);
  if (notes.includes('cleanup-failed')) return { category: 'data', confidence: 'medium', reason: 'a seeded resource could not be removed', alternatives: [] };
  if (STRICT.test(message)) return { category: 'selector', confidence: 'high', reason: 'the locator matches more than one element', alternatives: [] };
  if (AUTH.test(message)) return { category: 'auth', confidence: /Login failed for profile/.test(message) ? 'high' : 'medium', reason: 'authentication or session problem', alternatives: [] };
  if (INFRA.test(message)) return { category: 'infra', confidence: 'medium', reason: 'network, browser or gateway error', alternatives: [] };
  if (DATA.test(message)) return { category: 'data', confidence: 'medium', reason: 'a data setup or cleanup request failed', alternatives: [] };
  if (ACTION_TIMEOUT.test(message)) {
    return { category: 'selector', confidence: 'medium', reason: `the element for ${message.match(ACTION_TIMEOUT)[1]} never appeared`, alternatives: ['product'] };
  }
  if (ASSERTION.test(message)) {
    if (ELEMENT_MISSING.test(message)) return { category: 'unknown', confidence: 'low', reason: 'an element was expected but not found: broken selector or removed behavior', alternatives: ['selector', 'product'] };
    if (/Received/.test(message)) return { category: 'product', confidence: 'medium', reason: 'the observed value differs from the expected one', alternatives: [] };
  }
  return { category: 'unknown', confidence: 'low', reason: 'no rule matches this error', alternatives: [] };
}

function* walkTests(suites, trail = []) {
  for (const suite of suites ?? []) {
    for (const spec of suite.specs ?? []) {
      for (const t of spec.tests ?? []) yield { spec, test: t, file: spec.file, trail };
    }
    yield* walkTests(suite.suites, trail);
  }
}

/** Diagnoses every failed or flaky test of a Playwright JSON report. */
export function diagnoseReport(report) {
  const items = [];
  for (const { spec, test } of walkTests(report.suites)) {
    if (test.status !== 'unexpected' && test.status !== 'flaky') continue;
    const attempts = test.results ?? [];
    const failed = attempts.filter((r) => r.status === 'failed' || r.status === 'timedOut');
    const annotations = test.annotations ?? [];
    const diagnosed = failed.map((r) => diagnoseMessage(r.error?.message ?? r.errors?.[0]?.message ?? '', { annotations }));
    const last = diagnosed.at(-1) ?? { category: 'unknown', confidence: 'low', reason: 'no error recorded', alternatives: [] };
    const causes = [...new Set(diagnosed.map((d) => d.category))];
    let result = { ...last };
    if (test.status === 'flaky') {
      const firstLine = clean(failed[0]?.error?.message ?? '').split('\n').find((l) => l.trim())?.trim().slice(0, 140) ?? '';
      result = { category: 'flaky', confidence: 'high', reason: `passed on attempt ${attempts.length}; the failed attempts looked like ${causes.join('/')}${firstLine ? ` (first error: ${firstLine})` : ''}`, alternatives: [], causes };
    } else if (annotations.some((a) => a.type === 'defect')) {
      result = { category: 'known-defect', confidence: 'high', reason: `annotated defect ${annotations.find((a) => a.type === 'defect').description ?? ''}`.trim(), alternatives: [last.category] };
    }
    items.push({
      title: spec.title,
      file: spec.file,
      line: spec.line,
      project: test.projectName,
      status: test.status,
      attempts: attempts.length,
      ...result,
      message: clean(failed.at(-1)?.error?.message ?? '').split('\n').slice(0, 6).join('\n'),
    });
  }
  const counts = Object.fromEntries(CATEGORIES.map((c) => [c, items.filter((i) => i.category === c).length]).filter(([, n]) => n));
  const setupErrors = (report.errors ?? []).map((e) => ({ ...diagnoseMessage(e.message ?? ''), message: clean(e.message ?? '').split('\n')[0] }));
  return { stats: report.stats ?? {}, counts, items, setupErrors };
}

export function renderDiagnosisMarkdown(diagnosis) {
  const lines = ['## Failure diagnosis', ''];
  if (!diagnosis.items.length && !diagnosis.setupErrors.length) return lines.concat('No failed or flaky tests.', '').join('\n');
  const summary = Object.entries(diagnosis.counts).map(([k, n]) => `${k}: ${n}`).join(' · ');
  lines.push(summary || 'Only setup errors.', '', 'Categories are evidence-based guesses, not verdicts: "unknown" and low confidence mean a person must look.', '');
  for (const e of diagnosis.setupErrors) lines.push(`- **setup** ${e.category} (${e.confidence}): ${e.message}`);
  if (diagnosis.items.length) {
    lines.push('| Test | Category | Confidence | Why |', '|---|---|---|---|');
    for (const i of diagnosis.items) {
      const also = i.alternatives?.length ? ` (could also be: ${i.alternatives.join(', ')})` : '';
      lines.push(`| ${i.title.replace(/\|/g, '\\|')} | ${i.category} | ${i.confidence} | ${i.reason}${also} |`);
    }
  }
  return lines.concat('').join('\n');
}
