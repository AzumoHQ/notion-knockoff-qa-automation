import fs from 'node:fs';
import path from 'node:path';
import { stringify, parse } from 'yaml';
import { nextId } from './ids.js';
import { readDefinitions } from './catalog.js';

const AC_HEADING = /^\s*(?:#{1,6}\s*)?(?:\*\*)?(acceptance criteria|criterios de aceptaci[oó]n)(?:\*\*)?\s*:?\s*$/i;
const ANY_HEADING = /^\s*#{1,6}\s+\S|^\s*\*\*[^*]+\*\*\s*:?\s*$/;
const BULLET = /^\s*(?:[-*•]|\d+[.)])\s+(.*\S)\s*$/;
const GHERKIN = /^\s*(given|when|then|and|but|dado|cuando|entonces|y|pero)\b[\s,:]+(.*\S)\s*$/i;
const GIVEN = /^(given|dado)$/i;
const WHEN = /^(when|cuando)$/i;
const THEN = /^(then|entonces)$/i;

/**
 * Reads acceptance criteria out of a ticket description. Understands an "Acceptance criteria" section with
 * bullets or numbered lines, and Given/When/Then scenarios (English or Spanish). Nothing is inferred from the title.
 */
export function parseAcceptanceCriteria(text) {
  const lines = String(text ?? '').split('\n');
  const start = lines.findIndex((l) => AC_HEADING.test(l));
  const scope = start >= 0 ? lines.slice(start + 1, lines.findIndex((l, i) => i > start && ANY_HEADING.test(l) && !AC_HEADING.test(l)) >= 0 ? lines.findIndex((l, i) => i > start && ANY_HEADING.test(l) && !AC_HEADING.test(l)) : undefined) : lines;
  const criteria = [];
  let scenario = null;
  const flush = () => {
    if (scenario) criteria.push({ text: scenario.then.join(' and ') || scenario.when.join(' and '), given: scenario.given, when: scenario.when, then: scenario.then });
    scenario = null;
  };
  let section = null;
  for (const line of scope) {
    const g = GHERKIN.exec(line);
    if (g) {
      const keyword = g[1];
      if (GIVEN.test(keyword) || (!scenario && !WHEN.test(keyword) && !THEN.test(keyword))) {
        flush();
        scenario = { given: [], when: [], then: [] };
        section = 'given';
      } else if (WHEN.test(keyword)) {
        if (!scenario || (section === 'then' && scenario.when.length)) {
          flush();
          scenario = { given: [], when: [], then: [] };
        }
        section = 'when';
      } else if (THEN.test(keyword)) {
        if (!scenario) scenario = { given: [], when: [], then: [] };
        section = 'then';
      }
      scenario[section].push(g[2].trim());
      continue;
    }
    const b = BULLET.exec(line);
    if (b) {
      flush();
      criteria.push({ text: b[1].trim(), given: [], when: [], then: [] });
    } else if (!line.trim()) flush();
  }
  flush();
  return criteria.map((c, i) => ({ id: `AC${i + 1}`, ...c }));
}

const slug = (s) => s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');
const short = (s, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/**
 * Writes DRAFTS: case definitions (draft, planned) and a spec skeleton whose tests are test.fixme. Steps are only
 * filled when the ticket has Given/When/Then; otherwise they stay empty on purpose. Nothing here asserts anything.
 */
export function createDraft({ root = process.cwd(), ticket, area = 'Tickets', now = new Date() }) {
  const criteria = parseAcceptanceCriteria(ticket.description);
  if (!criteria.length) throw new Error(`No acceptance criteria found in ${ticket.key}. Add an "Acceptance criteria" section (bullets or Given/When/Then).`);
  const { cases: existing } = readDefinitions(root);
  const ids = existing.map((c) => c.id);
  const key = slug(ticket.key);
  const specFile = `tests/regression/${key}.spec.js`;
  const cases = [];
  for (const ac of criteria) {
    const id = nextId([...ids, ...cases.map((c) => c.id)]);
    cases.push({
      id,
      title: short(ac.text),
      priority: 'medium',
      automation: 'planned',
      draft: true,
      source: `${ticket.key} ${ac.id}`,
      preconditions: ac.given,
      steps: ac.when,
      expected: ac.then.length ? ac.then : [ac.text],
      spec: specFile,
      _ac: ac,
    });
  }
  fs.mkdirSync(path.join(root, 'test-cases'), { recursive: true });
  const yamlFile = path.join(root, 'test-cases', `${key}.yml`);
  fs.writeFileSync(yamlFile, `# Draft from ${ticket.key} (${now.toISOString().slice(0, 10)}). Review every case, then set draft: false and automation: automated.\n${stringify({ area, feature: ticket.title || ticket.key, cases: cases.map(({ _ac, ...c }) => c) })}`);
  const tests = cases.map((c) => `  test.fixme(${JSON.stringify(`${c.id} - ${c.title}`)}, async ({ page }) => {
    // AC: ${c._ac.id} (${ticket.key}): ${c._ac.text}
${c.steps.length ? `    // Steps to implement:\n${c.steps.map((s) => `    //   - ${s}`).join('\n')}\n` : '    // Steps to write: the ticket gives none.\n'}    // Assertions to write: the observable outcome of this criterion (see expected results in test-cases/${key}.yml).
    void page;
  });`).join('\n\n');
  const specPath = path.join(root, specFile);
  fs.mkdirSync(path.dirname(specPath), { recursive: true });
  fs.writeFileSync(specPath, `import { test } from '../../fixtures/base.fixture.js';

// DRAFT from ${ticket.key}. Every test is test.fixme until its steps use real page object methods and it asserts
// the outcome of its acceptance criterion. Check with: npm run qa -- ticket-check --run
test.describe(${JSON.stringify(`${ticket.key} - ${ticket.title}`)}, () => {
${tests}
});
`);
  return { yamlFile: path.relative(root, yamlFile), specFile, cases: cases.map(({ _ac, ...c }) => c) };
}

const TAUTOLOGIES = [
  /expect\(\s*(true|false|1|0|null|undefined)\s*\)/,
  /\.toHaveTitle\(\s*\/(\.\+|\.\*|\^?\.\*\$?)\/\s*\)/,
  /\.toHaveURL\(\s*\/(\.\+|\.\*)\/\s*\)/,
  /\.toBeDefined\(\)/,
  /\.toBeTruthy\(\)/,
  /\.not\.toBeNull\(\)/,
  /expect\(\s*([\w.]+)\s*\)\.to(?:Be|Equal)\(\s*\1\s*\)/,
];

function testBody(source, id) {
  const start = source.search(new RegExp(`test(?:\\.fixme|\\.skip)?\\(\\s*["'\`]${id}\\b`));
  if (start < 0) return null;
  const open = source.indexOf('{', source.indexOf('=>', start));
  let depth = 0;
  for (let i = open; i < source.length; i++) {
    if (source[i] === '{') depth++;
    else if (source[i] === '}' && --depth === 0) return { head: source.slice(start, open), body: source.slice(open, i + 1) };
  }
  return null;
}

/**
 * Structural gate for ticket-derived cases. It can say a draft is NOT ready; it cannot say a test is right.
 * Passing means: no draft markers, every criterion marked and followed by an assertion that is not a tautology.
 * Whether the assertion matches the criterion is for a person to review (status `needs-review`, never "validated").
 */
export function checkDrafts({ root = process.cwd() }) {
  const { cases } = readDefinitions(root);
  const report = [];
  for (const c of cases.filter((x) => x.source)) {
    const problems = [];
    const warnings = [];
    const file = c.spec && path.join(root, c.spec);
    if (!file || !fs.existsSync(file)) {
      report.push({ id: c.id, source: c.source, spec: c.spec, status: 'incomplete', problems: ['the spec file does not exist'], warnings });
      continue;
    }
    const source = fs.readFileSync(file, 'utf8');
    const t = testBody(source, c.id);
    if (!t) problems.push('no test carries this case ID in the spec');
    else {
      if (/test\.(fixme|skip)\(/.test(t.head)) problems.push('the test is still test.fixme/test.skip');
      if (/\b(TODO|FIXME|\{\{)/.test(t.body)) problems.push('the test still contains TODO/FIXME markers');
      const acId = c.source.split(' ').at(-1);
      if (!new RegExp(`//\\s*AC:\\s*${acId}\\b`).test(t.body)) problems.push(`the test body does not mark which criterion it covers (// AC: ${acId})`);
      const assertions = [...t.body.matchAll(/expect(?:\.soft)?\(/g)].length;
      if (!assertions) problems.push('the test asserts nothing (no expect)');
      for (const pattern of TAUTOLOGIES) if (pattern.test(t.body)) problems.push(`tautological assertion (${pattern.source.slice(0, 40)}): it cannot fail`);
      if (assertions && !/to(Have|Contain|Equal|Be(GreaterThan|LessThan|Checked|Disabled|Enabled|Empty|Editable|Hidden)?|Match|Throw)|toBeVisible|toHaveCount/.test(t.body)) warnings.push('assertions are weak: check that they prove the expected result');
      if (/\.toBeVisible\(\)/.test(t.body) && !/toHave(Text|Value|Count|URL|Attribute|Class|CSS)|toContain|toEqual|toBe\(/.test(t.body)) warnings.push('only visibility is asserted: does it prove the expected result?');
      if (/waitForTimeout\(/.test(t.body)) warnings.push('uses a fixed wait');
      if (/page\.locator\(\s*['"`](\/\/|[.#\w[>])/.test(t.body)) warnings.push('uses CSS/XPath locators: prefer role, label or test id');
    }
    if (c.draft) warnings.push('definition still marked draft: confirm steps and expected results, then set draft: false');
    report.push({ id: c.id, source: c.source, spec: c.spec, status: problems.length ? 'incomplete' : 'needs-review', problems, warnings });
  }
  return report;
}

export { parse as parseYaml };
